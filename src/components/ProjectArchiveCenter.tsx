"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DatabaseBackup, FolderOpen, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, Search, Upload, Download, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { StorageDirectoryPicker } from "@/components/platform/StorageDirectoryPicker";
import type { Project } from "@/lib/types";
import type { BackupConnection, ProjectArchiveEntry, ProjectArchiveJob } from "@/lib/project-archive-types";
import { projectBackupCards, type BackupCard } from "@/lib/project-backup-cards";
import { trackBackgroundArchiveJob } from "@/lib/background-archive-jobs";

type Props = {
  projects: Project[];
  cacheScope: string;
  getAuthHeaders: () => HeadersInit;
  onOpenProject: (id: string) => void;
  onImportPackage: () => void;
  onExportPackage: (project: Project) => void;
  packageBusy: boolean;
};
type Status = { connection?: BackupConnection; config?: { syncDir?: string }; ready?: boolean; entries?: ProjectArchiveEntry[]; jobs?: ProjectArchiveJob[]; error?: string };
const running = (job: ProjectArchiveJob) => job.status === "queued" || job.status === "running";
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const bytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export default function ProjectArchiveCenter({ projects, cacheScope, getAuthHeaders, onOpenProject, onImportPackage, onExportPackage, packageBusy }: Props) {
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<ProjectArchiveEntry[]>([]);
  const [jobs, setJobs] = useState<ProjectArchiveJob[]>([]);
  const [connection, setConnection] = useState<BackupConnection | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<ProjectArchiveEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectArchiveEntry | null>(null);
  const [liveThumbnails, setLiveThumbnails] = useState<Record<string, string>>({});
  const headers = useRef(getAuthHeaders);
  headers.current = getAuthHeaders;
  const pending = useRef(false);
  const cacheKey = `hz_project_backups_v1:${cacheScope}`;

  const load = useCallback(async (quiet = false) => {
    if (pending.current) return;
    pending.current = true;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/project-archive", { headers: headers.current(), cache: "no-store" });
      const data = await response.json() as Status;
      if (!response.ok) throw new Error(data.error || "无法读取项目备份");
      setDirectory(data.config?.syncDir || "");
      setReady(Boolean(data.ready));
      setConnection(data.connection || null);
      setJobs(data.jobs || []);
      if (data.entries) {
        setEntries(current => JSON.stringify(current) === JSON.stringify(data.entries || []) ? current : data.entries || []);
        try { localStorage.setItem(cacheKey, JSON.stringify({ directory: data.config?.syncDir, entries: data.entries || [] })); } catch { /* Cache is optional. */ }
      }
      if (data.error) setMessage(data.error);
      else if (!quiet || data.ready) setMessage("");
    } catch (error) {
      setReady(false);
      setMessage(error instanceof Error ? error.message : "无法读取项目备份");
    } finally { pending.current = false; setLoading(false); }
  }, [cacheKey]);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached) { setEntries(cached.entries || []); setDirectory(cached.directory || ""); }
    } catch { /* Start with an empty local catalog. */ }
    void load();
    const timer = window.setInterval(() => void load(true), 4000);
    const wake = () => { if (document.visibilityState === 'visible') void load(true); };
    window.addEventListener('online', wake); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { window.clearInterval(timer); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [cacheKey, load]);

  // Load a small representative image only for projects that do not have a saved cover.
  useEffect(() => {
    const controller = new AbortController();
    const ids = projects.filter(project => !entries.some(entry => entry.projectId === project.id && entry.thumbnailDataUrl) && !liveThumbnails[project.id]).map(project => project.id);
    void (async () => {
      for (const id of ids) {
        if (controller.signal.aborted) break;
        try {
          const response = await fetch(`/api/history?projectId=${encodeURIComponent(id)}&pageSize=1`, { headers: headers.current(), signal: controller.signal });
          if (!response.ok) continue;
          const data = await response.json();
          const url = data.records?.[0]?.image_url;
          if (url && !controller.signal.aborted) setLiveThumbnails(current => ({ ...current, [id]: url }));
        } catch { /* Empty project or temporary connection failure. */ }
      }
    })();
    return () => controller.abort();
  }, [projects, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = useMemo(() => projectBackupCards(projects, entries), [projects, entries]);
  const visible = cards.filter(card => card.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (filter === "all" || (filter === "local" ? Boolean(card.project) : filter === "nas" ? !card.project : !card.versions.length)));
  const detailCard = cards.find(card => card.id === detail);
  const active = jobs.filter(running);
  const locked = busy || packageBusy;
  const selectedIds = selected.filter(id => projects.some(project => project.id === id));

  async function request(body: object) {
    const response = await fetch("/api/project-archive", { method: "POST", headers: { "Content-Type": "application/json", ...headers.current() }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  }
  async function reconnect() {
    setReconnecting(true);
    try { await request({ action: 'reconnect' }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '重连失败'); }
    finally { setReconnecting(false); }
  }
  async function configure(path: string) {
    setBusy(true);
    try { await request({ action: "configure", targetDir: path }); setEntries([]); await load(); setMessage("备份位置已连接，可以选择项目备份"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  async function start(action: "archive" | "restore", ids: string[]) {
    if (!ready || locked || !ids.length) return;
    setBusy(true);
    try {
      const data = await request({ action, targetDir: directory, ...(action === "archive" ? { projectIds: ids, deleteAfterBackup: true } : { entryIds: ids }) });
      trackBackgroundArchiveJob({ id: data.jobId, action, title: `${action === "archive" ? "备份" : "恢复"} ${ids.length} 个项目`, startedAt: new Date().toISOString() });
      setMessage(action === "archive" ? "已开始后台备份，校验成功后移出画布并释放独占原图，共用文件保留，可以继续工作" : "已开始后台恢复，完成后可打开画布");
      setSelected([]); setConfirmRestore(null); await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "任务启动失败"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirmDelete) return;
    setBusy(true);
    try { await request({ action: "delete", targetDir: directory, entryIds: [confirmDelete.id] }); setConfirmDelete(null); await load(); setMessage("已删除这个备份版本，本机项目保留"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }
  async function control(job: ProjectArchiveJob, action: "pause" | "resume" | "cancel") {
    try {
      await request({ action, jobId: job.id });
      if (action === "resume") trackBackgroundArchiveJob({ id: job.id, action: job.action, title: "继续项目备份", startedAt: new Date().toISOString() });
      await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "任务操作失败"); }
  }
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const cover = (card: BackupCard) => card.thumbnail || liveThumbnails[card.id];

  return <section className="project-backups flex min-h-0 flex-1 flex-col" aria-label="项目备份">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-5">
      <div className="min-w-0"><h2 className="flex items-center gap-2 text-base font-semibold"><DatabaseBackup size={18} />项目备份</h2><p className="mt-1 text-xs text-muted-foreground">将画布项目存入 NAS，成功后从画布移除，需要时恢复。</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`} /><span>{ready ? "备份位置已连接" : connection?.state === "checking" ? "正在检查连接…" : connection?.message || (directory ? "备份位置未连接" : "尚未设置备份位置")}</span><span className="max-w-lg truncate text-muted-foreground" title={directory}>{directory || "选择 NAS 的 AIstudio备份 文件夹"}</span><button className="motif-button" disabled={locked} onClick={() => setPicker(true)}><FolderOpen size={13} />{directory ? "更改位置" : "选择文件夹"}</button>{directory && <button className="motif-button" disabled={reconnecting || connection?.state === 'checking'} onClick={() => void reconnect()}><RefreshCw size={13} className={reconnecting ? 'animate-spin' : ''} />{reconnecting ? '正在重连…' : '立即重连'}</button>}</div>
        {!ready && connection?.nextRetryAt && <p className="mt-2 text-[11px] text-muted-foreground">下次检查 {new Date(connection.nextRetryAt).toLocaleTimeString('zh-CN')} · 连接恢复后自动继续等待中的任务</p>}
      </div>
      <div className="flex flex-wrap gap-2"><button className="motif-button" disabled={locked} onClick={onImportPackage}><Upload size={14} />导入项目包</button><button className="motif-button" disabled={loading || locked} onClick={() => void load()} aria-label="刷新项目备份"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button><button className="motif-button bg-primary text-primary-foreground" disabled={!ready || locked || !selectedIds.length} onClick={() => void start("archive", selectedIds)}><DatabaseBackup size={14} />备份并移出画布{selectedIds.length ? ` (${selectedIds.length})` : ""}</button></div>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3"><label className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" /><input className="motif-field h-9 w-48 pl-8 text-xs" placeholder="搜索项目" aria-label="搜索备份项目" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {([["all", "全部"], ["local", "本机可用"], ["nas", "仅 NAS"], ["new", "未备份"]] as const).map(([value, label]) => <button key={value} className={`motif-button ${filter === value ? "bg-muted font-medium" : "text-muted-foreground"}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      <button className="motif-button ml-auto" disabled={locked} onClick={() => setSelected(selectedIds.length ? [] : visible.filter(card => card.project).map(card => card.id))}>{selectedIds.length ? "取消选择" : "选择本机项目"}</button>
    </div>
    {message && <p className="border-b border-border bg-muted/40 px-5 py-3 text-xs" role="status">{message}</p>}
    <div className="min-h-0 flex-1 overflow-auto p-5">
      {loading && !cards.length ? <div className="flex justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />正在读取项目备份…</div> : !visible.length ? <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground"><DatabaseBackup size={32} /><p className="text-sm">{query || filter !== "all" ? "没有匹配的项目" : "项目备份集中保存在这里"}</p><p className="max-w-sm text-xs leading-6">{query || filter !== "all" ? "试试其他搜索词或筛选条件。" : "选择 NAS 文件夹后，已有备份会自动显示为卡片。也可以导入旧项目包。"}</p></div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {visible.map(card => {
          const latest = card.versions[0];
          return <article key={card.id} className="overflow-hidden rounded-xl border border-border bg-card" aria-label={`项目 ${card.name}`}>
            <div className="relative aspect-[8/5] bg-muted"><button className="h-full w-full" onClick={() => setDetail(card.id)} aria-label={`查看 ${card.name} 备份详情`}>{cover(card) ? <img src={cover(card)} alt={card.name} className="h-full w-full object-cover" onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : <ImageIcon size={28} className="mx-auto text-muted-foreground/40" />}</button>{card.project && <input type="checkbox" className="absolute left-3 top-3 h-4 w-4 accent-current" checked={selectedIds.includes(card.id)} onChange={() => toggle(card.id)} aria-label={`选择 ${card.name}`} />}</div>
            <div className="space-y-2 p-3"><h3 className="truncate text-sm font-medium" title={card.name}>{card.name}</h3><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span>{card.project ? "本机可用" : "仅 NAS"}</span><span>·</span><span>{latest ? `${card.versions.length} 个备份版本` : "尚未备份"}</span></div><p className="text-[11px] text-muted-foreground">{latest ? `最近备份 ${date(latest.archivedAt)}` : "选择项目，保存第一份备份"}</p>{latest?.sourceFormat === "legacy" && <p className="text-[10px] text-muted-foreground">旧格式 · 仅包含当时已打包的内容</p>}
            {Boolean(latest?.missingHistoryAssetCount) && <p className="text-[10px] text-amber-600 dark:text-amber-400">含 {latest!.missingHistoryAssetCount} 个已删除历史图片的链接，详见版本说明</p>}<div className="flex flex-wrap gap-2 pt-1">{card.project ? <><button className="motif-button" onClick={() => onOpenProject(card.project!.id)}>打开画布</button><button className="motif-button" disabled={!ready || locked || active.some(job => job.currentProjectId === card.id)} onClick={() => void start("archive", [card.id])}>{latest ? "更新并移出画布" : "备份并移出画布"}</button></> : <button className="motif-button" disabled={!ready || locked} onClick={() => latest && void start("restore", [latest.id])}><RotateCcw size={13} />恢复到画布</button>}<button className="motif-button text-muted-foreground" onClick={() => setDetail(card.id)}>详情</button></div></div>
          </article>;
        })}
      </div>}
      {jobs.length > 0 && <div className="mt-8 border-t border-border pt-4"><h3 className="mb-3 text-xs font-medium">最近任务</h3><div className="space-y-2">{jobs.slice(0, 5).map(job => <div key={job.id} className="rounded-lg border border-border px-3 py-2 text-xs"><div className="flex items-center gap-2">{running(job) && <Loader2 size={13} className="animate-spin" />}<span>{job.action === "archive" ? "备份" : "恢复"} · {job.completed}/{job.total}</span><span className="text-muted-foreground">{job.stage}</span>{(running(job) || job.status === "waiting") && <button className="motif-button ml-auto" onClick={() => void control(job, "pause")}>暂停</button>}{["paused", "partial", "failed"].includes(job.status) && <button className="motif-button" onClick={() => void control(job, "resume")}>继续</button>}{(running(job) || job.status === "waiting" || job.status === "paused") && <button className="motif-button" onClick={() => void control(job, "cancel")}>取消任务</button>}{job.failed > 0 && <button className="motif-button ml-auto" disabled={!ready || locked} onClick={() => { const failed = job.results.filter(result => result.status === "failed"); if (job.action === "archive") void start("archive", failed.map(result => result.projectId).filter(id => projects.some(project => project.id === id))); else void start("restore", failed.map(result => result.projectId)); }}>重试失败项</button>}{job.results.find(result => result.restoredProjectId) && <button className="motif-button ml-auto" onClick={() => onOpenProject(job.results.find(result => result.restoredProjectId)!.restoredProjectId!)}>打开恢复项目</button>}</div>{job.results.filter(result => result.status === "completed" && result.message.includes("保留")).map(result => <p key={result.projectId} className="mt-1 text-muted-foreground">{result.projectName}：{result.message}</p>)}{job.results.filter(result => result.status === "failed").map(result => <p key={result.projectId} className="mt-1 text-destructive">{result.projectName}：{result.message}</p>)}</div>)}</div></div>}
      <p className="mt-6 text-[11px] leading-5 text-muted-foreground">备份校验成功后自动从画布移除；备份期间有新修改或正在生成时保留，稍后再次备份。每次保存一个完整版本。NAS 未连接时保留缓存卡片，自动重试连接；等待连接的任务恢复后继续，手动暂停的任务需点击继续。案例、风格包等仅保存在浏览器的内容暂不包含在项目包中。</p>
    </div>
    <StorageDirectoryPicker endpoint="/api/project-archive" open={picker} initialDirectory={directory} title="选择 NAS 项目备份文件夹" onOpenChange={setPicker} onSelect={path => void configure(path)} />
    <Dialog open={Boolean(detailCard)} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="!max-w-2xl max-h-[85dvh] overflow-y-auto"><DialogTitle>{detailCard?.name}</DialogTitle><DialogDescription>备份版本与项目操作。恢复历史版本会保留当前项目。</DialogDescription>{detailCard && <>
      {cover(detailCard) && <img src={cover(detailCard)} alt="项目预览" className="max-h-56 w-full rounded-lg object-contain bg-muted" />}
      {detailCard.project && <div className="flex gap-2"><button className="motif-button" onClick={() => onOpenProject(detailCard.project!.id)}>打开画布</button><button className="motif-button" disabled={locked} onClick={() => onExportPackage(detailCard.project!)}><Download size={14} />导出项目包</button></div>}
      <p className="text-xs text-muted-foreground">{detailCard.versions.length} 个历史版本</p>{detailCard.versions.map(entry => <div key={entry.id} className="space-y-2 rounded-lg border border-border p-3"><div className="flex items-center justify-between text-xs"><span>{date(entry.archivedAt)}</span><span className="text-muted-foreground">{bytes(entry.size)}</span></div><p className="text-[11px] text-muted-foreground">{entry.counts.images} 张图片 · {entry.counts.messages} 条对话 · {entry.counts.references} 张参考图</p><p className="text-[11px] text-muted-foreground">{entry.sourceFormat === "legacy" ? "旧格式：不包含画板、设计资产等新增数据" : "包含画板、对话、参考图、提示词、技能及项目关联资产"}</p>{Boolean(entry.missingHistoryAssetCount) && <p className="text-[11px] text-amber-600 dark:text-amber-400">{entry.missingHistoryAssetCount} 个历史图片链接的原文件在备份前已删除，对话和原链接保留；当前画布原图已打包。</p>}<div className="flex gap-2"><button className="motif-button" disabled={!ready || locked} onClick={() => detailCard.project ? setConfirmRestore(entry) : void start("restore", [entry.id])}><RotateCcw size={13} />{detailCard.project ? "恢复为副本" : "恢复此版本"}</button><button className="motif-button text-muted-foreground" disabled={!ready || locked} onClick={() => setConfirmDelete(entry)}><Trash2 size={13} />删除版本</button></div></div>)}
    </>}</DialogContent></Dialog>
    <Dialog open={Boolean(confirmRestore || confirmDelete)} onOpenChange={open => { if (!open && !busy) { setConfirmRestore(null); setConfirmDelete(null); } }}><DialogContent><DialogTitle>{confirmDelete ? "删除这个备份版本？" : "恢复为项目副本？"}</DialogTitle><DialogDescription>{confirmDelete ? "此操作删除 NAS 上选中的一个备份版本，无法撤销。如果没有本机项目或其他版本，这可能是最后一份可恢复的数据。" : "当前项目保留，备份内容恢复成一个新的项目，可以单独打开与编辑。"}</DialogDescription><div className="flex justify-end gap-2"><button className="motif-button" disabled={busy} onClick={() => { setConfirmRestore(null); setConfirmDelete(null); }}><X size={13} />取消</button><button className="motif-button" disabled={busy} onClick={() => confirmDelete ? void remove() : confirmRestore && void start("restore", [confirmRestore.id])}>{busy ? "处理中…" : confirmDelete ? "删除版本" : "恢复副本"}</button></div></DialogContent></Dialog>
  </section>;
}
