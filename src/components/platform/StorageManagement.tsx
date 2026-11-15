'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, FolderOpen, HardDrive, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { syncStorageBrowserReferences } from '@/components/StorageReferenceSync';
import { StorageDirectoryPicker } from './StorageDirectoryPicker';
import { SettingsCard, SettingsRow, SettingsSection } from './Settings';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { formatStorageBytes as size, type CleanupKind, type StorageOverview, type StorageScan } from '@/lib/storage-management-types';

type Confirm = 'directory' | 'clean' | null;
const labels: Record<CleanupKind, string> = { cache: '预览与缩略图缓存', orphans: '未引用的图片文件', trash: '已删除的画布与字体作品' };
const descriptions: Record<CleanupKind, string> = {
  cache: '可重新生成。最近一分钟使用的缓存暂时保留。',
  orphans: '超过 24 小时，且未被作品、回收站、素材、字体或已登记浏览器资产使用的文件。',
  trash: '删除后仍占空间，可在回收站恢复。永久清理后无法恢复；其他对象正在使用的文件会保留。',
};
async function api(body?: object) {
  const response = await fetch('/api/storage-management', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '储存操作失败');
  return data;
}
export function StorageManagement() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [directory, setDirectory] = useState('');
  const [migrate, setMigrate] = useState(true);
  const [limit, setLimit] = useState(256);
  const [scan, setScan] = useState<StorageScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [expanded, setExpanded] = useState<CleanupKind | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  type StorageDesktop = Window & { electronAPI?: { selectStorageDirectory?: (defaultPath?: string) => Promise<string | null> } };
  const refresh = useCallback(async (initialize = false) => {
    const value: StorageOverview = await api(); setOverview(value);
    if (initialize && value.supported) { setDirectory(value.customDirectory); setLimit(value.cacheLimitMB); }
  }, []);
  useEffect(() => {
    let live = true;
    api().then((value: StorageOverview) => { if (!live) return; setOverview(value); if (value.supported) { setDirectory(value.customDirectory); setLimit(value.cacheLimitMB); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  const migrating = overview?.migration?.status === 'running';
  useEffect(() => {
    if (!migrating) return;
    const timer = setInterval(() => { void refresh().catch(e => setError(e.message)); }, 1500);
    return () => clearInterval(timer);
  }, [migrating, refresh]);
  async function perform(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(''); }
  }
  async function chooseDirectory() {
    const nativePicker = (window as StorageDesktop).electronAPI?.selectStorageDirectory;
    if (!nativePicker) { setPickerOpen(true); return; }
    await perform('choose', async () => {
      let value: string | null;
      try { value = await nativePicker(directory || overview?.directory); }
      catch { setPickerOpen(true); return; }
      if (!value) return;
      const checked = await api({ action: 'validate-directory', directory: value });
      setDirectory(checked.isDefault ? '' : checked.directory);
    });
  }
  async function inspect() {
    await perform('scan', async () => {
      await syncStorageBrowserReferences();
      const result: StorageScan = await api({ action: 'scan' }); setScan(result);
      setSelected(new Set(result.items.filter(item => item.kind === 'cache').map(item => item.id)));
      setExpanded(null); await refresh();
    });
  }
  const selectedItems = scan?.items.filter(item => selected.has(item.id)) || [];
  const selectedBytes = selectedItems.reduce((n, item) => n + item.bytes, 0);
  const destructive = selectedItems.some(item => item.kind !== 'cache');
  const disabled = !!busy || migrating;
  const job = overview?.migration;
  if (!overview && !error) return <div className="space-y-3" aria-busy="true" aria-label="正在读取储存信息">{[1, 2, 3].map(n => <div key={n} className="h-24 rounded-lg bg-muted motion-safe:animate-pulse" />)}</div>;
  if (overview && !overview.supported) return <SettingsSection title="储存管理" description={overview.reason}><p className="text-xs leading-6 text-muted-foreground">下载位置可在下方独立设置。</p></SettingsSection>;
  return <div className="storage-management">
    <SettingsSection title="储存管理" description="管理原图、预览缓存和磁盘空间。操作会立即生效。">
      <div className="storage-overview">
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">图片库占用</span><button type="button" className="motif-button" disabled={!!busy} onClick={() => void perform('refresh', () => refresh())} aria-label="刷新储存用量"><RefreshCw size={13} className={busy === 'refresh' ? 'animate-spin' : ''} /></button></div>
        <div className="mt-1 text-2xl font-medium tabular-nums tracking-tight">{size(overview?.libraryBytes || 0)}<span className="ml-3 text-xs font-normal text-muted-foreground">{overview?.libraryCount || 0} 个文件</span></div>
        {overview?.usage && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>正在使用 {size(overview.usage.active)}</span><span>回收站独占 {size(overview.usage.trash)}</span><span>待核实 / 未引用 {size(overview.usage.unreferenced)}</span></div>}
        {overview?.breakdown && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>画布与参考图 {size(overview.breakdown.canvas)}</span><span>字体创作与收藏 {size(overview.breakdown.fonts)}</span><span>转换 / 批处理 / 其他素材 {size(overview.breakdown.other)}</span></div>}
        <div className="storage-usage-bar" aria-hidden="true"><span style={{ width: `${overview && overview.libraryBytes + overview.cacheBytes > 0 ? overview.libraryBytes / (overview.libraryBytes + overview.cacheBytes) * 100 : 0}%` }} /></div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>预览缓存 {size(overview?.cacheBytes || 0)}</span><span>{overview?.disk ? `当前磁盘可用 ${size(overview.disk.available)} / ${size(overview.disk.total)}` : '磁盘空间暂不可用'}</span></div>
      </div>
    </SettingsSection>
    {overview?.cleanup && (overview.cleanup.pending > 0 || overview.cleanup.failed > 0) && <SettingsSection title="原图回收任务" description={`待处理 ${overview.cleanup.pending} 项 · 失败 ${overview.cleanup.failed} 项；生成或备份期间暂停回收。`}><button type="button" className="motif-button" disabled={disabled} onClick={() => void perform('retry', async () => { await syncStorageBrowserReferences(); const result = await api({ action: 'retry-cleanup' }); await refresh(); setMessage(`本次释放 ${size(result.bytes)}`); })}>重试原图回收</button><div className="mt-2 text-xs text-muted-foreground">{overview.cleanup.recent.filter(item => item.error).slice(-3).map(item => <p key={item.key}>{item.error}</p>)}</div></SettingsSection>}
    {error && <div role="alert" className="storage-feedback text-destructive"><AlertTriangle size={15} /><span>{error}</span><button type="button" className="motif-link ml-auto shrink-0" onClick={() => void perform('refresh', () => refresh(true))}>重试</button></div>}
    {message && <div role="status" className="storage-feedback"><Check size={15} /><span>{message}</span></div>}
    <SettingsSection title="图片储存位置" description="生成、编辑及导入的图片和字体成品统一保存于此；项目索引与设置仍保存在本机。">
      <SettingsCard><div className="space-y-3 p-4">
        <div className="text-xs font-medium">图片库文件夹</div>
        <div className="storage-location-selection"><FolderOpen size={20} className="shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="text-xs font-medium">{directory ? directory.split(/[\\/]/).filter(Boolean).pop() : '应用默认文件夹'}</div><p className="mt-1 break-all text-[11px] leading-5 text-muted-foreground">{directory || (overview?.customDirectory ? '应用默认位置' : overview?.directory) || '尚未读取'}</p></div><button type="button" className="motif-button shrink-0" disabled={disabled} onClick={() => void chooseDirectory()}>{busy === 'choose' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}选择文件夹</button></div>
        {overview && directory !== overview.customDirectory && <p role="status" className="text-[11px] leading-5 text-muted-foreground">已选新位置，点击“应用储存位置”后生效。当前图片库：<span className="break-all">{overview.directory}</span></p>}
        <p className="text-[11px] leading-5 text-muted-foreground">支持本机、外置硬盘或已挂载的 NAS。选择后自动检查写入权限。</p>
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={migrate} disabled={disabled} onChange={e => setMigrate(e.target.checked)} className="mt-1 accent-current" /><span>同时迁移已有图片<span className="block text-[11px] text-muted-foreground">逐个校验后移动；未勾选时仅更改新图片位置，旧图片仍可访问。</span></span></label>
        <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="motif-link text-xs" disabled={disabled} onClick={() => setDirectory('')}>使用默认位置</button><button type="button" className="motif-button" disabled={disabled || !overview} onClick={() => setConfirm('directory')}><HardDrive size={14} />{migrating ? '正在迁移…' : migrate && directory === overview?.customDirectory ? '检查并迁移旧目录' : '应用储存位置'}</button></div>
      </div></SettingsCard>
      {job && <div className="mt-3 space-y-2 text-xs" role="status"><div className="flex items-center gap-2">{job.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : job.status === 'failed' ? <AlertTriangle size={13} /> : <Check size={13} />}<span>{job.status === 'running' ? '迁移中' : job.status === 'failed' ? '迁移未完成' : '迁移完成'} · {job.processed} / {job.total} 个文件</span></div>{job.status === 'running' && <progress aria-label="图片迁移进度" value={job.processed} max={job.total || 1} className="w-full" />}{job.error && <p className="text-destructive leading-5">{job.error}。可再次点击迁移重试。</p>}</div>}
    </SettingsSection>
    <SettingsSection title="缓存与空间清理" description="先检查空间，再选择要清理的项目。缺失原图只报告，不自动移除记录。">
      <SettingsCard><SettingsRow label="预览缓存上限" description="画布预览超过上限时按最早生成时间清理；字体缩略图可在下方手动清理。"><div className="flex items-center gap-2"><select aria-label="预览缓存上限" className="motif-field" disabled={disabled} value={limit} onChange={e => setLimit(Number(e.target.value))}>{[64, 128, 256, 512, 1024, 2048, 4096].map(value => <option key={value} value={value}>{value < 1024 ? `${value} MB` : `${value / 1024} GB`}</option>)}</select><button type="button" className="motif-button" disabled={disabled || limit === overview?.cacheLimitMB} onClick={() => void perform('limit', async () => { await api({ action: 'cache-limit', limitMB: limit }); await refresh(); setMessage('缓存上限已保存'); })}>应用</button></div></SettingsRow><SettingsRow label="检查可清理空间" description="检查本机全部项目及字体索引。最近创建的文件会自动保留。"><button type="button" className="motif-button" disabled={disabled} onClick={() => void inspect()}>{busy === 'scan' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{busy === 'scan' ? '正在检查…' : scan ? '重新扫描' : '开始扫描'}</button></SettingsRow></SettingsCard>
      {scan && <div className="mt-4 space-y-3">
        <p className="text-[11px] text-muted-foreground">检查于 {new Date(scan.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 结果 30 分钟内有效</p>
        <SettingsCard>{(['cache', 'orphans', 'trash'] as const).map(kind => {
          const items = scan.items.filter(item => item.kind === kind);
          const checked = items.length > 0 && items.every(item => selected.has(item.id));
          return <div key={kind} className="storage-cleanup-category"><div className="flex items-start gap-3 p-4"><input type="checkbox" aria-label={`选择${labels[kind]}`} checked={checked} disabled={disabled || !items.length} onChange={e => setSelected(previous => { const next = new Set(previous); for (const item of items) { if (e.target.checked) next.add(item.id); else next.delete(item.id); } return next; })} className="mt-1 accent-current" /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2 text-xs font-medium"><span>{labels[kind]}</span><span className="shrink-0 tabular-nums">{size(scan.counts[kind].bytes)}</span></div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{descriptions[kind]}</p><button type="button" className="motif-link mt-1 text-[11px]" disabled={!items.length} aria-expanded={expanded === kind} onClick={() => setExpanded(expanded === kind ? null : kind)}>{items.length} 项{items.length > 0 ? expanded === kind ? ' · 收起' : ' · 查看明细' : ''}</button></div></div>{expanded === kind && <div className="storage-file-list">{items.map(item => <label key={item.id} className="flex items-center gap-2 py-2 text-[11px]"><input type="checkbox" disabled={disabled} checked={selected.has(item.id)} onChange={e => setSelected(previous => { const next = new Set(previous); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next; })} className="accent-current" /><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span><span className="shrink-0 text-muted-foreground">{size(item.bytes)}</span></label>)}</div>}</div>;
        })}</SettingsCard>
        {scan.missing.length > 0 && <details className="rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer">{scan.missing.length} 个原文件缺失，建议从备份恢复</summary><p className="mt-2 text-[11px] leading-5 text-muted-foreground">请先检查外置磁盘是否连接。记录将被保留。</p><div className="max-h-36 overflow-auto">{scan.missing.map((item, i) => <p key={`${item.id}-${i}`} className="mt-2 break-all text-[11px]">{item.prompt || '未命名图片'} · {item.key}</p>)}</div></details>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">已选 {selectedItems.length} 项 · 预计最多 {size(selectedBytes)}</p><button type="button" className="motif-button" disabled={disabled || !selectedItems.length} onClick={() => setConfirm('clean')}><Trash2 size={14} />{busy === 'clean' ? '正在清理…' : '清理所选'}</button></div>
      </div>}
    </SettingsSection>
    <StorageDirectoryPicker open={pickerOpen} initialDirectory={directory || overview?.directory || ''} onOpenChange={setPickerOpen} onSelect={(value, isDefault) => { setDirectory(isDefault ? '' : value); setError(''); }} />
    <AlertDialog open={confirm !== null} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><AlertDialogContent className="storage-confirm-dialog"><AlertDialogTitle>{confirm === 'directory' ? migrate ? '更改位置并迁移图片？' : '更改新图片的储存位置？' : destructive ? '永久清理所选项目？' : '清理预览缓存？'}</AlertDialogTitle><AlertDialogDescription>{confirm === 'directory' ? <span className="space-y-3 block"><span className="block break-all">目标：{directory || '应用默认文件夹'}</span><span className="block">{migrate ? '校验每个文件后移动到新目录。过程中可以继续使用，未迁移的文件会从旧目录读取。请保持磁盘连接。' : '之后生成和导入的图片会保存到新目录。已有图片保留在原位置并继续可用。'}</span></span> : <span className="space-y-3 block"><span className="block">将处理 {selectedItems.length} 项，预计最多释放 {size(selectedBytes)}。执行前会再次检查文件引用和变更。</span><span className="block">{destructive ? '未引用的文件和回收站记录清除后无法恢复。缺失原图记录不会删除，共用文件和已恢复的回收站记录会保留。' : '仅移除可重新生成的缩略图和预览，不影响原图。下次浏览时会重新生成。'}</span></span>}</AlertDialogDescription>{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={!!busy}>取消</AlertDialogCancel><button type="button" className="motif-button motif-button-primary" disabled={!!busy} onClick={() => void perform(confirm === 'directory' ? 'directory' : 'clean', async () => {
      if (confirm === 'directory') { await api({ action: 'directory', directory, migrate }); setScan(null); setSelected(new Set()); setMessage(migrate ? '储存位置已应用，迁移任务已启动' : '新图片储存位置已应用'); await refresh(true); }
      else { await syncStorageBrowserReferences(); const result = await api({ action: 'clean', token: scan!.token, ids: [...selected] }); setScan(null); setSelected(new Set()); setMessage(`已处理 ${result.removed} 项，释放 ${size(result.bytes)}${result.skipped ? `；${result.skipped} 项已变更或被引用，已跳过` : ''}`); await refresh(); }
      setConfirm(null);
    })}>{busy ? '处理中…' : confirm === 'directory' ? '确认应用' : '确认清理'}</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
