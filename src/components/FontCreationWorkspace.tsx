/* eslint-disable @next/next/no-img-element -- immutable local assets have pre-generated previews */
'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Download, FolderPlus, ImagePlus, LibraryBig, ListChecks, Loader2, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Sparkles, Trash2, Type, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import NeutralSelect from '@/components/ui/neutral-select';
import { consumeDoubleArrowUp } from '@/lib/composer-recall';
import { ResolutionPicker } from '@/components/ui/motif/resolution-picker';
import FontResultCard from '@/components/creation/FontResultCard';
import { ModelPicker, ParameterButton, ParameterChoices, RatioPicker } from '@/components/creation/CreationControls';
import { ResizableComposerDock } from '@/components/creation/ResizableComposerDock';
import { Attachment } from '@/components/ui/motif/attachment';
import { useInfiniteFontList } from '@/lib/use-infinite-font-list';
import { previewImageUrl } from '@/lib/image-preview';
import { compileFontCreation, fontReferenceCandidates, styleFromCard, withFontStyleInput } from '@/lib/font-creation-types';
import type { FontCreationSession, FontCreationSettings, FontSessionSummary, FontCreationDraft, FontActiveStyle, FontCreationRun } from '@/lib/font-creation-types';
import type { FontSummary, FontUseRequest, FontFile } from '@/lib/font-library-types';
import { preferredImageQuality, preferredImageResolution, type ImageParameterOption } from '@/lib/image-generation-defaults';
import { getReferenceImageLimitForModel } from '@/lib/image-edit/reference-constants';

type Props = { authHeaders: Record<string, string>; initialSettings: FontCreationSettings; models: { value: string; label: string }[]; getModelControls: (model:string,ratio:string)=>{qualities:ImageParameterOption[];resolutions:ImageParameterOption[];pixelModel:boolean}; resolveModel: (model: string) => { modelId: string; apiKey: string; baseUrl: string }; pendingStyle?: { id: string; request: FontUseRequest } | null; onStyleHandled: () => void; onLibrary: () => void };
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 disabled:pointer-events-none';
const primary = button + ' bg-foreground text-background hover:bg-foreground/85 border-transparent';
const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
const draftKey = (id: string) => `hz_font_creation_recovery_${id}`;

