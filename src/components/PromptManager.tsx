'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchesPrompt, promptMetadata, promptTags, promptSourceUrl } from '@/lib/prompt-metadata';
import { previewImageUrl } from '@/lib/image-preview';
import LibraryDropFeedback from '@/components/library-import/LibraryDropFeedback';
import LibraryImportEntry from '@/components/library-import/LibraryImportEntry';
import { useLibraryDrop, useImportRefresh } from '@/lib/library-import-client';
import LibraryTransfer from '@/components/LibraryTransfer';
import ImportTasksEntry from '@/components/library-import/ImportTasksEntry';
import IntegrityTrash from '@/components/IntegrityTrash';
import PromptHistoryCollector from '@/components/PromptHistoryCollector';
import NeutralSelect from '@/components/ui/neutral-select';
import { Command } from 'cmdk';
import { EmptyState } from '@/components/platform/Settings';
import { LoadingState } from '@/components/creation/GenerationState';
import { BookmarkPlus, Check, ChevronLeft, Copy, FolderPlus, Loader2, Pencil, Plus, Search, Trash2, X, ImageIcon, Maximize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type PromptRecord = { importItemId?: string; attachments?: {url: string; name: string; importItemId: string}[]; id: string; text: string; category?: string; library_id?: number | null; name?: string; tags?: string; source?: string; image_url?: string | null };
type PromptGroup = { id: number; name: string; is_default?: number };
type AuthProps = { authHeaders: Record<string, string> };
type PromptManagerProps = AuthProps & {
  projectId: string | null;
  onInsertPrompt: (text: string) => void;
  onGoBack: () => void;
};

function PromptPreview({ url, name, thumbnail = false }: { url?: string | null; name?: string; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const safe = url && (promptSourceUrl(url) || (/^\/(?:prompt-previews\/|api\/local-file\/)/.test(url) ? url : undefined));
  return safe && !failed ? <img src={thumbnail ? previewImageUrl(safe, 256) : safe} alt={name || '提示词案例预览'} loading="lazy" decoding="async" onError={() => setFailed(true)}/> : <span className="prompt-preview-empty"><ImageIcon size={26}/><span>{failed ? '预览暂时无法加载' : '来源未提供预览'}</span></span>;
}

function groupKey(item: PromptRecord, groups: PromptGroup[]): string {
  const id = item.library_id ?? Number(item.category?.match(/^group:(\d+)$/)?.[1]);
  return groups.some(group => group.id === id) ? String(id) : 'none';
}

function useSavedPrompts(authHeaders: Record<string, string>) {
  const headerKey = JSON.stringify(authHeaders);
  const headers = useMemo<Record<string, string>>(() => JSON.parse(headerKey), [headerKey]);
  const [items, setItems] = useState<PromptRecord[]>([]);
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const [prompts, libraries] = await Promise.all(['/api/prompts', '/api/prompt-libraries'].map(async url => {
          const res = await fetch(url, { headers, signal: controller.signal });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '读取提示词失败');
          return data;
        }));
        if (!controller.signal.aborted) {
          setItems(Array.isArray(prompts.prompts) ? prompts.prompts : []);
          setGroups((Array.isArray(libraries.data) ? libraries.data : []).filter((group: PromptGroup) => group.is_default !== 1));
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '读取提示词失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [headers, revision]);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  useImportRefresh('prompts', reload);
  return { items, setItems, groups, setGroups, loading, error, setError, headers, reload };
}

function PromptSearch({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  return <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    <input aria-label="搜索提示词" value={query} onChange={e => onChange(e.target.value)} placeholder="搜索标题、提示词、标签或作者" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
    {query && <button type="button" aria-label="清空搜索" onClick={() => onChange('')} className="rounded p-1 hover:bg-muted"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
  </div>;
}

type PromptEditor = { id: string | null; text: string; group: string; initialText: string; initialGroup: string; name?: string; tags?: string; subcategory?: string; initialName?: string; initialTags?: string; initialSubcategory?: string; imageUrl?: string; initialImageUrl?: string };
type GroupEditor = { action: 'create' | 'rename' | 'delete'; id?: number; name: string };
const recoveryKey = (projectId: string | null) => `hz_prompt_editor_v1:${projectId || 'global'}`;
const primaryButton = 'motif-button prompt-library-primary';

export default function PromptManager({ projectId, onInsertPrompt, onGoBack, authHeaders }: PromptManagerProps) {
  const { items, setItems, groups, setGroups, loading, error, setError, headers, reload } = useSavedPrompts(authHeaders);
  const [query, setQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [subcategory, setSubcategory] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [visibleCount, setVisibleCount] = useState(40);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<PromptRecord | null>(null);
  useEffect(() => { setDetail(current => current ? items.find(item => item.id === current.id) || current : null); }, [items]);
  const [editor, setEditor] = useState<PromptEditor | null>(null);
  const [recovered, setRecovered] = useState<PromptEditor | null>(null);
  const [closeEditor, setCloseEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [groupEditor, setGroupEditor] = useState<GroupEditor | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PromptRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [showEmptyGroups, setShowEmptyGroups] = useState(false);
  const activeGroup = groups.find(group => String(group.id) === selectedGroup);
  const activeKey = activeGroup ? selectedGroup : selectedGroup === 'none' ? 'none' : 'all';
  const importer = useLibraryDrop('prompts', { authHeaders, projectId, groupId: activeGroup ? String(activeGroup.id) : '' });
  const scoped = items.filter(item => activeKey === 'all' || groupKey(item, groups) === activeKey);
  const subcategories = [...new Set(scoped.map(item => promptMetadata(item.source).subcategory).filter((value): value is string => !!value))];
  const searchable = scoped.filter(item => (!subcategory || promptMetadata(item.source).subcategory === subcategory) && matchesPrompt(item, query));
  const availableTags = [...new Set(searchable.flatMap(item => promptTags(item.tags)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const filtered = searchable.filter(item => !selectedTag || promptTags(item.tags).includes(selectedTag));
  useEffect(() => { setVisibleCount(40); }, [query, activeKey, subcategory, selectedTag]);
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || loading || visibleCount >= filtered.length) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        setVisibleCount(value => Math.min(value + 40, filtered.length));
      }
    }, { root: sentinel.closest('.prompt-library-main'), rootMargin: '0px 0px 500px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, visibleCount, filtered.length, query, activeKey, subcategory, selectedTag]);
  const selectGroup = (key: string) => { setSelectedGroup(key); setSubcategory(''); setSelectedTag(''); };

  const dirty = !!editor && (editor.text !== editor.initialText || editor.group !== editor.initialGroup || editor.name !== editor.initialName || editor.tags !== editor.initialTags || editor.subcategory !== editor.initialSubcategory || editor.imageUrl !== editor.initialImageUrl);
  const counts = new Map<string, number>();
  for (const item of items) { const key = groupKey(item, groups); counts.set(key, (counts.get(key) || 0) + 1); }
  const emptyGroupCount = groups.filter(group => !counts.get(String(group.id))).length;
  const visibleGroups = groups.filter(group => showEmptyGroups || counts.get(String(group.id)) || String(group.id) === activeKey);

  useEffect(() => {
    setRecovered(null);
    try {
      const value = JSON.parse(sessionStorage.getItem(recoveryKey(projectId)) || 'null');
      if (value && (value.id === null || typeof value.id === 'string') && typeof value.text === 'string' && typeof value.group === 'string' && typeof value.initialText === 'string' && typeof value.initialGroup === 'string') setRecovered(value);
    } catch { /* A blocked recovery store must not prevent editing. */ }
  }, [projectId]);
  useEffect(() => {
    if (!editor) return;
    try {
      if (dirty) sessionStorage.setItem(recoveryKey(projectId), JSON.stringify(editor));
      else sessionStorage.removeItem(recoveryKey(projectId));
    } catch { /* Keep the open editor usable. */ }
  }, [editor, dirty, projectId]);
  const clearRecovery = () => { setRecovered(null); try { sessionStorage.removeItem(recoveryKey(projectId)); } catch { /* Optional draft recovery. */ } };
  const openEditor = (item?: PromptRecord) => {
    setEditorError('');
    const group = item ? groupKey(item, groups) : activeGroup ? String(activeGroup.id) : 'none';
    setEditor({ id: item?.id || null, text: item?.text || '', group, initialText: item?.text || '', initialGroup: group, name: item?.name || '', tags: promptTags(item?.tags).join('，'), subcategory: promptMetadata(item?.source).subcategory || '', initialName: item?.name || '', initialTags: promptTags(item?.tags).join('，'), initialSubcategory: promptMetadata(item?.source).subcategory || '', imageUrl: item?.image_url || '', initialImageUrl: item?.image_url || '' });
  };
  const restoreEditor = () => {
    if (!recovered) return;
    const group = groups.some(value => String(value.id) === recovered.group) ? recovered.group : 'none';
    const existing = items.find(value => value.id === recovered.id);
    setEditor({ ...recovered, id: existing?.id || null, group, initialText: existing?.text || '', initialGroup: existing ? groupKey(existing, groups) : group });
    setRecovered(null); setEditorError('');
  };
  const requestClose = () => { if (saving) return; if (dirty) setCloseEditor(true); else { setEditor(null); setEditorError(''); } };
  const save = async () => {
    if (!editor || !editor.text.trim() || saving) return;
    setSaving(true); setEditorError('');
    try {
      const body = { ...(editor.id ? { id: editor.id } : { projectId }), text: editor.text.trim(), name: editor.name || '', imageUrl: editor.imageUrl || null, tags: JSON.stringify(promptTags(editor.tags)), source: JSON.stringify({ ...promptMetadata(items.find(item => item.id === editor.id)?.source), subcategory: editor.subcategory || '' }), groupId: editor.group === 'none' ? null : Number(editor.group) };
      const res = await fetch('/api/prompts', { method: editor.id ? 'PATCH' : 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.prompt) throw new Error(data.error || '保存提示词失败');
      setItems(prev => editor.id ? prev.map(item => item.id === editor.id ? data.prompt : item) : [data.prompt, ...prev]);
      selectGroup(editor.group); setQuery(''); setNotice(editor.id ? '提示词已更新' : '提示词已创建');
      clearRecovery(); setEditor(null); setCloseEditor(false);
    } catch (err) { setEditorError(err instanceof Error ? err.message : '保存提示词失败，内容已保留'); }
    finally { setSaving(false); }
  };
  const mutatePrompt = async (item: PromptRecord, targetGroup?: string) => {
    if (busyId) return;
    setBusyId(item.id); setError(''); setDeleteError('');
    try {
      const moving = targetGroup !== undefined;
      const res = await fetch(moving ? '/api/prompts' : `/api/prompts?id=${encodeURIComponent(item.id)}`, {
        method: moving ? 'PATCH' : 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
        ...(moving ? { body: JSON.stringify({ id: item.id, groupId: targetGroup === 'none' ? null : Number(targetGroup) }) } : {}),
      });
      const data = await res.json();
      if (!res.ok || (moving ? !data.prompt : data.success !== true)) throw new Error(data.error || (moving ? '移动提示词失败' : '删除提示词失败'));
      setItems(prev => moving ? prev.map(value => value.id === item.id ? data.prompt : value) : prev.filter(value => value.id !== item.id));
      if (!moving) {
        const remaining = scoped.filter(value => value.id !== item.id);
        if (subcategory && !remaining.some(value => promptMetadata(value.source).subcategory === subcategory)) { setSubcategory(''); setSelectedTag(''); }
        else if (selectedTag && !remaining.some(value => (!subcategory || promptMetadata(value.source).subcategory === subcategory) && promptTags(value.tags).includes(selectedTag))) setSelectedTag('');
      }
      setNotice(moving ? '提示词已移动' : '提示词已移至回收站'); if (!moving) setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新提示词失败';
      if (targetGroup === undefined) setDeleteError(message); else setError(message);
    }
    finally { setBusyId(null); }
  };
  const submitGroup = async () => {
    if (!groupEditor || groupBusy || (groupEditor.action !== 'delete' && !groupEditor.name.trim())) return;
    setGroupBusy(true); setGroupError('');
    const { action, id, name } = groupEditor;
    try {
      const res = await fetch(action === 'delete' ? `/api/prompt-libraries?id=${id}` : '/api/prompt-libraries', {
        method: action === 'delete' ? 'DELETE' : action === 'create' ? 'POST' : 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        ...(action === 'delete' ? {} : { body: JSON.stringify({ id, name: name.trim() }) }),
      });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || '更新分组失败');
      if (action === 'delete') {
        setItems(prev => prev.map(item => groupKey(item, groups) === String(id) ? { ...item, library_id: null, category: 'general' } : item));
        setGroups(prev => prev.filter(group => group.id !== id)); setSelectedGroup('none');
      } else {
        setGroups(prev => action === 'create' ? [...prev, data.data] : prev.map(group => group.id === data.data.id ? data.data : group));
        setSelectedGroup(String(data.data.id));
      }
      setNotice(action === 'delete' ? '分组已删除，提示词保留在未分组' : action === 'create' ? '分组已创建' : '分组已重命名'); setGroupEditor(null);
    } catch (err) { setGroupError(err instanceof Error ? err.message : '更新分组失败'); }
    finally { setGroupBusy(false); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setNotice('已复制提示词'); } catch { setError('复制失败，请重试'); } };
  const openGroup = (value: GroupEditor) => { setGroupError(''); setGroupEditor(value); };
  const requestDelete = (item: PromptRecord) => { setDeleteError(''); setDeleteTarget(item); setDetail(null); };

  return <section {...importer.dropProps} data-prompt-library="true" className="motif-prompt-workspace relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-app-canvas text-foreground">
    <header className="motif-workspace-header"><button type="button" onClick={onGoBack} aria-label="返回画布" className="motif-icon-button"><ChevronLeft size={16}/></button><BookmarkPlus size={18}/><div><h1>提示词库</h1><p>中文提示词 · 效果预览 · 按用途与风格筛选</p></div><span className="ml-auto text-xs text-muted-foreground">{items.length} 条</span><IntegrityTrash kind="prompts" onChanged={reload}/><ImportTasksEntry/><PromptHistoryCollector authHeaders={headers} groups={groups} currentGroup={activeGroup?.id} onCollected={group => { reload(); selectGroup(group); setQuery(''); }}/><LibraryImportEntry kind="prompts" authHeaders={authHeaders} projectId={projectId} groupId={activeGroup ? String(activeGroup.id) : ''}/><LibraryTransfer kind="prompts" authHeaders={authHeaders} currentGroup={activeKey} onImported={result => { reload(); if (result.groupId) selectGroup(result.groupId); }}/></header>
    {importer.dragging && <LibraryDropFeedback destination={importer.dropTarget || `提示词库 · ${activeGroup?.name || '未分组'}`} count={importer.dragCount}/>}
    <div className="motif-prompt-layout">
      <aside className="motif-library-sidebar"><div className="motif-sidebar-label">分组<button type="button" className="motif-icon-button" aria-label="新建提示词分组" disabled={loading || groupBusy} onClick={() => openGroup({ action: 'create', name: '' })}><FolderPlus size={15}/></button></div>
        <div role="group" aria-label="提示词分组">{[{ key: 'all', name: '全部', count: items.length }, ...((counts.get('none') || activeKey === 'none' || showEmptyGroups) ? [{ key: 'none', name: '未分组', count: counts.get('none') || 0 }] : []), ...visibleGroups.map(group => ({ key: String(group.id), name: group.name, count: counts.get(String(group.id)) || 0 }))].map(group => <button type="button" key={group.key} {...importer.groupDropProps(['all','none'].includes(group.key) ? '' : group.key, group.key === 'all' ? '提示词库 · 未分组' : group.name)} aria-pressed={activeKey === group.key} disabled={groupBusy} onClick={() => selectGroup(group.key)} className="motif-navigation-row"><span className="truncate">{group.name}</span><span className="text-muted-foreground">{group.count}</span></button>)}</div>
        {(emptyGroupCount > 0 || showEmptyGroups) && <button type="button" className="motif-link mt-3" aria-pressed={showEmptyGroups} onClick={() => setShowEmptyGroups(value => !value)}>{showEmptyGroups ? '收起空分类' : `显示空分类（${emptyGroupCount}）`}</button>}
        {activeGroup && <div className="mt-3 flex gap-2"><button className="motif-button flex-1" aria-label="重命名分组" disabled={groupBusy || busyId !== null} onClick={() => openGroup({ action: 'rename', id: activeGroup.id, name: activeGroup.name })}><Pencil size={12}/>重命名</button><button className="motif-icon-button" aria-label="删除分组" disabled={groupBusy || busyId !== null} onClick={() => openGroup({ action: 'delete', id: activeGroup.id, name: activeGroup.name })}><Trash2 size={14}/></button></div>}
      </aside>
      <main className="prompt-library-main"><div className="prompt-library-content">
        <div className="prompt-library-toolbar"><div className="prompt-library-heading"><h2>{activeGroup?.name || (activeKey === 'none' ? '未分组' : '全部提示词')}</h2><span>{filtered.length} 条</span></div><button type="button" className={primaryButton} disabled={loading} onClick={() => openEditor()}><Plus size={15}/>新建提示词</button></div>
        <PromptSearch query={query} onChange={setQuery}/>
        {activeKey === 'all' && !!subcategories.length && <label className="flex items-center gap-2 text-xs text-muted-foreground">小类别<NeutralSelect aria-label="筛选提示词小类别" value={subcategory} onChange={e => { setSubcategory(e.target.value); setSelectedTag(''); }}><option value="">全部用途</option>{subcategories.map(value => <option key={value} value={value}>{value}</option>)}</NeutralSelect></label>}
        {activeKey !== 'all' && !!subcategories.length && <div className="prompt-library-filters" role="group" aria-label="提示词小类别"><span>小类别</span>{['', ...subcategories].map(value => <button key={value} type="button" aria-pressed={subcategory === value} onClick={() => { setSubcategory(value); setSelectedTag(''); }} className="prompt-library-chip">{value || '全部用途'}</button>)}</div>}
        {!!availableTags.length && <div className="prompt-library-filter-row"><label className="flex items-center gap-2 text-xs text-muted-foreground">标签<NeutralSelect aria-label="筛选提示词标签" value={selectedTag} onChange={e => setSelectedTag(e.target.value)}><option value="">全部标签</option>{availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</NeutralSelect></label>{(subcategory || selectedTag || query) && <button className="motif-link" onClick={() => { setSubcategory(''); setSelectedTag(''); setQuery(''); }}>清除筛选</button>}</div>}

        {recovered && !editor && <div className="prompt-library-notice"><span>有未保存的提示词草稿</span><button className="motif-link" disabled={loading} onClick={restoreEditor}>继续编辑</button><button className="motif-icon-button" aria-label="清除提示词草稿" onClick={clearRecovery}><X size={14}/></button></div>}
        {notice && <div className="prompt-library-notice" role="status"><Check size={14}/><span className="flex-1">{notice}</span><button className="motif-icon-button" aria-label="关闭提示词提示" onClick={() => setNotice('')}><X size={14}/></button></div>}
        {error && <div role="alert" className="motif-error"><span>{error}</span><button onClick={reload}>重试</button></div>}
        {loading ? <div className="py-8"><LoadingState label="正在读取提示词"/></div> : !filtered.length ? <EmptyState title={query.trim() ? '没有匹配的提示词' : '保存一条常用提示词'} description={query.trim() ? '换个关键词，或切换分组继续查找' : '在这里整理常用描述，创作时一键插入'}/> : <div className="prompt-card-grid">{filtered.slice(0, visibleCount).map(item => <article key={item.id} className="prompt-visual-card" aria-label="提示词条目">
          <button type="button" className="prompt-card-preview" onClick={() => setDetail(item)} aria-label={`预览：${item.name || '提示词'}`}>
            <PromptPreview url={item.image_url} name={item.name}/><span className="prompt-preview-label">{item.image_url ? (!item.text ? '已收录 · 待整理' : promptMetadata(item.source).historyImageId ? '历史生成效果' : promptMetadata(item.source).previewKind === 'schematic' ? '排版示意 · 未实测' : promptMetadata(item.source).previewKind === 'reference' ? item.importItemId ? 'AI 反推 · 参考图' : '改编 · 风格参考' : '原案例效果') : '文字提示词'}</span><Maximize2 className="prompt-preview-zoom" size={16}/>
          </button>
          <div className="prompt-card-body"><h3 className="prompt-library-card-title"><button onClick={() => setDetail(item)}>{item.name || item.text.slice(0, 30)}</button></h3>
          <div className="prompt-library-card-tags">{promptMetadata(item.source).subcategory && <span>{promptMetadata(item.source).subcategory}</span>}{promptTags(item.tags).slice(0, 5).map(tag => <button key={tag} type="button" onClick={() => setSelectedTag(tag)} aria-pressed={selectedTag === tag}>{tag}</button>)}</div>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{item.text || '图片已收录，等待 AI 整理；也可以编辑补充提示词。'}</p>
          <div className="prompt-card-credit">{(promptMetadata(item.source).historyImageId ? `历史收录 · ${promptMetadata(item.source).projectName || '原项目'}` : promptMetadata(item.source).previewKind === 'example' ? promptMetadata(item.source).author : promptMetadata(item.source).author ? `参考来源：${promptMetadata(item.source).author}` : '') || '我的提示词'}{promptMetadata(item.source).referenceRequired && ' · 需参考图'}</div>
          <div className="prompt-library-card-actions"><button className="motif-link mr-auto" onClick={() => setDetail(item)}>查看全文</button><button className="motif-icon-button" aria-label="复制提示词" title="复制" onClick={() => void copy(item.text)}><Copy size={14}/></button><button className="motif-icon-button" aria-label="编辑提示词" title="编辑" disabled={busyId !== null || groupBusy} onClick={() => openEditor(item)}><Pencil size={14}/></button><button type="button" className="motif-icon-button" aria-label={`删除提示词：${item.name || item.text.slice(0, 30)}`} title="删除提示词" disabled={busyId !== null || groupBusy} onClick={() => requestDelete(item)}><Trash2 size={14}/></button><button disabled={!item.text.trim()} onClick={() => onInsertPrompt(item.text)} className="motif-button">使用</button></div>
          </div></article>)}{filtered.length > visibleCount && <div ref={loadMoreRef} className="col-span-full flex justify-center py-4 text-xs text-muted-foreground" role="status"><Loader2 size={14} className="mr-2 animate-spin"/>继续向下浏览，自动加载更多</div>}</div>}

      </div></main>
    </div>
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="prompt-detail-dialog"><DialogTitle>{detail?.name || '提示词详情'}</DialogTitle><DialogDescription>{detail?.image_url ? (promptMetadata(detail.source).historyImageId ? '从自己的生成历史收录，保留完整生成提示词与对应效果图。' : promptMetadata(detail.source).previewKind === 'schematic' ? '卡面为程序绘制的排版或构图示意，未进行AI出图实测；下方附相关案例参考。' : promptMetadata(detail.source).previewKind === 'reference' ? detail.importItemId ? '图片为导入原图；提示词由 AI 根据图片反推，可自行修改。' : '预览为来源案例的风格参考，当前中文改编稿尚未实测。' : '预览为来源作者公开的案例。提示词保留原文或完整中文翻译，具体模型与核对说明见下方来源信息。') : '来源未提供可用预览图，可阅读提示词与原始出处。'}</DialogDescription>
      {detail && <div className="prompt-detail-layout"><div className="prompt-detail-image"><PromptPreview url={detail.image_url} name={detail.name}/>{promptMetadata(detail.source).referencePreviewUrl && <div className="prompt-detail-reference"><p>相关案例 · 风格参考</p><PromptPreview url={promptMetadata(detail.source).referencePreviewUrl} name="来源案例风格参考"/></div>}</div><div className="prompt-detail-copy"><div className="prompt-library-card-tags">{promptTags(detail.tags).map(tag => <span key={tag}>{tag}</span>)}</div><p className="whitespace-pre-wrap break-words text-sm leading-7">{detail.text}</p><LibraryImportEntry kind="prompts" targetId={detail.id} authHeaders={authHeaders} label="追加图片（支持拖入）"/><div className="grid grid-cols-3 gap-2">{detail.attachments?.map(a=><a key={a.importItemId} href={a.url} target="_blank" rel="noreferrer" title={a.name}><img src={previewImageUrl(a.url,256)} alt={a.name} className="aspect-square w-full rounded border border-border object-contain"/></a>)}</div><div className="prompt-library-source"><span>{promptMetadata(detail.source).historyImageId ? `来源：生成历史 · ${promptMetadata(detail.source).projectName || '原项目'}` : `来源作者：${promptMetadata(detail.source).author || '未标注'}`}</span>{promptSourceUrl(promptMetadata(detail.source).url) && <a href={promptSourceUrl(promptMetadata(detail.source).url)} target="_blank" rel="noopener noreferrer">查看原始出处</a>}{promptSourceUrl(promptMetadata(detail.source).collectionUrl) && <a href={promptSourceUrl(promptMetadata(detail.source).collectionUrl)} target="_blank" rel="noopener noreferrer">查看案例合集</a>}{promptMetadata(detail.source).note && <span>{promptMetadata(detail.source).note}</span>}</div>
      <div className="prompt-library-card-actions"><NeutralSelect aria-label="移动提示词到分组" value={groupKey(detail, groups)} disabled={busyId !== null || groupBusy} onChange={e => { void mutatePrompt(detail, e.target.value); setDetail(null); }} className="prompt-library-card-group"><option value="none">未分组</option>{groups.map(group => <option key={group.id} value={String(group.id)}>{group.name}</option>)}</NeutralSelect><button className="motif-icon-button" aria-label="删除提示词" disabled={busyId !== null} onClick={() => requestDelete(detail)}><Trash2 size={14}/></button><button className="motif-button" onClick={() => { openEditor(detail); setDetail(null); }}><Pencil size={14}/>编辑</button><button className="motif-button" onClick={() => void copy(detail.text)}><Copy size={14}/>复制</button><button className={primaryButton} disabled={!detail.text.trim()} onClick={() => onInsertPrompt(detail.text)}>使用提示词</button></div></div></div>}
    </DialogContent></Dialog>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="prompt-library-dialog" showCloseButton={false}>
      <div className="flex items-center justify-between gap-4"><DialogTitle>{editor?.id ? '编辑提示词' : '新建提示词'}</DialogTitle><button className="motif-icon-button" aria-label="关闭提示词编辑" disabled={saving} onClick={requestClose}><X size={16}/></button></div><DialogDescription>保存常用描述，创作时可以从输入框直接引用。</DialogDescription>
      {editor && <form className="prompt-library-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label className="prompt-library-label">标题<input aria-label="提示词标题" className="motif-field" value={editor.name || ''} maxLength={160} disabled={saving} onChange={e => setEditor({ ...editor, name: e.target.value })}/></label>
        <div className="grid grid-cols-2 gap-3"><label className="prompt-library-label">小类别<input aria-label="提示词小类别" className="motif-field" value={editor.subcategory || ''} maxLength={80} disabled={saving} onChange={e => setEditor({ ...editor, subcategory: e.target.value })}/></label><label className="prompt-library-label">标签（逗号分隔）<input aria-label="提示词标签" className="motif-field" value={editor.tags || ''} disabled={saving} onChange={e => setEditor({ ...editor, tags: e.target.value })}/></label></div>
        <label className="prompt-library-label">预览图地址（可选）<input aria-label="提示词预览图地址" className="motif-field" placeholder="https://…" value={editor.imageUrl || ''} disabled={saving} onChange={e => setEditor({ ...editor, imageUrl: e.target.value })}/></label>
        <label className="prompt-library-label">提示词内容<textarea autoFocus aria-label="提示词内容" className="motif-field prompt-library-textarea" placeholder="输入常用的风格、画面描述或生成要求…" value={editor.text} maxLength={30000} disabled={saving} onChange={e => setEditor({ ...editor, text: e.target.value })} onKeyDown={e => { if (!e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); } }}/></label>
        <label className="prompt-library-label">分组<NeutralSelect aria-label="提示词所属分组" value={editor.group} disabled={saving} onChange={e => setEditor({ ...editor, group: e.target.value })}><option value="none">未分组</option>{groups.map(group => <option key={group.id} value={String(group.id)}>{group.name}</option>)}</NeutralSelect></label>
        {editorError && <p className="motif-error" role="alert">{editorError}</p>}
        <div className="prompt-library-editor-footer"><span className="text-xs text-muted-foreground">⌘ / Ctrl + Enter 保存</span><button type="button" className="motif-button" disabled={saving} onClick={requestClose}>取消</button><button type="submit" className={primaryButton} disabled={saving || !editor.text.trim()}>{saving && <Loader2 size={14} className="animate-spin"/>}{saving ? '正在保存…' : '保存提示词'}</button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={closeEditor} onOpenChange={setCloseEditor}><DialogContent className="prompt-library-dialog"><DialogTitle>提示词尚未保存</DialogTitle><DialogDescription>可以保留草稿稍后继续，也可以返回编辑。</DialogDescription><div className="flex flex-wrap justify-end gap-2"><button className="motif-button" onClick={() => { clearRecovery(); setCloseEditor(false); setEditor(null); }}>放弃修改</button><button className="motif-button" onClick={() => { setRecovered(editor); setCloseEditor(false); setEditor(null); }}>保留草稿并关闭</button><button className={primaryButton} onClick={() => setCloseEditor(false)}>继续编辑</button></div></DialogContent></Dialog>
    <Dialog open={!!groupEditor} onOpenChange={open => { if (!open && !groupBusy) setGroupEditor(null); }}><DialogContent className="prompt-library-dialog" showCloseButton={!groupBusy}><DialogTitle>{groupEditor?.action === 'delete' ? '删除分组' : groupEditor?.action === 'rename' ? '重命名分组' : '新建分组'}</DialogTitle><DialogDescription>{groupEditor?.action === 'delete' ? `删除“${groupEditor.name}”后，其中的提示词会保留到未分组。` : '用一层分组整理常用提示词。'}</DialogDescription>
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void submitGroup(); }}>{groupEditor?.action !== 'delete' && <label className="prompt-library-label">分组名称<input autoFocus className="motif-field" aria-label="分组名称" maxLength={50} value={groupEditor?.name || ''} disabled={groupBusy} onChange={e => setGroupEditor(value => value ? { ...value, name: e.target.value } : null)}/></label>}{groupError && <p role="alert" className="motif-error">{groupError}</p>}<div className="flex justify-end gap-2"><button type="button" className="motif-button" disabled={groupBusy} onClick={() => setGroupEditor(null)}>取消</button><button type="submit" className={primaryButton} disabled={groupBusy || (groupEditor?.action !== 'delete' && !groupEditor?.name.trim())}>{groupBusy ? '正在保存…' : groupEditor?.action === 'delete' ? '删除分组，保留提示词' : '保存分组'}</button></div></form>
    </DialogContent></Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !busyId) setDeleteTarget(null); }}><DialogContent className="prompt-library-dialog" showCloseButton={!busyId}><DialogTitle>删除提示词</DialogTitle><DialogDescription>确认删除“{deleteTarget?.name || '这条提示词'}”？删除后移至回收站，可随时恢复。</DialogDescription>{deleteError && <p role="alert" className="motif-error">{deleteError}</p>}<p className="line-clamp-4 whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs leading-6">{deleteTarget?.text}</p><div className="flex justify-end gap-2"><button className="motif-button" disabled={!!busyId} onClick={() => setDeleteTarget(null)}>取消</button><button className={primaryButton} disabled={!!busyId} onClick={() => { if (deleteTarget) void mutatePrompt(deleteTarget); }}>{busyId ? '正在删除…' : '确认删除'}</button></div></DialogContent></Dialog>
  </section>;
}

export function PromptQuickPicker({ authHeaders, onSelect, onOpenFullManager, onClose }: AuthProps & { onSelect: (text: string) => void; onOpenFullManager: () => void; onClose: () => void }) {
  const { items, groups, loading, error, reload } = useSavedPrompts(authHeaders);
  const [query, setQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const filtered = items.filter(item => item.text.trim() && (selectedGroup === 'all' || groupKey(item, groups) === selectedGroup) && matchesPrompt(item, query));
  return <div data-prompt-picker="true" className="motif-prompt-picker flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-card p-3">
    <div className="flex items-center justify-between"><span className="text-sm font-medium">选择提示词</span><div className="flex items-center gap-2"><button onClick={onOpenFullManager} className="motif-link">管理</button><button onClick={onClose} aria-label="关闭提示词库" className="motif-icon-button"><X size={14}/></button></div></div>
    <NeutralSelect aria-label="筛选提示词分组" value={selectedGroup} onChange={e=>setSelectedGroup(e.target.value)}><option value="all">全部分组</option><option value="none">未分组</option>{groups.map(g=><option key={g.id} value={String(g.id)}>{g.name}</option>)}</NeutralSelect>
    <Command label="提示词快捷选择" shouldFilter={false} loop className="flex min-h-0 flex-1 flex-col"><div className="motif-menu-search"><Search size={14}/><Command.Input autoFocus aria-label="搜索提示词" value={query} onValueChange={setQuery} placeholder="搜索提示词…"/></div><Command.List className="motif-menu-list !max-h-none min-h-0 flex-1">
      {error?<p role="alert" className="motif-error">{error}<button onClick={reload}>重试</button></p>:loading?<LoadingState label="正在读取提示词"/>:filtered.map(item=><Command.Item key={item.id} value={item.id} onSelect={()=>onSelect(item.text)} className="motif-menu-item motif-prompt-picker-item"><span className="motif-prompt-picker-preview"><PromptPreview url={item.image_url} name={item.name} thumbnail/></span><span className="min-w-0 flex-1 text-xs leading-5">{item.name && <strong className="mb-1 line-clamp-2 break-words">{item.name}</strong>}<span className="line-clamp-2 break-words text-muted-foreground">{item.text}</span></span></Command.Item>)}{!loading&&!error&&!filtered.length&&<Command.Empty className="motif-empty">{query.trim()?'没有匹配的提示词':'当前分组暂无提示词'}</Command.Empty>}
    </Command.List></Command>
  </div>;
}
