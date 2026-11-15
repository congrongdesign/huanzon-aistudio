import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getLocalDataDirectory, removeTrashedImageMetadata, drainLocalFileCleanup, localFileCleanupStatus, deleteLocalFileByKey } from './local-backend';
import { collectStorageReferences, activeStorageJobs, fontTrash, purgeFontTrash } from './storage-lifecycle';
import { getBaseDataDir, readRuntimeConfig, writeRuntimeConfig } from './runtime-config';
import { defaultMediaRoot, mediaFolder, mediaRoot, mediaRoots } from './media-storage';
import type { CleanupKind, StorageMigration, StorageOverview, StorageScan } from './storage-management-types';

type DiskFile = { file: string; name: string; bytes: number; mtime: number; signature: string };
type Snapshot = { owner: string; scan: StorageScan; files: Map<string, DiskFile>; roots: string; };
const state = globalThis as typeof globalThis & { hzStorage?: { busy: boolean; migration: StorageMigration | null; scans: Map<string, Snapshot> } };
const storageState = (): NonNullable<typeof state.hzStorage> => state.hzStorage ||= { busy: false, migration: null, scans: new Map() };
const fingerprint = (info: { size: number; mtimeMs: number; ino: number; ctimeMs: number }) => `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
async function filesIn(folder: string): Promise<DiskFile[]> {
  const result: DiskFile[] = [];
  let entries;
  try {
    const directory = await fs.lstat(folder);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('图片目录是符号链接或不可读取，请检查储存位置');
    entries = await fs.readdir(folder, { withFileTypes: true });
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  for (const entry of entries) {
    if (!entry.isFile()) continue; // Never follow symlinks during cleanup or migration.
    const file = path.join(folder, entry.name);
    const info = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info?.isFile()) result.push({ file, name: entry.name, bytes: info.size, mtime: info.mtimeMs, signature: fingerprint(info) });
  }
  return result;
}
async function libraryFiles() {
  return (await Promise.all(mediaRoots().flatMap(root => [filesIn(mediaFolder(root, 'files')), filesIn(mediaFolder(root, 'fonts'))]))).flat();
}
async function cacheFiles() {
  // Font previews live beside originals and can also be recreated on demand.
  const fontPreviews = (await libraryFiles()).filter(file => /\.(128|512)\.webp$/.test(file.name));
  return [...await filesIn(path.join(getLocalDataDirectory(), 'preview-cache')), ...fontPreviews];
}
const isFontPreview = (file: DiskFile) => /\.(128|512)\.webp$/.test(file.name);
export async function storageOverview(): Promise<StorageOverview> {
  const cfg = readRuntimeConfig();
  const all = (await libraryFiles()).filter(file => !isFontPreview(file));
  const cache = await cacheFiles();
  const disk = await fs.statfs(mediaRoot()).then(s => ({ total: s.blocks * s.bsize, available: s.bavail * s.bsize })).catch(() => null);
  const refs = collectStorageReferences();
  const usage = { active: 0, trash: 0, unreferenced: 0 };
  const breakdown = { canvas: 0, fonts: 0, other: 0, trash: 0, unreferenced: 0 };
  for (const file of all) {
    const reasons = refs.reasons(file.name);
    const category = reasons.length === 0 ? 'unreferenced' : reasons.every(reason => reason === '回收站保留') ? 'trash' : 'active';
    usage[category] += file.bytes;
    const detail = category !== 'active' ? category : reasons.some(reason => /^(image_records|reference_images|当前作品生成配方|浏览器资产)/.test(reason)) ? 'canvas' : reasons.some(reason => /^字体/.test(reason)) ? 'fonts' : 'other';
    breakdown[detail] += file.bytes;
  }
  return { supported: true, directory: mediaRoot(), customDirectory: cfg.mediaDirectory || '', previousDirectories: mediaRoots().filter(root => root !== mediaRoot()), cacheLimitMB: cfg.previewCacheLimitMB || 256,
    libraryBytes: all.reduce((n, f) => n + f.bytes, 0), libraryCount: all.length,
    cacheBytes: cache.reduce((n, f) => n + f.bytes, 0), cacheCount: cache.length, disk, migration: storageState().migration, cleanup: localFileCleanupStatus(), usage, breakdown };
}

async function references() {
  const refs = collectStorageReferences();
  const dbPath = path.join(getLocalDataDirectory(), 'db.json');
  const db = await fs.readFile(dbPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return { image_records: [] }; throw error; });
  return { db: db as { image_records: Array<{ id: string; user_id: string; image_key?: string; edited_image_key?: string; prompt: string; deleted_at?: string }>; reference_images?: Array<{ id: string; user_id: string; image_key?: string; file_name?: string }> }, used: refs.used };
}
const rootsSignature = () => JSON.stringify(mediaRoots());
export async function scanStorage(owner: string): Promise<StorageScan> {
  if (storageState().busy) throw new Error('储存操作进行中，请完成后再扫描');
  const started = Date.now();
  const refs = await references();
  const all = (await libraryFiles()).filter(file => !isFontPreview(file));
  const cache = await cacheFiles();
  const activeJobs = activeStorageJobs();
  const scan: StorageScan = { token: randomUUID(), createdAt: new Date().toISOString(), items: [], missing: [], counts: { cache: { count: 0, bytes: 0 }, orphans: { count: 0, bytes: 0 }, trash: { count: 0, bytes: 0 } } };
  const files = new Map<string, DiskFile>();
  function add(file: DiskFile, kind: CleanupKind) {
    const id = randomUUID(); files.set(id, file);
    scan.items.push({ id, kind, name: file.name, bytes: file.bytes });
    scan.counts[kind].count++; scan.counts[kind].bytes += file.bytes;
  }
  for (const file of cache) if ((/^[a-f0-9]{64}\.webp$/.test(file.name) || isFontPreview(file)) && file.mtime < started - 60_000) add(file, 'cache');
  // A 24 hour grace period protects uploads and results not yet committed by a job.
  for (const file of all) {
    const managed = /_\d{13}_[a-z0-9]{6}\.[a-z0-9]+$/i.test(file.name) || /^[a-f0-9]{24}_[a-f0-9]{64}\.(png|jpg|webp)$/.test(file.name);
    if (!activeJobs && managed && file.mtime < started - 86_400_000 && !refs.used(file.name)) add(file, 'orphans');
  }
  for (const record of refs.db.image_records || []) {
    if (record.user_id !== owner) continue;
    const keys = [record.image_key, record.edited_image_key].filter((key): key is string => !!key);
    const found = all.filter(file => keys.includes(file.name));
    if (record.deleted_at) {
      scan.items.push({ id: record.id, name: record.prompt || '已删除的图片', kind: 'trash', bytes: found.reduce((n, f) => n + f.bytes, 0) });
      scan.counts.trash.count++;
      scan.counts.trash.bytes += found.reduce((n, f) => n + f.bytes, 0);
    } else for (const key of keys) if (!all.some(file => file.name === key)) scan.missing.push({ id: record.id, prompt: record.prompt, key });
  }
  for (const item of fontTrash(owner)) {
    const bytes = all.filter(file => item.keys.includes(file.name)).reduce((sum, file) => sum + file.bytes, 0);
    scan.items.push({ id: item.id, name: item.name, kind: 'trash', bytes });
    scan.counts.trash.count++; scan.counts.trash.bytes += bytes;
  }
  for (const reference of refs.db.reference_images || []) if (reference.user_id === owner && reference.image_key && !all.some(file => file.name === reference.image_key)) {
    scan.missing.push({ id: `reference:${reference.id}`, prompt: reference.file_name || '画布参考图', key: reference.image_key });
  }
  const protectedRefs = collectStorageReferences();
  const alreadyMissing = new Set(scan.missing.map(item => item.key));
  for (const key of protectedRefs.keys) {
    if (!/_\d{13}_[a-z0-9]{6}\.[a-z0-9]+$/i.test(key) && !/^[a-f0-9]{24}_[a-f0-9]{64}\.(png|jpg|webp)$/.test(key)) continue;
    if (alreadyMissing.has(key) || all.some(file => file.name === key)) continue;
    scan.missing.push({ id: `asset:${key}`, prompt: protectedRefs.reasons(key).join('、'), key });
  }
  const scans = storageState().scans;
  for (const [key, snapshot] of scans) if (Date.now() - Date.parse(snapshot.scan.createdAt) > 30 * 60_000) scans.delete(key);
  if (scans.size >= 10) scans.delete(scans.keys().next().value!);
  scans.set(scan.token, { owner, scan, files, roots: rootsSignature() });
  return scan;
}
export async function cleanStorage(owner: string, token: string, ids: string[]) {
  const state = storageState();
  if (activeStorageJobs()) throw new Error('生成或备份任务进行中，请完成后再清理原图');
  const snapshot = state.scans.get(token);
  if (!snapshot || snapshot.owner !== owner || Date.now() - Date.parse(snapshot.scan.createdAt) > 30 * 60_000 || snapshot.roots !== rootsSignature()) throw new Error('扫描结果已过期，请重新扫描');
  if (state.busy) throw new Error('另一项储存操作正在进行');
  const requested = [...new Set(ids)];
  if (!requested.length || requested.some(id => !snapshot.scan.items.some(item => item.id === id))) throw new Error('请选择扫描结果中的项目');
  state.busy = true;
  let removed = 0, bytes = 0, skipped = 0;
  try {
    const refs = await references(); // Recheck after user confirmation.
    const trash = new Set((refs.db.image_records || []).filter(r => r.user_id === owner && r.deleted_at).map(r => r.id));
    for (const id of requested) {
      const item = snapshot.scan.items.find(item => item.id === id)!;
      if (item.kind === 'trash') {
        if (id.startsWith('font-trash:')) {
          const keys = purgeFontTrash(owner, id);
          if (!keys) { skipped++; continue; }
          for (const key of keys) deleteLocalFileByKey(key);
          const reclaimed = drainLocalFileCleanup(); bytes += reclaimed.bytes; removed++;
          continue;
        }
        if (!trash.has(id) || !removeTrashedImageMetadata(id, owner)) { skipped++; continue; }
        removed++;
        const reclaimed = drainLocalFileCleanup();
        bytes += reclaimed.bytes;
        continue;
      }
      const file = snapshot.files.get(id)!;
      const info = await fs.lstat(file.file).catch(() => null);
      if (!info?.isFile() || fingerprint(info) !== file.signature || (item.kind === 'orphans' && refs.used(file.name))) { skipped++; continue; }
      try {
        // Final reference check and unlink share one synchronous main-service turn.
        const syncFs = await import('node:fs');
        if (item.kind === 'orphans' && collectStorageReferences().used(file.name)) { skipped++; continue; }
        const current = syncFs.lstatSync(file.file);
        if (fingerprint(current) !== file.signature) { skipped++; continue; }
        if (item.kind === 'orphans') {
          deleteLocalFileByKey(file.name, [{ file: file.file, signature: `${current.dev}:${current.ino}:${current.size}:${current.mtimeMs}:${current.ctimeMs}` }]);
          const result = drainLocalFileCleanup(); bytes += result.bytes; removed += result.removed;
        } else { syncFs.unlinkSync(file.file); removed++; bytes += file.bytes; }
      } catch { skipped++; }
    }
    state.scans.delete(token);
    return { removed, bytes, skipped };
  } finally { state.busy = false; }
}

export async function setCacheLimit(mb: number) {
  if (!Number.isInteger(mb) || mb < 64 || mb > 4096) throw new Error('缓存上限应为 64–4096 MB');
  writeRuntimeConfig({ previewCacheLimitMB: mb });
}
function inside(parent: string, target: string) { const relative = path.relative(parent, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
async function hash(file: string) { const handle = await fs.open(file); const h = createHash('sha256'); try { for await (const chunk of handle.createReadStream()) h.update(chunk); return h.digest('hex'); } finally { await handle.close(); } }
export async function changeStorageDirectory(raw: string, migrate: boolean) {
  const state = storageState();
  if (state.busy) throw new Error('另一项储存操作正在进行');
  if (raw.trim() && !path.isAbsolute(raw.trim())) throw new Error('请输入绝对路径或使用选择文件夹');
  const requested = raw.trim() || defaultMediaRoot();
  if (requested === path.parse(requested).root) throw new Error('请选择一个专用文件夹');
  await fs.mkdir(requested, { recursive: true });
  const target = await fs.realpath(requested);
  const current = await fs.realpath(mediaRoot()).catch(() => mediaRoot());
  if (target !== current && mediaRoots().some(root => root !== target && (inside(root, target) || inside(target, root)))) throw new Error('新目录不能与现有图片库相互包含，请选择独立文件夹');
  const probe = path.join(target, `.huanzon-write-test-${randomUUID()}`);
  try { await fs.writeFile(probe, '', { flag: 'wx' }); } finally { await fs.unlink(probe).catch(() => {}); }
  if (state.busy) throw new Error('另一项储存操作正在进行');
  state.busy = true;
  try {
    const sources = await libraryFiles();
    const totalBytes = sources.reduce((n, f) => n + f.bytes, 0);
    const disk = await fs.statfs(target);
    if (migrate && disk.bavail * disk.bsize < totalBytes + 64 * 1024 * 1024) throw new Error('目标磁盘可用空间不足');
    for (const source of sources) {
      const kind = source.file.includes(`${path.sep}font-library${path.sep}files${path.sep}`) ? 'fonts' : 'files';
      const destination = path.join(mediaFolder(target, kind), source.name);
      const existing = await fs.lstat(destination).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (existing && (!existing.isFile() || await hash(source.file) !== await hash(destination))) throw new Error(`目标存在不同内容的同名文件：${source.name}，请更换目录`);
    }
    const canonicalDefault = await fs.realpath(defaultMediaRoot()).catch(() => defaultMediaRoot());
    const previous = mediaRoots().filter(root => root !== target);
    // Switch writes first. Reads continue to search old roots during the migration.
    writeRuntimeConfig({ mediaDirectory: target === canonicalDefault ? '' : target, mediaPreviousDirectories: previous });
    state.scans.clear();
    if (!migrate) { state.busy = false; return null; }
    const job: StorageMigration = { id: randomUUID(), status: 'running', total: sources.length, processed: 0, bytes: 0 };
    state.migration = job;
    void (async () => {
      try {
        for (const source of sources) {
          const kind = source.file.includes(`${path.sep}font-library${path.sep}files${path.sep}`) ? 'fonts' : 'files';
          const folder = mediaFolder(target, kind); await fs.mkdir(folder, { recursive: true });
          const destination = path.join(folder, source.name);
          if (destination !== source.file) {
            const before = await fs.lstat(source.file);
            if (fingerprint(before) !== source.signature) throw new Error(`文件正在修改，已保留原文件：${source.name}`);
            const sourceHash = await hash(source.file);
            const temporary = path.join(folder, `.migration-${randomUUID()}.tmp`);
            try {
              await fs.copyFile(source.file, temporary, fs.constants.COPYFILE_EXCL);
              if (await hash(temporary) !== sourceHash) throw new Error(`文件校验失败：${source.name}`);
              await fs.utimes(temporary, before.atime, before.mtime);
              try { await fs.link(temporary, destination); }
              catch (e) {
                const code = (e as NodeJS.ErrnoException).code;
                if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(code || '')) {
                  try { await fs.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL); }
                  catch (copyError) { if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') { await fs.unlink(destination).catch(() => {}); throw copyError; } }
                } else if (code !== 'EEXIST') throw e;
              }
              const destInfo = await fs.lstat(destination);
              if (!destInfo.isFile() || await hash(destination) !== sourceHash) throw new Error(`目标文件内容冲突，已保留原文件：${source.name}`);
            } finally { await fs.unlink(temporary).catch(() => {}); }
            const after = await fs.lstat(source.file);
            if (fingerprint(after) !== source.signature) throw new Error(`文件正在修改，已保留原文件：${source.name}`);
            await fs.unlink(source.file);
          }
          job.processed++; job.bytes += source.bytes;
        }
        job.status = 'completed';
      } catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : '迁移中断，可重试；未迁移文件仍从原目录读取'; }
      finally { state.busy = false; }
    })();
    return job;
  } catch (error) { state.busy = false; throw error; }
}
