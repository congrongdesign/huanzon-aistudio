'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ImportSnapshot, LibraryKind } from './library-import-types';

export type PendingImport = { id: string; kind: LibraryKind; name: string; error?: string };
type Snapshot = ImportSnapshot & { pending: PendingImport[]; error: string };
let snapshot: Snapshot = { batches: [], items: [], revision: -1, total: 0, active: 0, pending: [], error: '' };
const listeners = new Set<() => void>();
let headers: Record<string, string> = {}, polling = false;
const registrationRetry = new Map<string, () => Promise<void>>();
const webFiles = new Map<string, File>();
const webQueue: string[] = [];
let transmitting = false;
function publish(next: Partial<Snapshot>) { snapshot = { ...snapshot, ...next }; for (const fn of listeners) fn(); }
export function useLibraryImports() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snapshot, () => snapshot); }
export function setImportHeaders(value: Record<string, string>) { headers = value; }
async function api(body?: unknown) {
  const response = await fetch('/api/library-import', { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store' });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '导入服务不可用'); return data;
}
export async function refreshLibraryImports() {
  if (polling) return; polling = true;
  try {
    const data: ImportSnapshot = await api();
    if (data.revision !== snapshot.revision || data.total !== snapshot.total) {
      const previous = new Map(snapshot.items.map(i => [i.id, i]));
      const kinds = new Set(data.items.filter(i => i.cardId && previous.get(i.id)?.updatedAt !== i.updatedAt).map(i => i.kind));
      if (data.revision !== snapshot.revision) for (const batch of data.batches) kinds.add(batch.kind);
      publish({ ...data, error: '' });
      for (const kind of kinds) window.dispatchEvent(new CustomEvent('hz-library-import-changed', { detail: { kind } }));
    } else if (snapshot.error) publish({ error: '' });
  } catch (e) { publish({ error: e instanceof Error ? e.message : '导入进度暂时不可用' }); }
  finally { polling = false; }
}
export function useImportRefresh(kind: LibraryKind, callback: () => void) {
  useEffect(() => { const handler = (event: Event) => { if ((event as CustomEvent).detail?.kind === kind) callback(); }; window.addEventListener('hz-library-import-changed', handler); return () => window.removeEventListener('hz-library-import-changed', handler); }, [kind, callback]);
}
function uploadNext() {
  if (transmitting) return;
  const id = webQueue.shift(); if (!id) return;
  const file = webFiles.get(id); if (!file) return uploadNext();
  transmitting = true;
  void fetch(`/api/library-import/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: file }).then(async response => {
    if (!response.ok) throw new Error((await response.json()).error || '图片尚未完整传入');
    webFiles.delete(id); publish({ pending: snapshot.pending.filter(p => p.id !== id) });
  }).catch(e => { publish({ pending: snapshot.pending.map(p => p.id === id ? { ...p, error: e.message } : p) }); }).finally(() => { transmitting = false; void refreshLibraryImports(); uploadNext(); });
}
export function retryImportUpload(id: string) { if (registrationRetry.has(id)) { void registrationRetry.get(id)!(); return; } if (webFiles.has(id)) { publish({ pending: snapshot.pending.map(p => p.id === id ? { ...p, error: undefined } : p) }); webQueue.push(id); uploadNext(); } }
export async function enqueueLibraryFiles(kind: LibraryKind, files: FileList | File[], options: { groupId?: string; projectId?: string | null; targetId?: string; authHeaders: Record<string, string> }) {
  setImportHeaders(options.authHeaders);
  const input = Array.from(files);
  const rejected = input.filter(f => !f.size || f.size > 25 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(f.name));
  const valid = input.filter(f => !rejected.includes(f));
  if (!valid.length) throw new Error('请选择 25 MiB 以内的 JPG、PNG 或 WebP 图片');
  const descriptors = valid.map(file => ({ id: crypto.randomUUID(), file }));
  publish({ pending: [...snapshot.pending, ...descriptors.map(d => ({ id: d.id, name: d.file.name, kind }))], error: rejected.length ? `${rejected.length} 个文件不受支持或超过大小限制，已跳过` : '' });
  window.dispatchEvent(new Event('hz-library-import-open'));
  // Allow a paint before registration. The queue lives outside the library component.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  for (let offset = 0; offset < descriptors.length; offset += 100) {
    const chunk = descriptors.slice(offset, offset + 100);
    const bridge = (window as Window & { electronAPI?: { prepareLibraryImport?: (files: File[]) => Promise<(string | null)[]> } }).electronAPI;
    let tokens: (string | null)[] = []; try { tokens = await bridge?.prepareLibraryImport?.(chunk.map(d => d.file)) || []; } catch { /* Safe fallback to bounded web upload. */ }
    const batchId = crypto.randomUUID();
    const register = async () => { try {
      await api({ id: batchId, kind, groupId: options.groupId || '', projectId: options.projectId || null, targetId: options.targetId, files: chunk.map((d, index) => ({ id: d.id, name: d.file.name, bytes: d.file.size, sourceToken: tokens[index] || undefined })) });
      chunk.forEach((d, index) => {
        registrationRetry.delete(d.id);
        if (tokens[index]) publish({ pending: snapshot.pending.filter(p => p.id !== d.id) });
        else { webFiles.set(d.id, d.file); webQueue.push(d.id); }
      });
      uploadNext(); void refreshLibraryImports();
    } catch (e) {
      chunk.forEach(d => registrationRetry.set(d.id, register));
      publish({ pending: snapshot.pending.map(p => chunk.some(d => d.id === p.id) ? { ...p, error: e instanceof Error ? e.message : '登记失败，请重新选择图片' } : p) });
    } };
    await register();
  }
}
export async function actOnImport(batchId: string, action: string) { const data = await api({ batchId, action }); publish(data); for (const kind of ['fonts', 'prompts', 'cases']) window.dispatchEvent(new CustomEvent('hz-library-import-changed', { detail: { kind } })); }
export function useLibraryDrop(kind: LibraryKind, options: Parameters<typeof enqueueLibraryFiles>[2]) {
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState('');
  const [dragCount, setDragCount] = useState(0);
  useEffect(() => {
    const clear = () => { setDragging(false); setDropTarget(''); document.querySelectorAll('[data-import-hover]').forEach(el => el.removeAttribute('data-import-hover')); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') clear(); };
    window.addEventListener('drop', clear, true); window.addEventListener('dragend', clear); window.addEventListener('blur', clear); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('drop', clear, true); window.removeEventListener('dragend', clear); window.removeEventListener('blur', clear); window.removeEventListener('keydown', escape); };
  }, []);
  const enqueue = (files: FileList | File[], groupId = options.groupId, targetId = options.targetId) => enqueueLibraryFiles(kind, files, { ...options, groupId, targetId });
  const groupDropProps = (groupId: string, label = '未分组') => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; e.currentTarget.setAttribute('data-import-hover','true'); setDragging(true); setDropTarget(label); setDragCount(e.dataTransfer.items.length); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { e.currentTarget.removeAttribute('data-import-hover'); setDropTarget(''); } },
    onDrop: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.currentTarget.removeAttribute('data-import-hover'); setDragging(false); setDropTarget(''); void enqueue(e.dataTransfer.files, groupId).catch(error => publish({ error: error.message })); } },
  });
  return { dragging, dropTarget, dragCount, enqueue, groupDropProps, dropProps: {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); setDropTarget(''); setDragCount(e.dataTransfer.items.length); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setDragging(false); setDropTarget(''); void enqueue(e.dataTransfer.files).catch(error => publish({ error: error.message })); } },
  } };
}
