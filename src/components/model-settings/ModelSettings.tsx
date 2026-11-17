"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Copy, Eye, EyeOff, Loader2, MoreHorizontal, Plus, Search, Server, Power, X, ExternalLink, Image as ImageIcon, MessageSquare, Video, AudioLines, ScanEye, Layers, SlidersHorizontal, Box } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import NeutralSelect from "@/components/ui/neutral-select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { commonModelKeys, connectionError, serviceWebsite, SERVICE_PRESETS, MODEL_KIND_LABELS, MODEL_USE_LABELS, modelConnectionKey, saveConnectionStore, validateConnection, type ModelConnection, type ModelKind, type ModelUse, type SettingsBinding, type SettingsModel } from "@/lib/model-settings";

type EndpointHistory = { id: string; name: string; baseUrl: string; type: ModelConnection["type"]; lastUsedAt: string };
type Snapshot = { profiles: ModelConnection[]; activeProviderId: string; endpointHistory: EndpointHistory[]; capabilityBindings: SettingsBinding[] };
type Props = Snapshot & {
  readModels: (url: string, providerId: string) => SettingsModel[];
  normalizeModels: (value: unknown) => SettingsModel[];
  getCategory: (provider: ModelConnection, model: SettingsModel) => ModelKind;
  onCommit: (snapshot: Snapshot) => void;
  onDefault: (providerId: string, modelId: string, capability: ModelUse) => void;
  onBack: () => void;
};
type Health = { state: "checking" | "ok" | "error"; message: string; detail?: string; at?: string };
type ModelRow = { provider: ModelConnection; model: SettingsModel; missing?: boolean };
type ConnectionDraft = { id: string; name: string; baseUrl: string; apiKeyLocal: string; type: ModelConnection["type"] };
const blankDraft = (): ConnectionDraft => ({ id: "", name: "", baseUrl: "", apiKeyLocal: "", type: "custom" });
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primary = "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const MODEL_KIND_ICONS = { image: ImageIcon, chat: MessageSquare, video: Video, vision: ScanEye, audio: AudioLines, embedding: Layers, rerank: SlidersHorizontal, unknown: Box };
const isCatalog = (model: SettingsModel) => model.type === "capability" || model.tags?.includes("capability");
function usesFor(kind: ModelKind): ModelUse[] {
  if (kind === "image") return ["image", "imageTool"];
  if (kind === "chat" || kind === "vision") return ["chat"];
  if (kind === "video") return ["video"];
  if (kind === "audio") return ["speech"];
  if (kind === "embedding") return ["embedding"];
  return [];
}
function kindOverrideKey(url: string) {
  return "hz_model_category_overrides_v1:" + (url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") || "default");
}
function cacheModels(provider: ModelConnection, models: SettingsModel[]) {
  const value = JSON.stringify({ models, updatedAt: Date.now(), baseUrl: provider.baseUrl });
  localStorage.setItem(`hz_image_models_by_provider_v1:${provider.id}`, value);
  const urlKey = provider.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") || "default";
  localStorage.setItem("hz_image_models_cache_v1:" + urlKey, value);
}

export default function ModelSettings(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const [view, setView] = useState(props.activeProviderId || props.profiles[0]?.id || "common");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [onlyCommon, setOnlyCommon] = useState(false);
  const [, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<ConnectionDraft | null>(null);
  const initialDraft = useRef("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [formError, setFormError] = useState<{ field?: string; message: string } | null>(null);
  const [savedDraftId, setSavedDraftId] = useState("");
  const [balance, setBalance] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ModelRow | null>(null);
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualKind, setManualKind] = useState<ModelKind>("chat");
  const [remove, setRemove] = useState<ModelConnection | null>(null);
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const requestControllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controllers = requestControllers.current;
    return () => { mounted.current = false; controllers.forEach(c => c.abort()); };
  }, []);
  // Requests carry their own controller; a replacement request cancels the prior
  // one. They never select a service or rewrite the currently displayed list.
  const currentProvider = props.profiles.find(p => p.id === view);
  const websiteUrl = currentProvider ? serviceWebsite(currentProvider.baseUrl) : null;
  const commonKeys = commonModelKeys(props.capabilityBindings);
  const snapshot = (): Snapshot => {
    const p = latest.current;
    return { profiles: p.profiles, activeProviderId: p.activeProviderId, endpointHistory: p.endpointHistory, capabilityBindings: p.capabilityBindings };
  };
  async function commit(next: Snapshot) {
    await saveConnectionStore(next);
    latest.current = { ...latest.current, ...next };
    props.onCommit(next);
  }
  async function exclusive(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try { await action(); } catch { setNotice("设置未能保存，请检查本机服务后重试。你的原配置已保留。"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const { profiles, capabilityBindings, readModels } = props;
  const modelRows = (() => {
    const rows: ModelRow[] = [];
    const providers = view === "common" ? profiles : profiles.filter(p => p.id === view);
    for (const provider of providers) {
      const models = readModels(provider.baseUrl, provider.id);
      const ids = new Set(models.map(m => m.id));
      for (const model of models) rows.push({ provider, model });
      for (const b of capabilityBindings) {
        if (b.providerId === provider.id && b.enabled && b.showInPicker && !ids.has(b.modelId)) {
          rows.push({ provider, model: { id: b.modelId }, missing: true }); ids.add(b.modelId);
        }
      }
    }
    return rows;
    // Cache writes bump revision without moving persistent model choices.
  })();
  const defaultKeys = new Set(props.capabilityBindings.filter(b => b.enabled && b.showInPicker && b.isDefault).map(b => modelConnectionKey(b.providerId, b.modelId)));
  const priority = (row: ModelRow) => {
    const key = modelConnectionKey(row.provider.id, row.model.id);
    return commonKeys.has(key) ? defaultKeys.has(key) ? 2 : 1 : 0;
  };
  const filtered = modelRows.filter(row => {
    const common = commonKeys.has(modelConnectionKey(row.provider.id, row.model.id));
    if ((view === "common" || onlyCommon) && !common) return false;
    if (kind !== "all" && props.getCategory(row.provider, row.model) !== kind) return false;
    return !search.trim() || [row.model.displayName, row.model.id, row.model.description, row.provider.name].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => priority(b) - priority(a));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 40));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 40, currentPage * 40);
  function changeView(id: string) {
    setView(id); setSearch(""); setKind("all"); setOnlyCommon(false); setSelected(new Set()); setBatch(false); setPage(1); setNotice("");
  }
  function openConnection(provider?: ModelConnection) {
    const value = provider ? { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKeyLocal: provider.apiKeyLocal, type: provider.type } : blankDraft();
    initialDraft.current = JSON.stringify(value); setDraft(value); setShowKey(false); setFormError(null); setSavedDraftId(""); setConfirmDiscard(false);
  }
  function closeConnection() {
    if (busy) return;
    if (draft && !savedDraftId && JSON.stringify(draft) !== initialDraft.current) { setConfirmDiscard(true); return; }
    setDraft(null);
  }
  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft(d => d ? { ...d, ...patch } : d); setFormError(null); setSavedDraftId("");
  }
  async function openWebsite(event: React.MouseEvent<HTMLAnchorElement>) {
    const desktop = (window as Window & { electronAPI?: { isDesktop?: boolean; openExternal?: (url: string) => Promise<{ success: boolean; message?: string }> } }).electronAPI;
    if (!desktop?.isDesktop || !websiteUrl) return;
    event.preventDefault();
    if (!desktop.openExternal) {
      setNotice(`浏览器入口尚未就绪，请重启应用或手动访问：${websiteUrl}`);
      return;
    }
    try {
      const result = await desktop.openExternal(websiteUrl);
      setNotice(result.success ? "已在系统浏览器打开官网，可登录后充值。" : `${result.message || "浏览器未能打开"} ${websiteUrl}`);
    } catch {
      setNotice(`浏览器未能打开，请手动访问：${websiteUrl}`);
    }
  }
  async function connect(provider: ModelConnection) {
    requestControllers.current.get(provider.id)?.abort();
    const controller = new AbortController(); requestControllers.current.set(provider.id, controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    setHealth(prev => ({ ...prev, [provider.id]: { state: "checking", message: "正在连接并获取模型…" } }));
    try {
      const response = await fetch("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: provider.baseUrl, apiKey: provider.apiKeyLocal, type: provider.type }), signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.models)) throw new Error(data.error || `HTTP ${response.status}`);
      const fresh = snapshot();
      const existing = fresh.profiles.find(p => p.id === provider.id);
      if (!mounted.current || requestControllers.current.get(provider.id) !== controller || !existing || existing.baseUrl !== provider.baseUrl || existing.apiKeyLocal !== provider.apiKeyLocal) return false;
      const models = props.normalizeModels(data.models);
      // Keep manually added models and choices that disappeared from the remote
      // directory; unavailable common models are visibly marked for confirmation.
      const manualModels = props.readModels(provider.baseUrl, provider.id).filter(m => m.tags?.includes("manually-added") && !models.some(n => n.id === m.id));
      await commit({ ...fresh, profiles: fresh.profiles.map(p => p.id === provider.id ? { ...p, lastDetectedAt: new Date().toISOString() } : p) });
      cacheModels(provider, [...models, ...manualModels]); setRevision(n => n + 1);
      // Refresh the legacy workspace pickers after their shared cache is written.
      props.onCommit(snapshot());
      setHealth(prev => ({ ...prev, [provider.id]: { state: "ok", message: `已连接，发现 ${models.length} 个模型`, at: new Date().toISOString() } }));
      return true;
    } catch (error) {
      if (requestControllers.current.get(provider.id) !== controller || !mounted.current) return false;
      const message = connectionError(error instanceof Error ? (controller.signal.aborted ? "timeout" : error.message) : "");
      setHealth(prev => ({ ...prev, [provider.id]: { state: "error", message, at: new Date().toISOString() } }));
      return false;
    } finally { clearTimeout(timer); }
  }
  async function saveDraft() {
    if (!draft || busyRef.current) return;
    const invalid = validateConnection(draft.baseUrl, draft.apiKeyLocal);
    if (invalid) { setFormError(invalid); return; }
    await exclusive(async () => {
      const now = new Date().toISOString();
      const fresh = snapshot();
      const id = draft.id || `provider-${crypto.randomUUID()}`;
      const existing = fresh.profiles.find(p => p.id === id);
      const baseUrl = draft.baseUrl.trim();
      const provider: ModelConnection = { id, name: draft.name.trim() || new URL(baseUrl).hostname, baseUrl, apiKeyLocal: draft.apiKeyLocal.trim(), type: draft.type, enabled: true, createdAt: existing?.createdAt || now, updatedAt: now, lastDetectedAt: existing?.baseUrl === baseUrl && existing?.apiKeyLocal === draft.apiKeyLocal.trim() ? existing.lastDetectedAt : undefined };
      try {
        await commit({ ...fresh, profiles: existing ? fresh.profiles.map(p => p.id === id ? provider : p) : [...fresh.profiles, provider], activeProviderId: fresh.activeProviderId || id, endpointHistory: [{ id, name: provider.name, baseUrl, type: provider.type, lastUsedAt: now }, ...fresh.endpointHistory.filter(h => h.id !== id)] });
      } catch { setFormError({ message: "配置未能保存到本机，请重试。" }); return; }
      setDraft({ id, name: provider.name, baseUrl, apiKeyLocal: provider.apiKeyLocal, type: provider.type });
      setSavedDraftId(id); changeView(id);
      if (await connect(provider)) { setDraft(null); setNotice("连接已保存。激活模型后，即可在对应工作区使用。"); }
      else setFormError({ message: "配置已保存，暂时未能获取模型。可重试连接，或稍后手动添加模型。" });
    });
  }
  async function setCommon(rows: ModelRow[], enabled: boolean) {
    await exclusive(async () => {
      const fresh = snapshot();
      const keys = new Set(rows.map(r => modelConnectionKey(r.provider.id, r.model.id)));
      const defaults = fresh.capabilityBindings.filter(b => keys.has(modelConnectionKey(b.providerId, b.modelId)) && b.enabled && b.isDefault && b.showInPicker);
      if (!enabled && defaults.length && !window.confirm("其中包含默认模型。停用后会清除其默认设置，并使用其余已激活模型；如果没有其他模型，需要重新选择。继续停用？")) return;
      const bindings = fresh.capabilityBindings.filter(b => !keys.has(modelConnectionKey(b.providerId, b.modelId)));
      const existingDefaults = new Set(bindings.filter(b => b.enabled && b.showInPicker && b.isDefault).map(b => b.capability));
      const now = new Date().toISOString();
      if (enabled) for (const row of rows) {
        if (isCatalog(row.model) || row.provider.type === "codia") continue;
        const uses = usesFor(props.getCategory(row.provider, row.model));
        if (!uses.length) { setDetail(row); setNotice("请先在模型详情中确认用途，再激活。"); continue; }
        for (const capability of uses) {
          const old = fresh.capabilityBindings.find(b => b.providerId === row.provider.id && b.modelId === row.model.id && b.capability === capability);
          const isDefault = old?.isDefault || !existingDefaults.has(capability);
          bindings.push({ capability, providerId: row.provider.id, modelId: row.model.id, enabled: true, showInPicker: true, isDefault, updatedAt: now });
          if (isDefault) existingDefaults.add(capability);
        }
      }
      await commit({ ...fresh, capabilityBindings: bindings }); setSelected(new Set());
      if (enabled && bindings.some(b => b.enabled && b.isDefault && keys.has(modelConnectionKey(b.providerId,b.modelId)) && !fresh.capabilityBindings.some(old => old.capability === b.capability && old.enabled && old.isDefault))) setNotice("已激活，并设为该用途的首个默认模型。");
    });
  }
  async function setDefault(row: ModelRow, capability: ModelUse) {
    await exclusive(async () => {
      const fresh = snapshot();
      const exists = fresh.capabilityBindings.some(b => b.providerId === row.provider.id && b.modelId === row.model.id && b.capability === capability && b.enabled && b.showInPicker);
      if (!exists) return;
      await commit({ ...fresh, capabilityBindings: fresh.capabilityBindings.map(b => b.capability === capability ? { ...b, isDefault: b.providerId === row.provider.id && b.modelId === row.model.id } : b) });
      props.onDefault(row.provider.id, row.model.id, capability); setNotice(`已设为${MODEL_USE_LABELS[capability]}默认模型。`);
    });
  }
  async function deleteConnection() {
    if (!remove) return;
    await exclusive(async () => {
      const fresh = snapshot();
      const profiles = fresh.profiles.filter(p => p.id !== remove.id);
      await commit({ ...fresh, profiles, activeProviderId: fresh.activeProviderId === remove.id ? profiles[0]?.id || "" : fresh.activeProviderId, capabilityBindings: fresh.capabilityBindings.filter(b => b.providerId !== remove.id) });
      setRemove(null); changeView(profiles[0]?.id || "common");
    });
  }
  async function addManual() {
    if (!currentProvider || !manualId.trim()) return;
    await exclusive(async () => {
      const models = props.readModels(currentProvider.baseUrl, currentProvider.id);
      if (models.some(m => m.id === manualId.trim())) { setNotice("此模型已在列表中。"); setManual(false); return; }
      cacheModels(currentProvider, [...models, { id: manualId.trim(), category: manualKind, tags: ["manually-added"] }]);
      setRevision(n => n + 1); props.onCommit(snapshot()); setManual(false); setNotice("模型已添加，尚未验证调用。激活后可在工作区选择。");
    });
  }
  function renderConnectionMenu(provider: ModelConnection): ReactNode {
    return <DropdownMenu><DropdownMenuTrigger asChild><button className={button} disabled={busy} aria-label={`${provider.name}服务操作`}><MoreHorizontal size={16}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => openConnection(provider)}>编辑连接</DropdownMenuItem><DropdownMenuItem onSelect={() => void exclusive(async () => { await connect(provider); })}>重新连接并刷新模型</DropdownMenuItem><DropdownMenuItem onSelect={() => void exclusive(async () => {
      setBalance(prev => ({ ...prev, [provider.id]: "正在查询余额…" }));
      try { const res = await fetch("/api/provider-balance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: provider.baseUrl, apiKey: provider.apiKeyLocal, type: provider.type }), signal: AbortSignal.timeout(20000) }); const data = await res.json(); setBalance(prev => ({ ...prev, [provider.id]: res.ok ? data.message || "查询完成" : "此服务暂不支持余额查询，请前往服务网站查看。" })); } catch { setBalance(prev => ({ ...prev, [provider.id]: "余额查询失败，请稍后重试。" })); }
    })}>查询余额</DropdownMenuItem><DropdownMenuItem className="text-destructive" onSelect={() => setRemove(provider)}>移除连接…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  }

  return <div data-model-center="true" className="flex h-full min-h-0 min-w-0 flex-1 bg-background text-foreground" onWheel={e => e.stopPropagation()}>
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-border bg-app-sidebar px-3 py-5 max-[1000px]:w-[184px]">
      <div className="px-3"><h1 className="text-base font-semibold">模型配置</h1><p className="mt-1.5 text-xs leading-5 text-muted-foreground">连接服务，激活需要的模型。</p></div>
      <button onClick={() => changeView("common")} data-model-nav-active={view === "common"} className={`mt-6 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${view === "common" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}><Power size={15}/>激活模型<span className="ml-auto text-xs tabular-nums">{commonKeys.size}</span></button>
      <div className="mb-2 mt-7 flex items-center justify-between px-3 text-[11px] font-medium text-muted-foreground"><span>我的服务</span><span>{props.profiles.length}</span></div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">{props.profiles.map(provider => {
        const status = health[provider.id];
        return <button key={provider.id} onClick={() => changeView(provider.id)} data-model-nav-active={view === provider.id} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-left ${view === provider.id ? "bg-muted" : "hover:bg-muted/60"}`}><Server size={15} className="shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{provider.name}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{status?.state === "checking" ? "连接中…" : status?.state === "error" ? "需要处理" : status?.state === "ok" ? "已连接" : provider.lastDetectedAt ? "曾连接成功" : "未检测"}</span></span></button>;
      })}</div>
      <button className={`${button} mt-3 w-full justify-start`} onClick={() => openConnection()} disabled={busy}><Plus size={15}/>添加服务</button>
      <button className="mt-4 flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground" onClick={props.onBack}><ArrowLeft size={14}/>返回画布</button>
    </aside>
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-[84px] shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0"><h2 className="truncate text-xl font-semibold">{currentProvider?.name || "激活模型"}</h2><p className="mt-2 truncate text-xs text-muted-foreground" title={currentProvider?.baseUrl}>{currentProvider ? currentProvider.baseUrl : "激活模型后，可直接在画布和对话中选择。"}</p></div>
        {currentProvider && <div className="flex shrink-0 items-center gap-2">{websiteUrl && <a className={button} href={websiteUrl} onClick={event => void openWebsite(event)} target="_blank" rel="noopener noreferrer" title="打开服务网站，前往账号或充值页面"><ExternalLink size={14}/>前往官网</a>}<button className={button} onClick={() => void exclusive(async () => { await connect(currentProvider); })} disabled={busy}>{busy && health[currentProvider.id]?.state === "checking" ? <Loader2 size={14} className="animate-spin"/> : null}刷新模型</button>{renderConnectionMenu(currentProvider)}</div>}
      </header>
      {currentProvider && health[currentProvider.id] && <div role="status" className={`flex shrink-0 items-start justify-between gap-3 border-b border-border px-6 py-3 text-xs ${health[currentProvider.id].state === "error" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}><span>{health[currentProvider.id].message}{health[currentProvider.id].state === "error" && " 已保存的配置和模型仍然保留。"}</span>{health[currentProvider.id].state === "error" && <button className="shrink-0 underline underline-offset-4" disabled={busy} onClick={() => openConnection(currentProvider)}>检查连接</button>}</div>}
      {currentProvider && !health[currentProvider.id] && currentProvider.lastDetectedAt && <p className="border-b border-border px-6 py-2 text-[11px] text-muted-foreground">上次连接成功：{new Date(currentProvider.lastDetectedAt).toLocaleString()} · 模型列表不代表每个模型都已验证调用。</p>}
      {currentProvider && balance[currentProvider.id] && <p role="status" className="px-6 pt-3 text-xs text-muted-foreground">{balance[currentProvider.id]}</p>}
      {notice && <div role="status" className="flex items-start justify-between gap-3 border-b border-border bg-muted/50 px-6 py-3 text-xs leading-5"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示"><X size={14}/></button></div>}
      {props.profiles.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center px-6 text-center"><Server size={30} className="mb-5 text-muted-foreground"/><h3 className="text-lg font-medium">连接你的第一个模型服务</h3><p className="mb-6 mt-3 max-w-sm text-sm leading-6 text-muted-foreground">准备好服务提供的 API 地址和密钥，连接后即可选择模型。</p><button className={primary} onClick={() => openConnection()}><Plus size={16}/>添加服务</button></div> : <>
        <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 py-3"><label className="relative min-w-[180px] w-[320px] max-w-full"><Search size={16} className="absolute left-3 top-2.5 text-muted-foreground"/><input aria-label="搜索模型" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索模型名称或 ID" className={`${field} py-2 pl-9`}/></label><NeutralSelect aria-label="筛选模型用途" value={kind} onChange={e => { setKind(e.target.value); setPage(1); }} className="rounded-lg border border-border bg-background px-3 py-2 text-xs"><option value="all">全部用途</option>{Object.entries(MODEL_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NeutralSelect>{view !== "common" && <label className="flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={onlyCommon} onChange={e => { setOnlyCommon(e.target.checked); setPage(1); }}/>仅看已激活</label>}{currentProvider && currentProvider.type !== "codia" && <button className={button} onClick={() => { setManual(true); setManualId(""); }}>手动添加</button>}<button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setBatch(!batch); setSelected(new Set()); }}>{batch ? "完成管理" : "批量管理"}</button></div>
        {batch && <div className="mx-7 mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-xs"><label className="flex items-center gap-2"><input aria-label="选择本页模型" type="checkbox" checked={visible.length > 0 && visible.every(r => selected.has(modelConnectionKey(r.provider.id, r.model.id)))} onChange={e => setSelected(e.target.checked ? new Set(visible.map(r => modelConnectionKey(r.provider.id, r.model.id))) : new Set())}/>本页</label><span>已选 {selected.size} 项</span><button disabled={busy || !selected.size} className={button} onClick={() => void setCommon(filtered.filter(r => selected.has(modelConnectionKey(r.provider.id, r.model.id))), true)}>激活模型</button><button disabled={busy || !selected.size} className={button} onClick={() => void setCommon(filtered.filter(r => selected.has(modelConnectionKey(r.provider.id, r.model.id))), false)}>停用模型</button></div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          <div className="model-card-grid" role="list" aria-label="模型列表">{visible.map(row => {
            const key = modelConnectionKey(row.provider.id, row.model.id);
            const active = commonKeys.has(key);
            const category = props.getCategory(row.provider, row.model);
            const Icon = MODEL_KIND_ICONS[category];
            const defaults = props.capabilityBindings.filter(b => b.providerId === row.provider.id && b.modelId === row.model.id && b.enabled && b.showInPicker && b.isDefault && b.capability !== "imageTool" && b.capability !== "reasoning");
            const catalog = isCatalog(row.model) || row.provider.type === "codia";
            const name = row.model.displayName || row.model.id;
            const description = row.model.description || (row.model.tags?.includes("manually-added") ? "手动添加的模型，可在详情中查看或调整用途。" : "服务尚未提供模型说明，可在详情中查看模型 ID 与用途。");
            return <article key={key} role="listitem" aria-label={`${row.provider.name} · ${name}`} className="model-card" data-activated={active} data-selected={selected.has(key)}>
              <div className="model-card-heading">
                {batch && <input className="model-card-checkbox" aria-label={`选择 ${row.model.id}`} type="checkbox" checked={selected.has(key)} onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(key); else next.delete(key); return next; })}/>}
                <span className="model-card-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.7}/></span>
                <span className="model-card-kind">{catalog ? "专用工具" : MODEL_KIND_LABELS[category]}</span>
                {defaults.length > 0 && <span className="model-card-default" title={defaults.map(b => `${MODEL_USE_LABELS[b.capability]}默认`).join("、")}><Check size={11}/>默认</span>}
              </div>
              <h3 className="model-card-title"><button title={name} onClick={() => setDetail(row)}>{name}</button></h3>
              <p className="model-card-source" title={view === "common" ? row.provider.name : row.model.id}>{view === "common" ? row.provider.name : row.model.displayName && row.model.displayName !== row.model.id ? row.model.id : currentProvider?.name}</p>
              <p className={`model-card-description${row.missing || row.model.tags?.includes("maintenance") ? " model-card-warning" : ""}`} title={row.missing ? "目录中未找到，激活设置已保留" : description}>{row.missing ? "目录中未找到，激活设置已保留" : row.model.tags?.includes("maintenance") ? "服务标记为维护中，请留意服务商通知。" : description}</p>
              <div className="model-card-actions">
                {catalog ? <span className="model-card-status">工具内设置</span> : <label className="model-card-activation"><Switch className="active-model-switch" aria-label={`${row.model.id} 激活模型`} checked={active} disabled={busy} onCheckedChange={enabled => void setCommon([row], enabled)}/><span>{active ? "已激活" : "未激活"}</span></label>}
                <button className="model-card-details" aria-label={`${row.model.id} 详情`} onClick={() => setDetail(row)}>详情</button>
              </div>
            </article>;
          })}</div>
          {!filtered.length && <div className="py-16 text-center"><h3 className="text-sm font-medium">{search || kind !== "all" || onlyCommon ? "没有匹配的模型" : view === "common" ? "还没有激活模型" : "还没有模型"}</h3><p className="mt-3 text-xs leading-6 text-muted-foreground">{search || kind !== "all" || onlyCommon ? "试试其他关键词，或清除筛选。" : view === "common" ? "选择左侧服务，激活需要使用的模型。" : currentProvider?.type === "codia" ? "这是专用工具服务，请在转换工具中使用；也可刷新查看能力目录。" : "刷新模型，或手动添加服务提供的模型 ID。"}</p></div>}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-3 text-xs text-muted-foreground"><span>{filtered.length} 个模型 · {view === "common" ? commonKeys.size : new Set(props.capabilityBindings.filter(b => b.providerId === view && b.enabled && b.showInPicker).map(b => b.modelId)).size} 个已激活</span>{pageCount > 1 ? <div className="flex items-center gap-3"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className={button}>上一页</button><span>{currentPage} / {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className={button}>下一页</button></div> : <span>只有已激活的模型可用于生成与对话</span>}</footer>
      </>}
    </main>

    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open) closeConnection(); }}><DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-y-auto" onPointerDownOutside={e => e.preventDefault()} showCloseButton={!busy}><DialogHeader><DialogTitle>{draft?.id ? "编辑服务连接" : "添加服务"}</DialogTitle><DialogDescription>填写服务提供的 API 地址和密钥，保存后自动连接。</DialogDescription></DialogHeader>{draft && <form onSubmit={e => { e.preventDefault(); void saveDraft(); }} className="space-y-4">
      {!draft.id && <div className="flex flex-wrap gap-2">{SERVICE_PRESETS.map(template => <button type="button" key={template.label} className={button} disabled={busy} onClick={() => updateDraft({ baseUrl: template.url, type: template.type as ModelConnection["type"], name: template.label === "自定义服务" ? "" : template.label })}>{template.label}</button>)}</div>}
      <div><label htmlFor="connection-url" className="mb-2 block text-xs font-medium">API 地址</label><input id="connection-url" autoFocus autoComplete="off" spellCheck={false} className={field} value={draft.baseUrl} disabled={busy} placeholder="例如 https://api.example.com/v1" aria-invalid={formError?.field === "baseUrl"} onChange={e => { const url = e.target.value; let type: ModelConnection["type"] = "custom"; if (/grsai|dakka/i.test(url)) type = "grsai"; else if (/yunwu|wlai/i.test(url)) type = "yunwu"; else if (/codiaz/i.test(url)) type = "codiaz"; else if (/codia\.ai/i.test(url)) type = "codia"; updateDraft({ baseUrl: url, type }); }}/><p className="mt-1.5 text-[11px] text-muted-foreground">使用服务商提供的接口地址，通常与网站首页不同。</p>{formError?.field === "baseUrl" && <p role="alert" className="mt-2 text-xs text-destructive">{formError.message}</p>}</div>
      <div><label htmlFor="connection-key" className="mb-2 block text-xs font-medium">API Key</label><div className="relative"><input id="connection-key" autoComplete="off" spellCheck={false} className={`${field} pr-12`} type={showKey ? "text" : "password"} value={draft.apiKeyLocal} disabled={busy} placeholder="粘贴你的密钥；本地服务可留空" aria-invalid={formError?.field === "apiKeyLocal"} onChange={e => updateDraft({ apiKeyLocal: e.target.value })}/><button type="button" className="absolute right-3 top-3 text-muted-foreground" aria-label={showKey ? "隐藏密钥" : "显示密钥"} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>{formError?.field === "apiKeyLocal" && <p role="alert" className="mt-2 text-xs text-destructive">{formError.message}</p>}</div>
      <div><label htmlFor="connection-name" className="mb-2 block text-xs font-medium">名称 <span className="font-normal text-muted-foreground">可选</span></label><input id="connection-name" className={field} value={draft.name} disabled={busy} placeholder="自动使用服务域名，也可以自己命名" onChange={e => updateDraft({ name: e.target.value })}/></div>
      {SERVICE_PRESETS.find(p => p.url && p.url === draft.baseUrl)?.hint && <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">{SERVICE_PRESETS.find(p => p.url === draft.baseUrl)?.hint}</p>}

      {formError && !formError.field && <p role="alert" className="rounded-lg bg-muted p-3 text-xs leading-6">{formError.message}{savedDraftId && health[savedDraftId]?.state === "error" && <span className="block">{health[savedDraftId].message}</span>}</p>}
      {confirmDiscard ? <div className="rounded-lg border border-border p-3 text-xs"><p>还有未保存的填写内容，是否放弃？</p><div className="mt-3 flex justify-end gap-2"><button className={button} type="button" onClick={() => setConfirmDiscard(false)}>继续填写</button><button className={button} type="button" onClick={() => { setDraft(null); setConfirmDiscard(false); }}>放弃填写</button></div></div> : <DialogFooter><button className={button} type="button" disabled={busy} onClick={closeConnection}>{savedDraftId ? "稍后设置" : "取消"}</button><button type="submit" className={primary} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin"/> : null}{busy ? "正在保存并连接…" : savedDraftId ? "重试连接" : "保存并连接"}</button></DialogFooter>}
    </form>}</DialogContent></Dialog>

    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="sm:max-w-[540px] max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle className="break-all leading-6">{detail?.model.displayName || detail?.model.id}</DialogTitle><DialogDescription>{detail?.provider.name} · 模型详情</DialogDescription></DialogHeader>{detail && <div className="space-y-5 text-sm"><div><span className="text-xs text-muted-foreground">模型 ID</span><div className="mt-2 flex items-start gap-3 rounded-lg bg-muted p-3"><code className="min-w-0 flex-1 break-all text-xs">{detail.model.id}</code><button aria-label="复制模型 ID" onClick={() => { void navigator.clipboard.writeText(detail.model.id).then(() => setNotice("模型 ID 已复制。")); }}><Copy size={14}/></button></div></div><p className="text-xs text-muted-foreground">这里只检查连接与模型目录，不验证实际调用；激活模型后可在对应工作区使用。</p>{detail.model.description && <p className="text-sm leading-6">{detail.model.description}</p>}{!isCatalog(detail.model) && detail.provider.type !== "codia" && <div className="space-y-3"><div className="flex items-center justify-between"><span>激活模型</span><Switch className="active-model-switch" aria-label="详情中激活模型" checked={commonKeys.has(modelConnectionKey(detail.provider.id, detail.model.id))} disabled={busy} onCheckedChange={value => void setCommon([detail], value)}/></div>{props.capabilityBindings.filter(b => b.providerId === detail.provider.id && b.modelId === detail.model.id && b.enabled && b.showInPicker && b.capability !== "imageTool" && b.capability !== "reasoning").map(binding => <div key={binding.capability} className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{MODEL_USE_LABELS[binding.capability]}</span><button className={button} disabled={busy || binding.isDefault} onClick={() => void setDefault(detail, binding.capability)}>{binding.isDefault ? <><Check size={13}/>已是默认</> : "设为默认"}</button></div>)}</div>}<details open={props.getCategory(detail.provider, detail.model) === "unknown"} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs text-muted-foreground">用途与高级信息</summary><p className="my-3 text-xs leading-5 text-muted-foreground">用途根据服务信息与名称识别。如有误，可按服务商文档纠正。</p><NeutralSelect aria-label="确认模型用途" value={props.getCategory(detail.provider, detail.model)} disabled={busy} onChange={e => { const value = e.target.value as ModelKind; try { const key = kindOverrideKey(detail.provider.baseUrl); const overrides = JSON.parse(localStorage.getItem(key) || "{}"); localStorage.setItem(key, JSON.stringify({ ...overrides, [detail.model.id]: value })); setRevision(n => n + 1); if (commonKeys.has(modelConnectionKey(detail.provider.id, detail.model.id))) void setCommon([detail], true); } catch { setNotice("用途未能保存，请重试。"); } }} className={field}>{Object.entries(MODEL_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NeutralSelect><div className="mt-4 space-y-2 break-all text-xs text-muted-foreground"><p>服务：{detail.provider.name}</p>{detail.model.supplierName && <p>供应商：{detail.model.supplierName}</p>}{detail.model.endpoint && <p>接口：{detail.model.endpoint}</p>}{detail.model.tags?.length ? <p>标签：{detail.model.tags.join("、")}</p> : null}</div></details></div>}</DialogContent></Dialog>
    <Dialog open={manual} onOpenChange={setManual}><DialogContent><DialogHeader><DialogTitle>手动添加模型</DialogTitle><DialogDescription>填写服务商提供的准确模型 ID，不会自动发起付费调用。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); void addManual(); }}><label className="block space-y-2 text-xs">模型 ID<input autoFocus className={field} value={manualId} onChange={e => setManualId(e.target.value)} placeholder="例如 gpt-image-2" required/></label><label className="block space-y-2 text-xs">用途<NeutralSelect className={field} value={manualKind} onChange={e => setManualKind(e.target.value as ModelKind)}>{Object.entries(MODEL_KIND_LABELS).filter(([key]) => key !== "unknown").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NeutralSelect></label><DialogFooter><button type="button" className={button} onClick={() => setManual(false)}>取消</button><button type="submit" className={primary} disabled={busy || !manualId.trim()}>添加模型</button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={Boolean(remove)} onOpenChange={open => { if (!open && !busy) setRemove(null); }}><DialogContent><DialogHeader><DialogTitle>移除「{remove?.name}」？</DialogTitle><DialogDescription>将移除此服务的连接和激活模型设置。项目、图片与已发出的任务会保留。若专用工具使用了此连接，需要在工具中重新选择服务。</DialogDescription></DialogHeader><DialogFooter><button className={button} disabled={busy} onClick={() => setRemove(null)}>取消</button><button className={`${primary} bg-destructive text-white hover:bg-destructive/90`} disabled={busy} onClick={() => void deleteConnection()}>移除连接</button></DialogFooter></DialogContent></Dialog>
  </div>;
}
