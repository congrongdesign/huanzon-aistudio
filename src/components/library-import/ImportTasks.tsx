'use client';
import { useEffect, useRef, useState } from 'react';
import { X, Pause, Play, RotateCcw } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { actOnImport, refreshLibraryImports, retryImportUpload, setImportHeaders, useLibraryImports } from '@/lib/library-import-client';
import { IMPORT_STAGE_LABELS, LIBRARY_LABELS } from '@/lib/library-import-types';

export default function ImportTasks({ authHeaders }: { authHeaders: Record<string, string> }) {
  const data = useLibraryImports(); const [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const pendingRef = useRef(data.pending.length); pendingRef.current = data.pending.length;
  const headers = useRef(authHeaders); headers.current = authHeaders;
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { setImportHeaders(headers.current); await refreshLibraryImports(); if (live) timer = setTimeout(poll, document.hidden ? 6000 : 1500); };
    void poll(); const show = () => setOpen(true); window.addEventListener('hz-library-import-open', show);
    const leave = (event: BeforeUnloadEvent) => { if (pendingRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', leave);
    return () => { live = false; clearTimeout(timer); window.removeEventListener('hz-library-import-open', show); window.removeEventListener('beforeunload', leave); };
  // Pending files are held by the singleton; polling never depends on page/card renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saved = data.items.filter(i => i.cardId).length, done = data.items.filter(i => i.stage === 'completed').length;
  const action = async (batchId: string, command: string) => { setBusy(batchId); setError(''); try { await actOnImport(batchId, command); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  return <>
    <Sheet modal={false} open={open} onOpenChange={setOpen}><SheetContent showOverlay={false} onInteractOutside={e => e.preventDefault()} onOpenAutoFocus={e => e.preventDefault()} className="flex w-[380px] max-w-full flex-col gap-0 p-0 !duration-150 sm:max-w-[380px]" side="right">
      <div className="border-b border-border p-5 pr-12"><SheetTitle>导入任务</SheetTitle><SheetDescription className="mt-2 text-xs">原图先保存，AI 后台整理。切换页面可以继续使用。支持 JPG / PNG / WebP，单张不超过 25 MiB。</SheetDescription></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-5 grid grid-cols-3 gap-3 text-xs text-muted-foreground"><div><strong className="block text-2xl font-medium text-foreground">{saved}</strong>已收录</div><div><strong className="block text-2xl font-medium text-foreground">{done}</strong>整理完成</div><div><strong className="block text-2xl font-medium text-foreground">{data.items.filter(i => ['failed', 'waiting'].includes(i.stage)).length}</strong>需处理</div></div>
        {(error || data.error) && <p role="alert" className="mb-4 text-xs text-destructive">{error || data.error}</p>}
        {data.pending.map(p => <div key={p.id} className="mb-3 border-b border-border pb-3 text-xs"><p className="truncate">{p.name}</p><p className={p.error ? 'text-destructive' : 'text-muted-foreground'}>{p.error || '已接收 · 正在传入原图'}</p>{p.error && <button className="motif-link mt-1" onClick={() => retryImportUpload(p.id)}>重试传入</button>}</div>)}
        {!data.batches.length && !data.pending.length && <p className="py-10 text-center text-xs text-muted-foreground">将图片拖入提示词、字体或案例中心，即可开始。</p>}
        {data.total > 300 && <p className="mb-4 text-xs text-muted-foreground">显示最近 300 项，较早任务继续在后台处理。</p>}
        {data.batches.map(batch => { const items = data.items.filter(i => i.batchId === batch.id); if (!items.length) return null; return <section className="mb-6" key={batch.id}>
          <div className="flex items-center justify-between text-xs font-medium"><span>{LIBRARY_LABELS[batch.kind]} · {items.length} 张</span><span className="text-[10px] text-muted-foreground">{batch.paused ? '已暂停整理' : new Date(batch.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="my-3 flex flex-wrap gap-1.5"><button className="motif-button !px-2 !text-[11px]" disabled={busy === batch.id} onClick={() => void action(batch.id, batch.paused ? 'resume' : 'pause')}>{batch.paused ? <Play size={11}/> : <Pause size={11}/>} {batch.paused ? '继续' : '暂停整理'}</button><button className="motif-button !px-2 !text-[11px]" disabled={busy === batch.id} onClick={() => void action(batch.id, 'retry')}><RotateCcw size={11}/>重试</button><button className="motif-button !px-2 !text-[11px]" disabled={busy === batch.id} onClick={() => void action(batch.id, 'cancel')}><X size={11}/>停止后续整理</button><button className="motif-link !text-[11px]" disabled={busy === batch.id} onClick={() => void action(batch.id, 'undo')}>撤销本批新增</button></div>
          {items.slice(0, 80).map(item => <div key={item.id} className="border-t border-border py-2.5 text-xs"><p className="truncate" title={item.originalName}>{item.analysis?.title || item.originalName}</p><p className={`mt-1 text-[11px] ${item.stage === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.created === false && !item.targetId ? '重复图片 · 已保留已有卡片' : item.preserved ? '已编辑或正在处理，撤销时保留' : IMPORT_STAGE_LABELS[item.stage]}</p>{item.error && <p className="mt-1 text-[11px] text-muted-foreground">{item.error}</p>}</div>)}
          {items.length > 80 && <p className="text-xs text-muted-foreground">本批更多项目仍在后台处理。</p>}
        </section>; })}
      </div><p className="border-t border-border p-4 text-[11px] leading-5 text-muted-foreground">暂停和取消整理均保留原图；应用退出后已保存任务可恢复。未传完的浏览器文件需要重新选择。</p>
    </SheetContent></Sheet>
  </>;
}