export default function FontCreationWorkspace(props: Props) {
  const propsRef = useRef(props); propsRef.current = props;
  const [session, setSession] = useState<FontCreationSession | null>(null), [sessions, setSessions] = useState<FontSessionSummary[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false);
  const [sidebar, setSidebar] = useState(true), [picker, setPicker] = useState(false);
  const [styleDetails, setStyleDetails] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const recalledInputScopesRef=useRef(new Set<string>());
  const composingInputRef=useRef(false);
  const recallPressRef=useRef<number|null>(null),lastSentRef=useRef(new Map<string,{text:string;references:FontCreationDraft["userReferences"]}>());
  const composerRef=useRef<HTMLDivElement>(null), centerRef=useRef<HTMLDivElement>(null);
  // The overlay never partitions the canvas. Reserve exactly its live height at the scroll end.
  useLayoutEffect(()=>{const dock=composerRef.current,center=centerRef.current;if(!dock||!center)return;const update=()=>center.style.setProperty('--font-composer-height',`${Math.ceil(dock.getBoundingClientRect().height)}px`);update();const observer=new ResizeObserver(update);observer.observe(dock);return()=>observer.disconnect();},[loading,session?.id]);
  const [cardQuery, setCardQuery] = useState('');
  const [selection, setSelection] = useState<{ style: FontActiveStyle; request: FontUseRequest; selected: string[]; limit: number; token: number } | null>(null);
  const [preview, setPreview] = useState<FontFile | null>(null), [exportRun, setExportRun] = useState<FontCreationRun | null>(null), [projects, setProjects] = useState<{ id: string; name: string }[]>([]), [exportProject, setExportProject] = useState('');
  const sessionRef = useRef<FontCreationSession | null>(null), dirty = useRef(0), persisted = useRef(0), serial = useRef(Promise.resolve()), scope = useRef(0), selectionSequence = useRef(0), stylePending = useRef<string | null>(null), creating = useRef(false), inputRevision = useRef(0), uploadRef = useRef<HTMLInputElement>(null);
  const conflictRef = useRef(false); const [visibleRuns, setVisibleRuns] = useState(40);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]), [selectionMode, setSelectionMode] = useState(false);
  const selectionAnchor = useRef<string | null>(null), resultsRef = useRef<HTMLElement>(null);
  const [detailRun, setDetailRun] = useState<FontCreationRun | null>(null);
  const [collectingRuns, setCollectingRuns] = useState<string[]>([]), [collectionError, setCollectionError] = useState('');
  const collectingRunsRef = useRef(new Set<string>());
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [removedRuns, setRemovedRuns] = useState<Array<{ sessionId: string; runIds: string[] }>>([]);
  const [changingRun, setChangingRun] = useState(false);
  const changingRunRef = useRef(false), runsVersion = useRef(0);
  const [submitting, setSubmitting] = useState(false), [selecting, setSelecting] = useState(false);
  const api = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { ...propsRef.current.authHeaders, ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
    const data = await response.json(); if (!response.ok) { const e = new Error(data.error || '操作失败') as Error & { status: number }; e.status = response.status; if(response.status === 409) { conflictRef.current = true; setConflict(true); } throw e; } return data;
  }, []);
  const adopt = useCallback((next: FontCreationSession) => { sessionRef.current = next; setSession(next); }, []);
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => { const result = serial.current.then(task); serial.current = result.then(() => {}, () => {}); return result; }, []);
  const recover = (s: FontCreationSession) => { try { const raw = localStorage.getItem(draftKey(s.id)); const saved = raw ? JSON.parse(raw) : null; if (saved?.baseRevision === s.revision && saved.styleRevision === (s.activeStyle?.revision || null)) { s = { ...s, draft: saved.draft }; dirty.current++; setNotice('已恢复上次未完成保存的输入'); } else if (saved) { conflictRef.current = true; setConflict(true); setError('另一个窗口更新过此设计，本机未保存的完整草稿已保留。可下载恢复副本后重新载入。'); } } catch { /* keep server version */ } return s; };
  const backup = (s: FontCreationSession) => { try { localStorage.setItem(draftKey(s.id), JSON.stringify({ baseRevision: s.revision, styleRevision: s.activeStyle?.revision || null, draft: s.draft })); } catch { setError('本机恢复空间不足，请保持此窗口打开，等待草稿保存成功'); } };
  const edit = (fn: (draft: FontCreationDraft) => FontCreationDraft) => { const current = sessionRef.current; if (!current) return; const next = { ...current, draft: fn(current.draft) }; dirty.current++; adopt(next); backup(next); };
  const saveDraft = useCallback(async () => {
    if(conflictRef.current) throw new Error('此设计已被其他窗口更新，请先下载恢复副本并重新载入');
    const current = sessionRef.current; if (!current || dirty.current === persisted.current) return current;
    const ticket = dirty.current, id = current.id; setSaving(true);
    try { const data = await api('/api/font-creation/sessions', { method: 'PATCH', body: JSON.stringify({ id, revision: current.revision, draft: current.draft, styleRevision: current.activeStyle?.revision || null }) });
      if (sessionRef.current?.id === id) { persisted.current = ticket; const latest = sessionRef.current; const merged = { ...data.session, draft: dirty.current > ticket ? latest.draft : data.session.draft }; adopt(merged); if (dirty.current === ticket) localStorage.removeItem(draftKey(id)); else backup(merged); }
      return data.session as FontCreationSession;
    } catch (e) { if ((e as { status?: number }).status === 409) setConflict(true); throw e; } finally { setSaving(false); }
  }, [adopt, api]);
  const refreshList = useCallback(async () => { const data = await api('/api/font-creation/sessions'); setSessions(data.sessions); return data.sessions as FontSessionSummary[]; }, [api]);
  const load = useCallback(async (id: string) => { const token = ++scope.current; selectionSequence.current++; setLoading(true); setSelection(null); conflictRef.current = false; setConflict(false); setError(''); setVisibleRuns(40); setSelectedRunIds([]); setSelectionMode(false); selectionAnchor.current = null; setDetailRun(null); setRemovedRuns([]); runsVersion.current++; dirty.current = 0; persisted.current = 0; try { const data = await api(`/api/font-creation/sessions?id=${id}`); if (token !== scope.current) return; adopt(recover(data.session)); localStorage.setItem('hz_last_font_creation', id); } catch (e) { setError((e as Error).message); } finally { if (token === scope.current) setLoading(false); } }, [api, adopt]);
  useEffect(() => { let live = true; void (async () => { try { const list = await refreshList(); if (!live) return; const last = localStorage.getItem('hz_last_font_creation'); const id = list.find(s => s.id === last)?.id || list[0]?.id; if (id) await load(id); else { const data = await api('/api/font-creation/sessions', { method: 'POST', body: JSON.stringify({ settings: propsRef.current.initialSettings }) }); if (live) { adopt(data.session); localStorage.setItem('hz_last_font_creation', data.session.id); await refreshList(); setLoading(false); } } } catch (e) { if (live) { setError((e as Error).message); setLoading(false); } } })(); return () => { live = false; }; }, [adopt, api, load, refreshList]);
  useEffect(() => { if (!session || conflict || dirty.current === persisted.current) return; const timer = setTimeout(() => { void enqueue(saveDraft).catch(e => setError(e.message)); }, 450); return () => clearTimeout(timer); }, [session, conflict, enqueue, saveDraft]);
  const hasActiveRuns = session?.runs.some(run => ['queued','running'].includes(run.status)) || false;
  useEffect(() => { const id = session?.id; if (!id || !hasActiveRuns) return; let active = true, polling = false; const poll = async () => { if (polling || document.hidden) return; polling = true; try { const version = runsVersion.current; const data = await api(`/api/font-creation/sessions?id=${id}`); if (active && !changingRunRef.current && version === runsVersion.current && sessionRef.current?.id === id) adopt({ ...sessionRef.current, runs: data.session.runs }); } catch { /* keep editable draft during transient errors */ } finally { polling = false; } }; const timer = setInterval(poll, 1500); return () => { active = false; clearInterval(timer); }; }, [session?.id, hasActiveRuns, api, adopt]);
  const styleListing = useInfiniteFontList<FontSummary>(JSON.stringify([cardQuery, picker, sidebar]), libraryRevision, !loading && (sidebar || picker), async (page, signal) => {
    const data = await api(`/api/font-library?${new URLSearchParams({ q: cardQuery, page: String(page) })}`, { signal });
    return { items: data.cards, total: data.total, pageSize: data.pageSize };
  });
  const { items: cards, loading: cardLoading } = styleListing;

  const commitStyle = useCallback(async (request: FontUseRequest, prepared: FontActiveStyle, token: number, selected?: string[]) => {
    await enqueue(async () => {
      if (token !== selectionSequence.current) return; await saveDraft(); const current = sessionRef.current; if (!current || token !== selectionSequence.current) return;
      const data = await api('/api/font-creation/sessions', { method: 'PATCH', body: JSON.stringify({ id: current.id, revision: current.revision, action: 'style', cardId: prepared.cardId, mode: prepared.mode === 'image' ? 'image' : 'recipe', prompt: prepared.prompt, styleRevision: prepared.revision, actualModel: propsRef.current.resolveModel(current.draft.settings.model).modelId, selectedIds: selected, useSize: request.useSize }) });
      if (current.id !== sessionRef.current?.id) return; const latest = sessionRef.current; const next = { ...data.session, draft: { ...data.session.draft, userText: latest.draft.userText === current.draft.userText ? data.session.draft.userText : withFontStyleInput(latest.draft, data.session.draft.stylePrompt).userText, userReferences: latest.draft.userReferences, settings: request.useSize ? { ...latest.draft.settings, size: data.session.draft.settings.size } : latest.draft.settings } };
      adopt(next); if (dirty.current !== persisted.current) backup(next); setSelection(null); setPicker(false); setNotice('');
      void api('/api/font-library', { method: 'PATCH', body: JSON.stringify({ id: prepared.cardId, action: 'used' }) }).catch(() => {});
    });
  }, [adopt, api, enqueue, saveDraft]);
  const choose = useCallback(async (requestOrId: FontUseRequest | string) => {
    const token = ++selectionSequence.current; const sessionId = sessionRef.current?.id; if (!sessionId) return; setSelecting(true); setError('');
    try {
      const request: FontUseRequest = typeof requestOrId === 'string' ? { card: await api(`/api/font-library?id=${requestOrId}`), mode: 'append' } : requestOrId;
      await serial.current;
      if (token !== selectionSequence.current || sessionRef.current?.id !== sessionId) return;
      const current = sessionRef.current!; if (current.activeStyle?.cardId === request.card.id && current.activeStyle.mode === (request.mode === 'image' ? 'image' : 'recipe')) { if (current.activeStyle.mode === 'recipe' && (!current.draft.stylePromptInInput || !current.draft.userText.trim())) await commitStyle(request, current.activeStyle, token); setPicker(false); return; }
      const style = styleFromCard(request.card, request.mode, crypto.randomUUID()); const draft = { ...withFontStyleInput(current.draft, style.mode === 'image' ? '' : style.prompt), excludedReferenceIds: [] };
      const candidates = fontReferenceCandidates(style, draft); const limit = getReferenceImageLimitForModel(propsRef.current.resolveModel(current.draft.settings.model).modelId);
      if (compileFontCreation(style, draft).files.length > limit) { setSelection({ style, request, selected: candidates.filter(c => !c.file.missing).map(c => c.id), limit, token }); return; }
      await commitStyle(request, style, token);
    } catch (e) { setError((e as Error).message); } finally { if (token === selectionSequence.current) setSelecting(false); }
  }, [api, commitStyle]);
  useEffect(() => { const pending = props.pendingStyle; if (!pending || loading || !session?.id || stylePending.current === pending.id) return; stylePending.current = pending.id; void choose(pending.request).finally(() => propsRef.current.onStyleHandled()); }, [props.pendingStyle, loading, session?.id, choose]);
  const command = (action: string) => { selectionSequence.current++; setSelection(null); void enqueue(async () => { await saveDraft(); const current = sessionRef.current; if (!current) return; const data = await api('/api/font-creation/sessions', { method: 'PATCH', body: JSON.stringify({ id: current.id, revision: current.revision, action: 'style', styleAction: action, actualModel: propsRef.current.resolveModel(current.draft.settings.model).modelId }) }); const latest = sessionRef.current; if (latest?.id === current.id) { const merged = { ...data.session, draft: { ...data.session.draft, userText: withFontStyleInput(latest.draft, data.session.draft.stylePrompt).userText, stylePromptInInput: true, userReferences: latest.draft.userReferences, settings: latest.draft.settings } }; adopt(merged); if(dirty.current!==persisted.current)backup(merged); setNotice(action === 'undo' ? '已恢复上一个风格，个人要求保留' : '已移除风格，个人要求保留'); } }).catch(e => setError(e.message)); };
  const switchSession = async (id?: string) => { if (creating.current) return; creating.current = true; selectionSequence.current++; setSelection(null); try { await enqueue(saveDraft); if (id) await load(id); else { const data = await api('/api/font-creation/sessions', { method: 'POST', body: JSON.stringify({ settings: propsRef.current.initialSettings }) }); await refreshList(); await load(data.session.id); } } catch (e) { setError((e as Error).message); } finally { creating.current = false; } };
  const leave = () => { selectionSequence.current++; void enqueue(saveDraft).then(() => propsRef.current.onLibrary()).catch(e => setError(e.message)); };
  const generate = () => { const id = sessionRef.current?.id; if (!id || submitting || conflictRef.current || !sessionRef.current?.draft.userText.trim()) return; setSubmitting(true); setError(''); void enqueue(async () => { const current = await saveDraft(); if(!current || current.id !== id) return; const route = propsRef.current.resolveModel(current.draft.settings.model); const compiled = compileFontCreation(current.activeStyle, current.draft); if (compiled.files.length > getReferenceImageLimitForModel(route.modelId)) throw new Error('参考图超过当前模型上限，请在输入区取消不需要的图片');
    for (let i = 0; i < current.draft.settings.count; i++) { const requestId = crypto.randomUUID(); const body = { sessionId: id, revision: current.revision, requestId, model: route.modelId, apiKey: route.apiKey, baseUrl: route.baseUrl }; const submit = () => api('/api/font-creation/generate', { method: 'POST', body: JSON.stringify(body) }); try { await submit(); } catch (error) { if ((error as { status?: number }).status) throw error; await submit(); } if(i===0){lastSentRef.current.set(id,{text:current.draft.userText,references:structuredClone(current.draft.userReferences)});recalledInputScopesRef.current.delete(id);recallPressRef.current=null;} }
    const data = await api(`/api/font-creation/sessions?id=${id}`); if (sessionRef.current?.id === id) adopt({ ...sessionRef.current, runs: data.session.runs }); setNotice('');
  }).catch(e => setError(e.message)).finally(() => setSubmitting(false)); };
  const upload = async (files: FileList) => { const revision = inputRevision.current; const id = sessionRef.current?.id; if (!id) return; for (const file of Array.from(files)) { try { const form = new FormData(); form.append('sessionId', id); form.append('file', file); const data = await api('/api/font-creation/sessions', { method: 'POST', body: form }); if (sessionRef.current?.id === id && inputRevision.current === revision) edit(d => { if (d.userReferences.length >= 16) throw new Error('个人参考图最多16张'); return { ...d, userReferences: [...d.userReferences, data.file] }; }); } catch (e) { setError((e as Error).message); } } };
  const startExport = async (run: FontCreationRun) => { try { const data = await api('/api/projects'); setProjects(data.projects); setExportProject(data.projects[0]?.id || ''); setExportRun(run); } catch (e) { setError((e as Error).message); } };
  const cancel = async (run: FontCreationRun) => { try { if (!run.jobId) throw new Error('任务正在提交，请稍后再按删除键'); const result = await api(`/api/generation-jobs?id=${encodeURIComponent(run.jobId)}`, { method: 'DELETE' }); if (!result.success) throw new Error('取消未成功，请稍后重试'); const current = sessionRef.current!; const data = await api(`/api/font-creation/sessions?id=${current.id}`); if(sessionRef.current?.id === current.id) adopt({ ...sessionRef.current, runs: data.session.runs }); } catch (e) { setError((e as Error).message); } };
  const changeRunVisibility = async (runIds: string[], restore = false) => {
    const id = sessionRef.current?.id;
    if (!id || !runIds.length || changingRunRef.current) return;
    changingRunRef.current = true; setChangingRun(true); runsVersion.current++;
    try {
      await enqueue(async () => {
        const data = await api('/api/font-creation/sessions', { method: 'PATCH', body: JSON.stringify({ id, runIds, action: restore ? 'restore-runs' : 'delete-runs' }) });
        runsVersion.current++;
        if (sessionRef.current?.id !== id) return;
        adopt({ ...sessionRef.current, runs: data.session.runs });
        setSelectedRunIds(previous => previous.filter(runId => !runIds.includes(runId)));
        selectionAnchor.current = null;
        setRemovedRuns(previous => restore ? previous.slice(0, -1) : [...previous, { sessionId: id, runIds }]);
        resultsRef.current?.focus({ preventScroll: true });
      });
    } catch (error) { setError((error as Error).message); }
    finally { changingRunRef.current = false; setChangingRun(false); }
  };
  const collectResult = async (run: FontCreationRun) => {
    const sessionId = sessionRef.current?.id;
    if (!sessionId || !run.result || run.status !== 'completed' || collectingRunsRef.current.has(run.id)) return;
    collectingRunsRef.current.add(run.id); setCollectingRuns([...collectingRunsRef.current]); setCollectionError('');
    try {
      const data = await api('/api/font-library', { method: 'POST', body: JSON.stringify({ action: 'collect-font', sessionId, runId: run.id }) });
      window.dispatchEvent(new Event('hz-font-library-changed'));
      setLibraryRevision(value => value + 1);
      if (sessionRef.current?.id === sessionId) {
        setNotice(data.duplicate ? '这张作品已在字体库中' : '已添加到字体库，生成要求、参考图和参数一并保存');
        setDetailRun(current => current?.id === run.id ? null : current);
      }
    } catch (error) {
      if (sessionRef.current?.id === sessionId) { setError((error as Error).message); setCollectionError((error as Error).message); }
    } finally { collectingRunsRef.current.delete(run.id); setCollectingRuns([...collectingRunsRef.current]); }
  };
  const referenceResult = (run: FontCreationRun) => {
    const result = run.result, current = sessionRef.current;
    if (!result || !current) return;
    if (current.draft.userReferences.length >= 16 && !current.draft.userReferences.some(ref => ref.key === result.key)) { setError('个人参考图最多16张'); return; }
    edit(draft => ({ ...draft, userReferences: draft.userReferences.some(ref => ref.key === result.key) ? draft.userReferences : [...draft.userReferences, { ...result, role: 'reference', referenceId: crypto.randomUUID(), label: '我的字体作品' }] }));
    setNotice('已添加到个人参考图');
  };
  const resultRuns = session?.runs.filter(run => !run.deletedAt) || [];
  const displayedRuns = [...resultRuns].reverse().slice(0, visibleRuns);
  const selectableIds = displayedRuns.filter(run => !['queued', 'running'].includes(run.status)).map(run => run.id);
  const selectedIds = selectedRunIds.filter(id => selectableIds.includes(id));
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const clearRunSelection = () => { setSelectedRunIds([]); setSelectionMode(false); selectionAnchor.current = null; };
  const selectRun = (id: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (changingRunRef.current || !selectableIds.includes(id)) return;
    setSelectionMode(true);
    const anchor = selectionAnchor.current;
    if (event.shiftKey && anchor && selectableIds.includes(anchor)) {
      const start = selectableIds.indexOf(anchor), end = selectableIds.indexOf(id);
      const range = selectableIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      setSelectedRunIds(previous => event.metaKey || event.ctrlKey ? [...new Set([...previous, ...range])] : range);
    } else {
      setSelectedRunIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
      selectionAnchor.current = id;
    }
  };
  const handleResultsKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]')) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation();
      if (!changingRunRef.current) { setSelectionMode(true); setSelectedRunIds(selectableIds); selectionAnchor.current = selectableIds[0] || null; }
    } else if (command && !event.shiftKey && event.key.toLowerCase() === 'z' && removedRuns.length) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void changeRunVisibility(removedRuns[removedRuns.length - 1].runIds, true);
    } else if (event.key === 'Escape' && selectionMode) {
      event.preventDefault(); event.stopPropagation();
      if (!changingRunRef.current) clearRunSelection();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectionMode) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void changeRunVisibility(selectedIds);
    }
  };
  const lastRemoved = removedRuns.at(-1);
  const styleList = <div className="flex h-full min-h-0 flex-col"><label className="m-3 flex items-center gap-2 rounded-lg border border-border px-3"><Search size={14}/><input aria-label="搜索字体风格" className="h-9 min-w-0 w-full bg-transparent text-xs outline-none" placeholder="搜索风格" value={cardQuery} onChange={e => { setCardQuery(e.target.value); }}/></label><div ref={styleListing.rootRef} className="min-h-0 flex-1 overflow-auto px-3 pb-3">{cardLoading && <p className="text-xs text-muted-foreground">正在读取…</p>}{cards.map(card => <button key={card.id} onClick={() => void choose(card.id)} className={`mb-3 block w-full overflow-hidden rounded-lg border text-left ${session?.activeStyle?.cardId === card.id ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40'}`} aria-label={`使用风格 ${card.title}`} aria-pressed={session?.activeStyle?.cardId === card.id}><img src={previewImageUrl(card.cover.url, 256)} alt={card.title} className="aspect-[16/10] w-full object-contain bg-muted/25 p-1.5" loading="lazy" decoding="async"/><span className="flex items-center justify-between gap-2 p-2 text-xs"><span className="truncate">{card.title}</span>{session?.activeStyle?.cardId === card.id && <Check size={12}/>}</span></button>)}{!cards.length && !cardLoading && <p className="py-8 text-center text-xs text-muted-foreground">暂无匹配风格，可在字体库上传。</p>}<div ref={styleListing.sentinelRef} className="flex min-h-10 items-center justify-center gap-2 py-3 text-xs text-muted-foreground" role="status">{styleListing.loadingMore ? <><Loader2 size={12} className="animate-spin"/>正在加载更多…</> : styleListing.error ? <button className="underline" onClick={styleListing.retry}>加载失败，点击重试</button> : cards.length ? styleListing.hasMore ? '向下滚动加载更多' : '已显示全部风格' : null}</div></div></div>;
  const active = session?.activeStyle; const candidates = session ? fontReferenceCandidates(active || null, session.draft) : [];
  const modelControls=props.getModelControls(session?.draft.settings.model||props.initialSettings.model,session?.draft.settings.size||'16:9');
  const styleRegion=session&&active?<section className="font-style-region" aria-label="本次字体风格" aria-busy={selecting}>
            <div className="font-style-card">
              <button type="button" className="font-style-open" onClick={()=>setStyleDetails(true)} aria-label={`查看当前字体风格 ${active.title}`} title={active.title}>
                <img src={previewImageUrl(active.cover.url,128)} alt="" className="font-style-cover"/>
                <span className="min-w-0 text-left"><span className="block truncate text-xs font-medium">{active.title}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{active.mode==='image'?'字体风格参考':`字体风格 · ${active.references.length ? `含 ${active.references.length} 张原参考图` : '含提示词'}`}</span></span>
              </button>
              <div className="font-style-actions">
                {active.mode==='recipe'&&<button type="button" className="font-style-action" aria-label="编辑已带入的风格提示词" onClick={()=>setStyleDetails(true)}>提示词</button>}
                <button type="button" className="font-style-action" aria-label="更换字体风格" onClick={()=>setPicker(true)}>更换</button>
                <button type="button" className="font-style-action" aria-label="移除当前风格" onClick={()=>command('remove')}><X size={13}/></button>
              </div>
            </div>
            {selecting&&<span role="status" className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 size={12} className="animate-spin"/>正在准备风格</span>}
          </section>:null;
  const composer=session?<>        <div className="motif-font-composer motif-composer"><div className="font-composer-content"><div className="font-composer-editor">
          <textarea id="font-user-text" aria-label="字体个人要求" title="Enter 生成，Shift+Enter 换行" onCompositionStart={()=>{composingInputRef.current=true;}} onCompositionEnd={()=>{composingInputRef.current=false;}} value={session.draft.userText} onChange={e => {recallPressRef.current=null;edit(d => ({ ...d, userText: e.target.value }));}} onKeyDown={e=>{if(composingInputRef.current||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;if(consumeDoubleArrowUp(e.nativeEvent,recallPressRef,!recalledInputScopesRef.current.has(session.id))){const saved=lastSentRef.current.get(session.id);const last=session.runs.at(-1);if(saved||last){e.preventDefault();recalledInputScopesRef.current.add(session.id);edit(d=>({...d,userText:saved?saved.text:last?.userPrompt||'',userReferences:saved?structuredClone(saved.references):d.userReferences}));return;}}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!e.repeat)generate();}}} placeholder="例如：文字改成“秋水长天”，黑字白底，笔画更细" className={input + ' font-composer-textarea resize-none leading-6'} maxLength={30000}/>
          {session.draft.userReferences.length>0&&<div className="font-personal-references flex flex-wrap items-center gap-2">{session.draft.userReferences.map(ref => <Attachment key={ref.referenceId} className="size-16" name={ref.label} src={previewImageUrl(ref.url,128)} onRemove={()=>edit(d=>({...d,userReferences:d.userReferences.filter(r=>r.referenceId!==ref.referenceId)}))}/>)}</div>}
          </div><input ref={uploadRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="字体个人参考文件" onChange={e => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }}/><div className="motif-creation-controls motif-composer-footer"><button className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="上传个人参考图" onClick={() => uploadRef.current?.click()}><ImagePlus size={17}/></button><ModelPicker label="字体生成模型" value={session.draft.settings.model} options={props.models} onChange={value=>edit(d=>{const c=props.getModelControls(value,'16:9');return {...d,settings:{...d.settings,model:value,size:'16:9',quality:preferredImageQuality(c.qualities),imageSize:preferredImageResolution(c.resolutions)}};})}/>
          <ParameterButton label="数量" value={`${session.draft.settings.count} 张`}><ParameterChoices label="字体生成数量" value={String(session.draft.settings.count)} options={[1,2,3,4].map(n=>({value:String(n),label:`${n} 张`}))} onChange={v=>edit(d=>({...d,settings:{...d.settings,count:Number(v)}}))}/></ParameterButton>
          <ParameterButton label="比例" value={session.draft.settings.size}><RatioPicker value={session.draft.settings.size} options={Array.from(new Set([session.draft.settings.size,'1:1','3:2','2:3','16:9','9:16','4:3','3:4']))} onChange={value=>edit(d=>{const c=props.getModelControls(d.settings.model,value);return {...d,settings:{...d.settings,size:value,imageSize:c.resolutions.some(o=>o.value===d.settings.imageSize)?d.settings.imageSize:preferredImageResolution(c.resolutions)}};})}/></ParameterButton>
          {modelControls.resolutions.length>0&&<ParameterButton label="分辨率" value={modelControls.resolutions.find(o=>o.value===session.draft.settings.imageSize)?.label.split(' · ')[0]||session.draft.settings.imageSize}><ResolutionPicker options={modelControls.resolutions.map(o=>o.value)} labels={Object.fromEntries(modelControls.resolutions.map(o=>[o.value,o.label]))} aria-label="字体生成分辨率" value={session.draft.settings.imageSize} onChange={value=>edit(d=>({...d,settings:{...d.settings,imageSize:value}}))}/></ParameterButton>}
          {candidates.length>0&&<ParameterButton label="参考图" value={`${candidates.filter(c=>!c.file.missing&&!session.draft.excludedReferenceIds.includes(c.id)).length} 张`}> <div className="mt-4 border-t border-border pt-3"><p className="mb-2 text-xs font-medium">本次参考图</p>{candidates.map(c=><label key={c.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" disabled={c.file.missing} checked={!c.file.missing&&!session.draft.excludedReferenceIds.includes(c.id)} onChange={e=>edit(d=>({...d,excludedReferenceIds:e.target.checked?d.excludedReferenceIds.filter(id=>id!==c.id):[...d.excludedReferenceIds,c.id]}))}/><span className="truncate text-xs">{c.file.label}{c.role==='user'?' · 个人':' · 风格'}</span></label>)}</div>
          </ParameterButton>}<button type="button" className="motif-composer-clear" aria-label="清空字体输入" disabled={!session.draft.userText&&!session.draft.userReferences.length} onClick={()=>{inputRevision.current++;edit(d=>({...d,userText:"",userReferences:[]}));}}>清空</button>          <button className={primary + ' font-composer-generate'} disabled={submitting || conflict || !session.draft.userText.trim()} onClick={generate}>{submitting ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}生成字体</button></div></div>

        </div></>:null;
  return <section className="font-creation relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background" aria-label="字体创作工作区">
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 shrink-0"><div className="mr-auto"><h1 className="text-base font-semibold">字体创作</h1><p className="text-[10px] text-muted-foreground">专属对话与作品，独立于普通项目</p></div><button className={button} onClick={leave}><LibraryBig size={14}/>字体库</button><NeutralSelect aria-label="字体设计会话" className={input + ' !w-40 !text-xs'} value={session?.id || ''} onChange={e => void switchSession(e.target.value)}>{sessions.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}{session && !sessions.some(s => s.id === session.id) && <option value={session.id}>{session.title}</option>}</NeutralSelect><button className={button} onClick={() => void switchSession()} disabled={loading}><Plus size={14}/>新建设计</button><button type="button" className={button} onClick={()=>setHistoryOpen(true)} aria-label="打开字体对话记录"><MessageSquare size={14}/>记录</button><span className="w-16 text-[10px] text-muted-foreground">{saving ? '正在保存…' : session ? '自动保存' : ''}</span></header>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-400/20 bg-red-500/5 px-4 py-2 text-xs text-red-500"><span className="flex-1">{error}</span>{conflict ? <><button className="underline" onClick={async () => { const raw = localStorage.getItem(draftKey(sessionRef.current!.id)); if (raw) { const saved = JSON.parse(raw); await navigator.clipboard.writeText(saved.draft.userText); setNotice('已复制本机恢复文字，完整草稿仍保存在本机'); } }}>复制恢复文字</button><button className="underline" onClick={() => { const raw = session && localStorage.getItem(draftKey(session.id)); if(raw) { const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='字体设计恢复副本.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); } }}>下载完整恢复副本</button><button className="underline" onClick={() => { if (session) { const raw=localStorage.getItem(draftKey(session.id)); if(raw) localStorage.setItem(draftKey(session.id)+'_archive_'+Date.now(),raw); localStorage.removeItem(draftKey(session.id)); void load(session.id); } }}>重新载入</button></> : <button onClick={() => { setError(''); void enqueue(saveDraft).catch(e => setError(e.message)); }} className="underline">重试保存</button>}</div>}
    {notice && <div role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] text-muted-foreground"><Check size={13}/><span className="flex-1">{notice}</span><button onClick={() => setNotice('')} aria-label="关闭字体提示"><X size={13}/></button></div>}
    {loading ? <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><span className="flex gap-2"><Loader2 size={16} className="animate-spin"/>正在打开字体设计…</span></div> : !session ? <div className="p-8 text-sm">无法打开字体设计。<button className={button} onClick={() => void switchSession()}>新建设计</button></div> : <>
    <div className="flex items-center gap-2 border-b border-border p-2 shrink-0"><span className="hidden xl:inline-flex"><button className={button} onClick={() => setSidebar(v => !v)}>{sidebar ? <PanelLeftClose size={14}/> : <PanelLeftOpen size={14}/>}字体风格</button></span><span className="xl:hidden"><button className={button} onClick={() => setPicker(true)}>选择风格</button></span><input aria-label="字体设计名称" className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none" defaultValue={session.title} key={session.id} onBlur={e => { const title = e.target.value; void enqueue(async () => { await saveDraft(); const current = sessionRef.current; if (!current) return; const ticket = dirty.current; const data = await api('/api/font-creation/sessions', { method: 'PATCH', body: JSON.stringify({ id: current.id, revision: current.revision, styleRevision: current.activeStyle?.revision || null, draft: current.draft, title }) }); if(sessionRef.current?.id === current.id) { const next = {...data.session, draft: dirty.current > ticket ? sessionRef.current.draft : data.session.draft}; adopt(next); if(dirty.current > ticket) backup(next); } await refreshList(); }).catch(e => setError(e.message)); }}/></div>
    <div className="font-creation-body flex min-h-0 flex-1">
      {sidebar && !picker && <aside className="hidden w-48 shrink-0 border-r border-border xl:block" aria-label="风格选择区">{styleList}</aside>}
      <div ref={centerRef} className="font-creation-center relative min-h-0 min-w-0 flex-1"><main ref={resultsRef} tabIndex={-1} onKeyDown={handleResultsKeyDown} className="font-results-scroll h-full min-h-0 min-w-0 overflow-y-auto p-5" aria-label="字体生成作品">
        <div className="font-results-toolbar mb-5 flex flex-wrap items-center gap-2" aria-label="作品管理" aria-busy={changingRun}>
          <h2 className="mr-auto flex items-center gap-3 text-sm font-medium">作品<span className="text-xs font-normal text-muted-foreground">{resultRuns.filter(run => run.status === 'completed').length} 张</span></h2>
          {selectionMode ? <>
            <span role="status" className="text-xs text-muted-foreground">已选 {selectedIds.length} 项</span>
            <button type="button" className={button} disabled={changingRun || !selectableIds.length} onClick={() => { setSelectedRunIds(allSelected ? [] : selectableIds); selectionAnchor.current = null; }} title="仅选择已加载的作品，跳过生成中的任务">{allSelected ? '取消全选' : '全选已加载'}</button>
            <button type="button" className={button + ' text-destructive'} disabled={changingRun || !selectedIds.length} onClick={() => void changeRunVisibility(selectedIds)}><Trash2 size={14}/>{changingRun ? '正在处理…' : `删除${selectedIds.length ? `（${selectedIds.length}）` : ''}`}</button>
            <button type="button" className={button} disabled={changingRun} onClick={clearRunSelection}>完成</button>
          </> : <button type="button" className={button} disabled={!selectableIds.length || changingRun} onClick={() => setSelectionMode(true)}><ListChecks size={14}/>多选</button>}
        </div>
        {!resultRuns.length ? <div className="font-creation-empty flex flex-col items-center justify-center text-center"><Type size={38} strokeWidth={1} className="mb-4 text-muted-foreground"/><h3 className="text-base font-medium">从一种字形，开始新的设计</h3><p className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">选择风格，在下方写下目标文字和要求。</p></div> : <div className="font-result-grid">{displayedRuns.map(run => (
          <FontResultCard key={run.id} run={run} selected={selectedIds.includes(run.id)} selectionMode={selectionMode} busy={changingRun} onSelect={event => selectRun(run.id, event)} onOpen={() => { setCollectionError(''); setDetailRun(run); }} onCollect={() => void collectResult(run)} collecting={collectingRuns.includes(run.id)} onDelete={() => void changeRunVisibility([run.id])} onCancel={() => void cancel(run)} onExport={() => void startExport(run)} onReference={() => referenceResult(run)} onReuse={() => { edit(draft => ({ ...draft, userText: run.userPrompt })); document.getElementById('font-user-text')?.focus(); }}/>
        ))}</div>}{resultRuns.length > visibleRuns && <button className={button + ' mt-5 w-full'} onClick={() => setVisibleRuns(count => count + 40)}>加载更早的作品</button>}

      </main><ResizableComposerDock key={session.id} dockRef={composerRef} scope="font" hasStyle={!!active} className="font-composer-dock">{styleRegion}{composer}</ResizableComposerDock></div>

    </div></>}
    {lastRemoved && lastRemoved.sessionId === session?.id && <div className="font-result-undo" role="status"><span>已删除 {lastRemoved.runIds.length} 项作品</span><button type="button" disabled={changingRun} onClick={() => void changeRunVisibility(lastRemoved.runIds, true)}>撤销</button><button type="button" aria-label="关闭删除提示" onClick={() => setRemovedRuns([])}><X size={14}/></button></div>}
    <Dialog open={!!detailRun} onOpenChange={open => { if (!open) setDetailRun(null); }}><DialogContent className="!max-w-4xl max-h-[90dvh] overflow-y-auto"><DialogTitle>字体作品</DialogTitle><DialogDescription className="sr-only">查看完整作品、生成要求与参数</DialogDescription>{detailRun?.result && <>
      <img src={detailRun.result.url} alt={detailRun.userPrompt} className="max-h-[55dvh] w-full object-contain"/>
      <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs text-muted-foreground">生成信息</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap break-words text-sm leading-6">{detailRun.userPrompt}</p><dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs"><dt className="text-muted-foreground">风格</dt><dd>{detailRun.style?.title || '自由字体设计'}</dd><dt className="text-muted-foreground">模型</dt><dd className="break-all">{detailRun.parameters.model}</dd><dt className="text-muted-foreground">比例</dt><dd>{detailRun.parameters.size}</dd>{detailRun.parameters.imageSize && <><dt className="text-muted-foreground">分辨率</dt><dd>{detailRun.parameters.imageSize}</dd></>}</dl></div></details>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={collectingRuns.includes(detailRun.id) || detailRun.status !== 'completed'} onClick={() => void collectResult(detailRun)}>{collectingRuns.includes(detailRun.id) ? <Loader2 size={14} className="animate-spin"/> : <LibraryBig size={14}/>}添加到字体库</button><a href={detailRun.result.url + '?download=1'} download className={primary}><Download size={14}/>下载原图</a><button className={button} onClick={() => { referenceResult(detailRun); setDetailRun(null); }}><ImagePlus size={14}/>用作参考图</button><button className={button} onClick={() => { void startExport(detailRun); setDetailRun(null); }}><FolderPlus size={14}/>添加到项目</button></div>
      {collectionError && <p role="alert" className="text-xs text-destructive">{collectionError}</p>}
    </>}</DialogContent></Dialog>
    <Dialog open={styleDetails&&!!active} onOpenChange={setStyleDetails}><DialogContent className="!max-w-xl max-h-[85dvh] overflow-y-auto"><DialogTitle>本次字体风格</DialogTitle><DialogDescription>编辑只用于本次设计，字体库原资料保留。</DialogDescription>{active&&session&&<>
      <div className="flex items-center gap-3"><img src={previewImageUrl(active.cover.url,256)} alt={active.title} className="h-20 w-32 rounded-lg bg-muted/30 object-contain"/><div className="min-w-0"><p className="text-sm font-medium">{active.title}</p><p className="mt-1 text-xs text-muted-foreground">{active.mode==='image'?'仅引用成品图':`成品图、提示词与 ${active.references.length} 张原参考图`}</p></div></div>
      {active.mode==='recipe'&&<label className="text-xs font-medium">风格提示词<textarea aria-label="本次风格提示词" value={session.draft.stylePromptInInput ? session.draft.userText : session.draft.stylePrompt} onChange={e=>edit(d=>d.stylePromptInInput ? {...d,userText:e.target.value} : {...d,stylePrompt:e.target.value})} className={input+' mt-2 min-h-36 resize-y text-xs leading-6'}/></label>}
      {active.references.length>0&&<div className="grid grid-cols-4 gap-3">{active.references.map((file,i)=><div key={i}>{file.missing?<span className="block rounded border border-dashed border-border p-3 text-[10px] text-muted-foreground">原图{i+1}缺失</span>:<button onClick={()=>setPreview(file)} aria-label={`查看原参考图 ${i+1}`}><img src={previewImageUrl(file.url,128)} alt={file.label} className="h-16 w-full rounded object-contain"/></button>}</div>)}</div>}
      <button className={button} onClick={()=>setStyleDetails(false)}>完成</button>
    </>}</DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="!left-auto !right-0 !top-0 !h-dvh !max-h-dvh !w-[340px] !max-w-full !translate-x-0 !translate-y-0 !rounded-none flex flex-col"><DialogTitle>字体对话记录</DialogTitle><DialogDescription>本设计的生成要求与结果记录。</DialogDescription><div className="min-h-0 flex-1 overflow-y-auto">          <div className="space-y-3"><p className="mt-1 text-[10px] text-muted-foreground">只记录本设计；生成使用当前风格与当前要求。</p>{resultRuns.length ? resultRuns.slice(-8).map(run => <div key={run.id} className="mt-3 rounded-lg bg-muted/40 p-3"><p className="whitespace-pre-wrap text-xs leading-5">{run.userPrompt}</p><p className="mt-2 text-[10px] text-muted-foreground">{run.style?.title || '自由设计'} · {run.status === 'completed' ? '已生成' : run.status === 'failed' ? '生成失败' : run.status === 'cancelled' ? '已取消' : '处理中'}</p></div>) : <p className="mt-3 text-xs text-muted-foreground">还没有发送生成要求</p>}</div></div></DialogContent></Dialog>
    <Dialog open={picker} onOpenChange={setPicker}><DialogContent className="!max-w-lg h-[80dvh] flex flex-col gap-0"><DialogTitle className="pb-3">选择字体风格</DialogTitle><DialogDescription className="pb-2 text-xs">选择新风格会替换旧资料，你的要求与个人参考图保留。</DialogDescription><div className="min-h-0 flex-1">{styleList}</div></DialogContent></Dialog>
    <Dialog open={!!selection} onOpenChange={open => { if (!open) { setSelection(null); selectionSequence.current++; setSelecting(false); } }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogTitle>选择本次参考图</DialogTitle><DialogDescription>当前模型最多 {selection?.limit} 张。确认前保留原风格和输入。</DialogDescription>{selection && session && <>{fontReferenceCandidates(selection.style, { ...session.draft, excludedReferenceIds: [] }).map(c => <label key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-2"><input type="checkbox" disabled={c.file.missing} checked={selection.selected.includes(c.id)} onChange={e => setSelection(s => s ? { ...s, selected: e.target.checked ? [...s.selected, c.id] : s.selected.filter(id => id !== c.id) } : null)}/>{!c.file.missing && <img src={previewImageUrl(c.file.url,128)} alt="" className="h-10 w-14 object-contain"/>}<span className="text-xs">{c.file.label}{c.role === 'user' ? '（个人）' : ''}</span></label>)}<button className={primary} disabled={compileFontCreation(selection.style, { ...session.draft, excludedReferenceIds: fontReferenceCandidates(selection.style,session.draft).filter(c => !selection.selected.includes(c.id)).map(c => c.id) }).files.length > selection.limit} onClick={() => { setSelecting(true); void commitStyle(selection.request, selection.style, selection.token, selection.selected).catch(e => setError(e.message)).finally(() => setSelecting(false)); }}>确认更换风格</button></>}</DialogContent></Dialog>
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="!max-w-4xl"><DialogTitle>{preview?.label || '字体作品'}</DialogTitle><DialogDescription className="sr-only">完整作品预览</DialogDescription>{preview && <><img src={preview.url} alt={preview.label} className="max-h-[70dvh] w-full object-contain"/><a className={button} href={preview.url + '?download=1'} download>下载原图</a></>}</DialogContent></Dialog>
    <Dialog open={!!exportRun} onOpenChange={open => { if (!open) setExportRun(null); }}><DialogContent><DialogTitle>添加到普通项目</DialogTitle><DialogDescription>复制这张字体作品到你选择的项目，字体创作中的原作品保留。</DialogDescription><NeutralSelect aria-label="字体作品目标项目" className={input} value={exportProject} onChange={e => setExportProject(e.target.value)}>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</NeutralSelect>{!projects.length && <p className="text-xs text-muted-foreground">请先在画布创建一个普通项目</p>}<button className={primary} disabled={!exportProject} onClick={() => { void api('/api/font-creation/sessions', { method: 'POST', body: JSON.stringify({ action: 'export', id: session?.id, runId: exportRun?.id, projectId: exportProject }) }).then(() => { setNotice('已添加到所选项目'); setExportRun(null); }).catch(e => setError(e.message)); }}>添加作品</button></DialogContent></Dialog>
  </section>;
}
