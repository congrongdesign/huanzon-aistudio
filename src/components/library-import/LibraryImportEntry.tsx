'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { enqueueLibraryFiles } from '@/lib/library-import-client';
import type { LibraryKind } from '@/lib/library-import-types';
export default function LibraryImportEntry({ kind, groupId, projectId, targetId, authHeaders, label = '导入图片' }: { kind: LibraryKind; groupId?: string; projectId?: string | null; targetId?: string; authHeaders: Record<string, string>; label?: string }) {
  const input = useRef<HTMLInputElement>(null); const [error, setError] = useState(''); const [dragging,setDragging] = useState(false);
  useEffect(()=>{const clear=()=>setDragging(false); const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')clear();};window.addEventListener('dragend',clear);window.addEventListener('drop',clear,true);window.addEventListener('blur',clear);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('dragend',clear);window.removeEventListener('drop',clear,true);window.removeEventListener('blur',clear);window.removeEventListener('keydown',escape);};},[]);
  const enqueue = (files: FileList | File[]) => { setError(''); void enqueueLibraryFiles(kind, files, { groupId, projectId, targetId, authHeaders }).catch(e => setError(e.message)); };
  return <div className="relative inline-flex max-w-full flex-wrap items-center gap-2" data-import-hover={dragging || undefined} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect='copy'; setDragging(true); } }} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDragging(false);}} onDrop={e => { if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault(); e.stopPropagation();setDragging(false); enqueue(e.dataTransfer.files); }}>
    {dragging && <span className="absolute bottom-full left-0 z-[80] mb-2 w-64 rounded-lg border border-border bg-background p-3 text-xs shadow-lg pointer-events-none"><strong className="block">{targetId ? '松开，添加到此卡片' : '松开，导入图片'}</strong><span className="mt-1 block text-muted-foreground">{targetId ? '支持多张 · 保留原封面与资料' : '支持批量 · 后台自动整理'}</span></span>}
    <button className="motif-button gap-2" onClick={() => input.current?.click()}><Upload size={14}/>{label}</button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => { if (e.target.files) enqueue(e.target.files); e.target.value = ''; }}/>{error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </div>;
}
