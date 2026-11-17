'use client';

import { useState } from 'react';
import { Check, History, Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import NeutralSelect from '@/components/ui/neutral-select';
import { previewImageUrl } from '@/lib/image-preview';
import { useInfiniteFontList } from '@/lib/use-infinite-font-list';

type HistoryItem = { id: string; image_url: string; prompt: string; projectName: string; created_at: string; model: string; collected: boolean };
type Result = { id: string; error?: string; duplicate?: boolean };
type Props = { authHeaders: Record<string, string>; groups: { id: number; name: string }[]; currentGroup?: number; onCollected: (group: string) => void };

export default function PromptHistoryCollector({ authHeaders, groups, currentGroup, onCollected }: Props) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [project, setProject] = useState(''), [days, setDays] = useState('0');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState('none'), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [notice, setNotice] = useState(''), [errors, setErrors] = useState<Result[]>([]);
  const [revision, setRevision] = useState(0);
  const listing = useInfiniteFontList<HistoryItem>(JSON.stringify([query, project, days]), revision, open, async (page, signal) => {
    const res = await fetch(`/api/prompts/history?${new URLSearchParams({ q: query, project, days, page: String(page) })}`, { headers: authHeaders, signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '读取历史作品失败');
    if (!signal.aborted) setProjects(data.projects);
    return { items: data.records, total: data.total, pageSize: data.pageSize };
  });
  const resetFilters = (change: () => void) => { change(); setSelected([]); setErrors([]); setNotice(''); };
  const toggle = (id: string) => setSelected(value => value.includes(id) ? value.filter(v => v !== id) : value.length < 100 ? [...value, id] : value);
  const collect = async () => {
    if (busy || !selected.length) return;
    const ids = [...selected], group = target;
    setBusy(true); setErrors([]); setNotice(''); setProgress(`0 / ${ids.length}`);
    let added = 0, duplicates = 0;
    const failed: Result[] = [], succeeded = new Set<string>();
    try {
      // Small batches make progress visible and let the rest of the app remain usable.
      for (let offset = 0; offset < ids.length; offset += 5) {
        const batch = ids.slice(offset, offset + 5);
        try {
          const res = await fetch('/api/prompts/history', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch, groupId: group === 'none' ? null : Number(group) }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '收录失败，请重试');
          for (const result of data.results as Result[]) {
            if (result.error) failed.push(result);
            else { succeeded.add(result.id); if (result.duplicate) duplicates++; else added++; }
          }
        } catch (error) {
          failed.push(...batch.map(id => ({ id, error: error instanceof Error ? error.message : '收录失败，请重试' })));
        }
        setProgress(`${Math.min(offset + 5, ids.length)} / ${ids.length}`);
      }
    } finally {
      setSelected(value => value.filter(id => !succeeded.has(id))); setErrors(failed);
      setNotice(`已收录 ${added} 条${duplicates ? `，${duplicates} 条已收录` : ''}${failed.length ? `，${failed.length} 条失败，选择已保留，可重试` : ''}`);
      setBusy(false); setRevision(v => v + 1);
      if (succeeded.size) onCollected(group);
    }
  };
  return <>
    <button type="button" className="motif-button" onClick={() => { if (!open && !busy) { setTarget(currentGroup ? String(currentGroup) : 'none'); setRevision(v => v + 1); } setOpen(true); }}>
      {busy ? <Loader2 size={14} className="animate-spin"/> : <History size={14}/>}{busy ? `正在收录 ${progress}` : '从历史收录'}
    </button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="!max-w-4xl max-h-[90dvh] flex flex-col gap-4 overflow-hidden" aria-busy={busy}>
      <DialogTitle>从历史收录到提示词库</DialogTitle>
      <DialogDescription>选择已完成的生成作品，保存完整提示词和效果图。原作品保持不变，已收录的作品会自动跳过。</DialogDescription>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-border px-3"><Search size={14} className="text-muted-foreground"/><input aria-label="搜索历史提示词" className="min-w-0 w-full bg-transparent py-2 text-xs outline-none" placeholder="搜索提示词或项目" disabled={busy} value={query} onChange={e => resetFilters(() => setQuery(e.target.value))}/></label>
        <NeutralSelect aria-label="筛选历史来源项目" className="!w-40" disabled={busy} value={project} onChange={e => resetFilters(() => setProject(e.target.value))}><option value="">所有项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NeutralSelect>
        <NeutralSelect aria-label="筛选历史时间" className="!w-28" disabled={busy} value={days} onChange={e => resetFilters(() => setDays(e.target.value))}><option value="0">全部时间</option><option value="7">最近7天</option><option value="30">最近30天</option></NeutralSelect>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>{listing.total} 张作品 · 已选 {selected.length} / 100</span><button className="motif-link" disabled={busy || listing.loading} onClick={() => setSelected(listing.items.filter(i => !i.collected).slice(0, 100).map(i => i.id))}>选择已加载</button><button className="motif-link" disabled={busy || !selected.length} onClick={() => setSelected([])}>清空选择</button></div>
      <div ref={listing.rootRef} className="min-h-32 flex-1 overflow-y-auto" style={{ minHeight: 'min(32vh, 240px)' }}>
        {listing.loading ? <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground" role="status"><Loader2 size={16} className="animate-spin"/>正在读取历史作品…</div> : <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{listing.items.map(item => <button type="button" key={item.id} aria-label={`选择作品：${item.prompt}`} aria-pressed={selected.includes(item.id)} disabled={busy || item.collected || (selected.length >= 100 && !selected.includes(item.id))} onClick={() => toggle(item.id)} className={`relative overflow-hidden rounded-xl border bg-card text-left transition-colors disabled:cursor-default ${selected.includes(item.id) ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-muted-foreground'}`}>
            <div className="relative aspect-[4/3] bg-muted"><img src={previewImageUrl(item.image_url, 256)} alt="历史作品效果图" className="h-full w-full object-contain" loading="lazy" decoding="async"/><span className={`absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded border px-1 text-[10px] ${item.collected || selected.includes(item.id) ? 'border-foreground bg-foreground text-background' : 'border-border bg-background'}`}>{item.collected ? '已收录' : selected.includes(item.id) ? <Check size={13}/> : ''}</span></div>
            <div className="space-y-1 p-2.5"><p className="line-clamp-2 break-words text-xs leading-5">{item.prompt}</p><p className="truncate text-[10px] text-muted-foreground">{item.projectName} · {new Date(item.created_at).toLocaleDateString()}</p><p className="truncate text-[10px] text-muted-foreground">{item.model}</p></div>
          </button>)}</div>
          {!listing.items.length && !listing.error && <p className="py-12 text-center text-xs text-muted-foreground">没有符合条件的生成作品，试试调整筛选条件。上传图片可使用「导入图片」。</p>}
          {listing.hasMore && <div ref={listing.sentinelRef} className="py-4 text-center text-xs text-muted-foreground">{listing.loadingMore ? '正在加载更多…' : '向下浏览更多作品'}</div>}
        </>}
        {listing.error && <p role="alert" className="py-3 text-xs text-destructive">{listing.error}<button className="motif-link ml-3" onClick={listing.retry}>重试</button></p>}
      </div>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {!!errors.length && <div role="alert" className="max-h-20 overflow-auto text-xs text-destructive">{[...new Set(errors.map(e => e.error))].map(error => <p key={error}>{error}</p>)}</div>}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3"><label className="flex items-center gap-2 text-xs">收录到<NeutralSelect aria-label="历史提示词目标分组" disabled={busy} value={target} onChange={e => setTarget(e.target.value)}><option value="none">未分组</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</NeutralSelect></label><span className="flex-1 text-xs text-muted-foreground">{busy ? '收录中，可关闭窗口继续工作' : '直接保存原提示词，无需 AI 分析'}</span><button type="button" className="motif-button prompt-library-primary" disabled={busy || !selected.length} onClick={() => void collect()}>{busy && <Loader2 size={14} className="animate-spin"/>}{busy ? `正在收录 ${progress}` : `收录${selected.length ? ` ${selected.length} 条` : '所选'}`}</button></div>
    </DialogContent></Dialog>
  </>;
}
