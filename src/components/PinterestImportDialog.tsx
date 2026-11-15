"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NeutralSelect from "@/components/ui/neutral-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, RefreshCw, Check, Pin } from "lucide-react";

export interface ImportedPinterestItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  imageUrl: string;
  imageKey: string | null;
  width: number;
  height: number;
  target: string;
}

interface PinterestBoard {
  id: string;
  name: string;
  description: string | null;
  privacy: string | undefined;
  pinCount: number;
  coverUrl: string | null;
}

interface PinterestPin {
  id: string;
  title: string;
  imageUrl: string | null;
  width: number;
  height: number;
  createdAt: string | null;
}

type ImportTarget = "canvas" | "gallery" | "reference";

interface PinterestImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  onImported?: (imported: ImportedPinterestItem[]) => void;
}

function pinterestLogo(size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.64 7.86 6.36 9.31-.09-.79-.17-2.01.03-2.87.19-.79 1.2-5.09 1.2-5.09s-.31-.62-.31-1.53c0-1.43.83-2.5 1.86-2.5.88 0 1.3.66 1.3 1.45 0 .88-.56 2.2-.85 3.42-.24 1.02.51 1.86 1.52 1.86 1.82 0 3.22-1.92 3.22-4.69 0-2.45-1.76-4.17-4.28-4.17-2.92 0-4.63 2.19-4.63 4.45 0 .88.34 1.83.76 2.34.08.1.1.19.07.29-.08.32-.25 1.03-.28 1.17-.04.19-.15.23-.35.14-1.3-.6-2.11-2.5-2.11-4.02 0-3.28 2.38-6.29 6.87-6.29 3.61 0 6.41 2.57 6.41 6.01 0 3.59-2.26 6.48-5.4 6.48-1.05 0-2.04-.55-2.38-1.19l-.65 2.47c-.23.9-.87 2.03-1.3 2.72.98.3 2.02.47 3.11.47 5.52 0 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  );
}

