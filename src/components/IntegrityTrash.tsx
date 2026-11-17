'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
type Entry = { id: string; name?: string; text?: string; deleted_at?: string };
export default function IntegrityTrash({ kind, onChanged }: { kind: 'projects' | 'prompts'; onChanged: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<Entry[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<Entry | null>(null);
  const load = async () => {
    setError(''); setBusy(true);
    try { const res = await fetch('/api/integrity-trash'); const data = await res.json(); if (!res.ok) throw new Error(data.error); setItems(data[kind] || []); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setBusy(false); }
  };
  const act = async (item: Entry, permanent: boolean) => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/integrity-trash', { method: permanent ? 'DELETE' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: item.id, confirm: permanent ? 'permanent-delete' : undefined }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setItems(current => current.filter(row => row.id !== item.id)); setConfirm(null); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  };
  return <><button type="button" className="motif-button" title={kind === 'projects' ? '项目回收站' : '提示词回收站'} onClick={() => { setOpen(true); setConfirm(null); void load(); }}><Trash2 size={13}/>回收站</button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-w-xl" showCloseButton={!busy}><DialogTitle>{kind === 'projects' ? '项目回收站' : '提示词回收站'}</DialogTitle><DialogDescription>{kind === 'projects' ? '恢复项目可找回画布与对话。提示词库独立保留，不受项目删除影响。' : '已删除提示词保留在这里，可恢复。永久删除需要再次确认。'}</DialogDescription>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {confirm ? <div className="space-y-4"><p className="text-sm break-words">永久删除“{confirm.name || confirm.text?.slice(0, 40) || '此条目'}”？此操作无法从回收站恢复。</p><div className="flex justify-end gap-2"><button className="motif-button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="motif-button text-destructive" disabled={busy} onClick={() => void act(confirm, true)}>永久删除</button></div></div>
        : <div className="max-h-[55vh] overflow-y-auto space-y-2">{!items.length && <p className="py-8 text-center text-sm text-muted-foreground">{busy ? '正在读取…' : '回收站为空'}</p>}{items.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm">{item.name || item.text?.slice(0, 60) || '未命名项目'}</p><p className="text-xs text-muted-foreground">{item.deleted_at ? new Date(item.deleted_at).toLocaleString() : ''}</p></div><button className="motif-button" disabled={busy} onClick={() => void act(item, false)}>恢复</button><button className="motif-button text-destructive" disabled={busy} onClick={() => setConfirm(item)}>永久删除</button></div>)}</div>}
    </DialogContent></Dialog></>;
}
