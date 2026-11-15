'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, Folder, FolderPlus, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatStorageBytes, type StorageDirectoryListing } from '@/lib/storage-management-types';

async function directoryRequest(body: object, signal?: AbortSignal, endpoint = '/api/storage-management') {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法读取文件夹');
  return data;
}

export function StorageDirectoryPicker({ open, initialDirectory, onOpenChange, onSelect, title = "选择图片储存文件夹", endpoint = '/api/storage-management' }: {
  endpoint?: string; title?: string; open: boolean; initialDirectory: string; onOpenChange: (open: boolean) => void;
  onSelect: (directory: string, isDefault: boolean) => void;
}) {
  const [listing, setListing] = useState<StorageDirectoryListing | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [failedDirectory, setFailedDirectory] = useState('');
  const pending = useRef<AbortController | null>(null);
  const browse = useCallback(async (directory?: string) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy('browse'); setError(''); setCreating(false); setFailedDirectory(directory || '');
    try {
      const value = await directoryRequest({ action: 'browse-directory', ...(directory ? { directory } : {}) }, controller.signal, endpoint);
      if (!controller.signal.aborted) setListing(value);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '无法打开文件夹'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }, [endpoint]);
  useEffect(() => {
    if (open) { setListing(null); void browse(initialDirectory || undefined); }
    return () => pending.current?.abort();
  }, [open, initialDirectory, browse]);
  async function choose() {
    if (!listing || busy) return;
    setBusy('choose'); setError('');
    try {
      const result = await directoryRequest({ action: 'validate-directory', directory: listing.directory }, undefined, endpoint);
      onSelect(result.directory, result.isDefault); onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : '文件夹不可用'); }
    finally { setBusy(''); }
  }
  async function create() {
    if (!listing || busy || !name.trim()) return;
    setBusy('create'); setError('');
    try { setListing(await directoryRequest({ action: 'create-directory', directory: listing.directory, name }, undefined, endpoint)); setCreating(false); setName(''); }
    catch (e) { setError(e instanceof Error ? e.message : '新建文件夹失败'); }
    finally { setBusy(''); }
  }
  return <Dialog open={open} onOpenChange={value => { if (busy !== 'choose' && busy !== 'create') onOpenChange(value); }}>
    <DialogContent className="storage-directory-dialog">
      <header className="storage-directory-header"><DialogTitle>{title}</DialogTitle><DialogDescription>浏览运行 AIStudio 的电脑，选择本机、外置磁盘或已挂载的 NAS 文件夹。</DialogDescription></header>
      <div className="storage-directory-browser">
        <nav aria-label="常用位置" className="storage-directory-shortcuts"><span>位置</span>{listing?.shortcuts.map(item => <button type="button" key={item.path} disabled={!!busy} aria-current={listing.directory === item.path ? 'location' : undefined} onClick={() => void browse(item.path)} title={item.path}><HardDrive size={14} /><span>{item.name}</span></button>)}{!listing && <button type="button" disabled={!!busy} onClick={() => void browse()}><Folder size={14} />当前位置</button>}</nav>
        <div className="storage-directory-main">
          <div className="storage-directory-toolbar"><button type="button" className="motif-button" aria-label="返回上一级" disabled={!!busy || !listing?.parent} onClick={() => void browse(listing!.parent!)}><ArrowUp size={14} /></button><nav aria-label="文件夹路径" className="storage-directory-breadcrumbs">{listing?.breadcrumbs.map((item, index) => <span key={item.path}>{index > 0 && <ChevronRight size={12} />}<button type="button" disabled={!!busy} onClick={() => void browse(item.path)} aria-current={index === listing.breadcrumbs.length - 1 ? 'location' : undefined}>{item.name}</button></span>)}</nav><button type="button" className="motif-button" disabled={!!busy} aria-label="刷新文件夹" onClick={() => void browse(listing?.directory)}><RefreshCw size={14} /></button></div>
          {error && <div className="storage-directory-error" role="alert"><span>{error}</span><button type="button" className="motif-link" disabled={!!busy} onClick={() => void browse(failedDirectory || listing?.directory)}>重试</button></div>}
          <div className="storage-directory-folders" aria-label="子文件夹" aria-busy={busy === 'browse'}>
            {busy === 'browse' ? <div className="storage-directory-empty" role="status"><Loader2 size={18} className="animate-spin" />正在读取文件夹…</div> : listing ? listing.folders.length ? listing.folders.map(folder => <button type="button" key={folder.path} disabled={!!busy} onClick={() => void browse(folder.path)} aria-label={`打开文件夹 ${folder.name}`}><Folder size={17} /><span>{folder.name}</span><ChevronRight size={14} /></button>) : <div className="storage-directory-empty"><Folder size={24} /><span>此文件夹内没有子文件夹</span><span className="text-[11px] text-muted-foreground">可直接使用当前位置，也可以新建文件夹。</span></div> : !error ? <div className="storage-directory-empty">正在准备目录…</div> : <div className="storage-directory-empty">请重试或返回当前位置。</div>}
          </div>
          {creating && <form className="storage-directory-create" onSubmit={event => { event.preventDefault(); void create(); }}><label htmlFor="storage-new-folder" className="sr-only">新文件夹名称</label><input autoFocus id="storage-new-folder" className="motif-field min-w-0 flex-1" value={name} onChange={event => setName(event.target.value)} disabled={!!busy} placeholder="新文件夹名称" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setCreating(false); } }} /><button type="button" className="motif-button" disabled={!!busy} onClick={() => setCreating(false)}>取消</button><button type="submit" className="motif-button" disabled={!!busy || !name.trim()}>{busy === 'create' ? '创建中…' : '创建'}</button></form>}
          <div className="storage-directory-location"><div className="flex min-w-0 items-start gap-2"><Folder size={14} className="mt-0.5 shrink-0" /><span className="break-all">{listing?.directory || '正在读取位置'}</span></div><p>{listing?.disk ? `可用 ${formatStorageBytes(listing.disk.available)}` : ''}{listing && !listing.writable ? ' · 此文件夹不可写，请选择其他位置' : ''}</p></div>
        </div>
      </div>
      <footer className="storage-directory-footer"><button type="button" className="motif-button" disabled={!!busy || !listing?.writable} onClick={() => { setCreating(true); setName(''); }}><FolderPlus size={14} />新建文件夹</button><div><button type="button" className="motif-button" disabled={busy === 'choose' || busy === 'create'} onClick={() => onOpenChange(false)}>取消</button><button type="button" className="motif-button motif-button-primary" disabled={!!busy || !listing?.writable || !listing?.parent} onClick={() => void choose()}>{busy === 'choose' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{busy === 'choose' ? '检查写入权限…' : '使用此文件夹'}</button></div></footer>
    </DialogContent>
  </Dialog>;
}