export default function PinterestImportDialog({
  open,
  onOpenChange,
  projectId,
  onImported,
}: PinterestImportDialogProps) {
  const [status, setStatus] = useState<"loading" | "not-connected" | "connected" | "error">("loading");
  const [configured, setConfigured] = useState(true);
  const [providerUsername, setProviderUsername] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [pins, setPins] = useState<PinterestPin[]>([]);
  const [bookmark, setBookmark] = useState<string | null>(null);
  const [loadingPins, setLoadingPins] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [target, setTarget] = useState<ImportTarget>("canvas");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importDone, setImportDone] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setStatus("loading");
    setBoards([]);
    setSelectedBoardId("");
    setPins([]);
    setBookmark(null);
    setSelectedIds(new Set());
    setImporting(false);
    setImportDone(false);
    setErrorMessage("");
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/import/pinterest/connection", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "查询连接失败");
        return;
      }
      setConfigured(Boolean(data.configured));
      if (data.connected) {
        setStatus("connected");
        setProviderUsername(data.providerUsername || null);
      } else {
        setStatus("not-connected");
        setProviderUsername(null);
      }
    } catch {
      setStatus("error");
      setErrorMessage("无法连接服务器");
    }
  }, []);

  // 打开时检查连接
  useEffect(() => {
    if (!open) return;
    reset();
    checkConnection();
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [open, reset, checkConnection]);

  // 连接成功后拉画板
  useEffect(() => {
    if (status !== "connected") return;
    loadBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const loadBoards = useCallback(async () => {
    try {
      const res = await fetch("/api/import/pinterest/boards", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "获取画板失败");
        return;
      }
      setBoards(data.boards || []);
      if ((data.boards || []).length > 0) {
        setSelectedBoardId(data.boards[0].id);
      }
    } catch {
      setStatus("error");
      setErrorMessage("获取画板失败");
    }
  }, []);

  const loadPins = useCallback(
    async (boardId: string, append: boolean, nextBookmark: string | null) => {
      if (!boardId) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingPins(true);
      }
      try {
        const qs = new URLSearchParams();
        if (nextBookmark) qs.set("bookmark", nextBookmark);
        const res = await fetch(`/api/import/pinterest/boards/${encodeURIComponent(boardId)}/pins?${qs.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMessage(data.error || "获取图片失败");
          return;
        }
        const nextPins: PinterestPin[] = (data.pins || []).filter((p: PinterestPin) => p.imageUrl);
        setPins((prev) => (append ? [...prev, ...nextPins] : nextPins));
        setBookmark(data.bookmark || null);
      } catch {
        setErrorMessage("获取图片失败");
      } finally {
        setLoadingPins(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // 画板切换
  useEffect(() => {
    if (!selectedBoardId) return;
    setPins([]);
    setBookmark(null);
    setSelectedIds(new Set());
    loadPins(selectedBoardId, false, null);
  }, [selectedBoardId, loadPins]);

  const startConnect = useCallback(async () => {
    setConnecting(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/import/pinterest/auth-url", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setErrorMessage(data.error || "生成授权链接失败");
        setConnecting(false);
        return;
      }
      window.open(data.url, "_blank", "noopener,width=900,height=720");

      // 轮询连接状态，授权完成后自动进入已连接
      let attempts = 0;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = setInterval(async () => {
        attempts += 1;
        if (attempts > 90) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          setConnecting(false);
          return;
        }
        try {
          const res2 = await fetch("/api/import/pinterest/connection", { cache: "no-store" });
          const data2 = await res2.json();
          if (res2.ok && data2.connected) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            pollTimer.current = null;
            setConnecting(false);
            setStatus("connected");
            setProviderUsername(data2.providerUsername || null);
          }
        } catch {
          // 忽略轮询错误，继续等
        }
      }, 2000);
    } catch {
      setErrorMessage("生成授权链接失败");
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/import/pinterest/connection", { method: "DELETE", cache: "no-store" });
    } catch {
      // ignore
    }
    setStatus("not-connected");
    setProviderUsername(null);
    setBoards([]);
    setPins([]);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedPins = pins.filter((p) => selectedIds.has(p.id));

  const runImport = useCallback(async () => {
    if (selectedPins.length === 0) return;
    setImporting(true);
    setImportDone(false);
    setErrorMessage("");
    try {
      const res = await fetch("/api/import/pinterest/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pins: selectedPins.map((p) => ({
            id: p.id,
            title: p.title,
            imageUrl: p.imageUrl,
            width: p.width,
            height: p.height,
          })),
          target,
          projectId: projectId || null,
          canvasX: 80,
          canvasY: 80,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "导入失败");
        setImporting(false);
        return;
      }
      setImportDone(true);
      setImportProgress({ done: data.succeeded ?? 0, total: data.total ?? selectedPins.length });
      onImported?.(data.imported || []);
    } catch {
      setErrorMessage("导入失败，请重试");
      setImporting(false);
    } finally {
      setImporting(false);
    }
  }, [selectedPins, target, projectId, onImported]);

  const canImport = selectedPins.length > 0 && !importing && (target !== "canvas" && target !== "gallery" ? true : Boolean(projectId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-red-600 dark:text-red-500">{pinterestLogo(20)}</span>
            <DialogTitle className="text-base">从 Pinterest 导入</DialogTitle>
          </div>
          <DialogDescription className="hidden" />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {status === "loading" && (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在检查连接…
            </div>
          )}

          {status === "error" && (
            <div className="space-y-3 text-sm">
              <p className="text-destructive">{errorMessage || "出错了"}</p>
              <Button variant="outline" size="sm" onClick={checkConnection}>
                <RefreshCw className="w-3.5 h-3.5" /> 重试
              </Button>
            </div>
          )}

          {status === "not-connected" && (
            <div className="flex flex-col items-center justify-center h-56 gap-3 text-center">
              <span className="text-red-600 dark:text-red-500">{pinterestLogo(40)}</span>
              <p className="text-sm text-muted-foreground max-w-sm">
                连接你的 Pinterest 账号，即可从个人画板中浏览并导入图片。
              </p>
              {!configured && (
                <p className="text-xs text-amber-600 dark:text-amber-500 max-w-sm">
                  服务端尚未配置 Pinterest App。请设置环境变量 PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET /
                  PINTEREST_REDIRECT_URI。
                </p>
              )}
              {connecting ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> 等待 Pinterest 授权完成…
                </div>
              ) : (
                <Button onClick={startConnect} disabled={!configured}>
                  <span className="flex items-center gap-1.5">{pinterestLogo(16)} 连接 Pinterest</span>
                </Button>
              )}
            </div>
          )}

          {status === "connected" && (
            <div className="space-y-4">
              {/* 顶部信息栏 */}
              <div className="flex items-center justify-between bg-muted/60 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-red-600 dark:text-red-500">{pinterestLogo(16)}</span>
                  <span className="font-medium">已连接{providerUsername ? `：${providerUsername}` : ""}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={disconnect} className="text-muted-foreground">
                  <LogOut className="w-3.5 h-3.5" /> 断开
                </Button>
              </div>

              {/* 画板选择 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">选择画板</span>
                <NeutralSelect
                  value={selectedBoardId}
                  onChange={(e) => setSelectedBoardId(e.target.value)}
                  className="flex-1 bg-muted text-sm px-3 py-1.5 rounded-md border border-border outline-none focus:border-border-secondary"
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}（{b.pinCount}）
                    </option>
                  ))}
                </NeutralSelect>
              </div>

              {/* 图片网格 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedIds.size} 张
                  </span>
                  {bookmark && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={loadingMore}
                      onClick={() => loadPins(selectedBoardId, true, bookmark)}
                    >
                      {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      加载更多
                    </Button>
                  )}
                </div>

                {loadingPins ? (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                  </div>
                ) : pins.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                    这个画板没有可导入的图片
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {pins.map((pin) => {
                      const selected = selectedIds.has(pin.id);
                      return (
                        <button
                          key={pin.id}
                          onClick={() => toggleSelect(pin.id)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors group ${
                            selected ? "border-red-500" : "border-transparent hover:border-border"
                          }`}
                          title={pin.title || "Pinterest 图片"}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={pin.imageUrl || ""}
                            alt={pin.title || "Pinterest 图片"}
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                          {selected && (
                            <span className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {status === "connected" && (
          <div className="px-5 py-3 border-t border-border shrink-0 space-y-2">
            {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">导入到</span>
                <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                  {(
                    [
                      { key: "canvas", label: "画布" },
                      { key: "gallery", label: "图库" },
                      { key: "reference", label: "参考库" },
                    ] as Array<{ key: ImportTarget; label: string }>
                  ).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTarget(t.key)}
                      className={`text-xs px-2.5 py-1 rounded transition-colors ${
                        target === t.key ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {(target === "canvas" || target === "gallery") && !projectId && (
                  <span className="text-amber-600 dark:text-amber-500">请先选择项目</span>
                )}
              </div>
              <Button onClick={runImport} disabled={!canImport} size="sm">
                {importing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    导入中 {importProgress.done}/{importProgress.total}
                  </>
                ) : importDone ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> 已导入 {selectedIds.size} 张
                  </>
                ) : (
                  <>
                    <Pin className="w-3.5 h-3.5" /> 导入 {selectedIds.size > 0 ? `${selectedIds.size} 张` : ""}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
