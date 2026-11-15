import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getBaseDataDir } from './runtime-config';
import { mediaFolder, mediaRoots } from './media-storage';
import type { ProjectArchiveAsset, ProjectArchiveEntry } from './project-archive-types';

export type MediaCleanupTask = {
  id: string; key: string; status: 'pending' | 'completed' | 'retained' | 'failed';
  reason: string; requestedAt: string; finishedAt?: string; bytes: number; attempts: number; detail?: string; error?: string;
  copies?: { file: string; signature: string }[];
};
type JsonRecord = Record<string, unknown>;
export const fileFingerprint = (s: fs.Stats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
export function storageKeys(value: unknown): string[] {
  const keys = new Set<string>();
  function visit(item: unknown) {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/\/api\/(?:local|font)-file\/([^\s"'<>?#\\]+)/g)) {
        try { keys.add(decodeURIComponent(match[1])); } catch { /* Malformed URLs cannot name a managed key. */ }
      }
      if (/^[^/\\\s]+_\d{13}_[a-z0-9]{6}\.[a-z0-9]+$/i.test(item) || /^[a-f0-9]{24}_[a-f0-9]{64}\.(png|jpg|webp)$/.test(item)) keys.add(item);
      // User-created strings can themselves contain JSON-encoded image URLs.
      if ((item.startsWith('{') || item.startsWith('[')) && item.length < 5_000_000) {
        try { visit(JSON.parse(item)); } catch { /* Plain text. */ }
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') for (const [name, child] of Object.entries(item)) {
      if (/^(image_key|edited_image_key|asset_key|source_image_key|preview_image_key|cleaned_background_key|file_key|prepared_pdf_key|key)$/.test(name) && typeof child === 'string' && !/[\\/]/.test(child)) keys.add(child);
      visit(child);
    }
  }
  visit(value); return [...keys];
}

// Known historical indexes deliberately do not retain original image bytes forever.
// Unknown JSON indexes remain protected until a typed adapter is added.
export function collectStorageReferences() {
  const refs = new Map<string, Set<string>>();
  const base = getBaseDataDir(); const data = path.join(base, 'local-data');
  const dbFile = path.join(data, 'db.json');
  const primary = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) as JsonRecord : null;
  const projects = new Set(Array.isArray(primary?.projects) ? (primary.projects as JsonRecord[]).map(row => String(row.id)) : []);
  const images = new Set(Array.isArray(primary?.image_records) ? (primary.image_records as JsonRecord[]).map(row => String(row.id)) : []);
  const projectBrowserEntry = /^(?:hz_chat_draft_|hz_canvas_reference_layouts_v1:)([a-f0-9-]{36})$/i;
  const retain = (value: unknown, reason: string) => {
    for (const key of storageKeys(value)) { if (!refs.has(key)) refs.set(key, new Set()); refs.get(key)!.add(reason); }
  };
  function visit(folder: string) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (['files', 'preview-cache', 'node_modules', 'logs', '.git', 'backups', 'backup-work', 'storage-reports'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const relative = path.relative(base, file).split(path.sep).join('/');
      if (['project-archive-jobs.json', 'project-backup-catalog.json', 'storage-backup-evidence.json', 'storage-cleanup-history.json'].includes(relative)) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`索引无法读取，已停止清理：${relative}`); }
      if (file === path.join(data, 'db.json')) {
        const db = parsed as JsonRecord;
        if (!Array.isArray(db.image_records)) throw new Error('图片索引格式异常，已停止清理');
        for (const [table, rows] of Object.entries(db)) {
          if (['media_cleanup_tasks', 'chat_messages', 'design_operations', 'asset_index_jobs', 'asset_index_entries'].includes(table) || !Array.isArray(rows)) continue;
          for (const row of rows as JsonRecord[]) {
            // Historical generation inputs are lineage, not a permanent lease.
            const { reference_images: _history, ...current } = row;
            retain(current, table === 'image_records' && row.deleted_at ? '回收站保留' : `${table} · ${row.project_id || row.id || '当前资源'}`);
          }
        }
      } else if (relative === 'local-data/generation-jobs.json') {
        // While a job runs its input remains in memory; block orphan GC separately.
        const jobs = parsed as JsonRecord[];
        if (!Array.isArray(jobs)) throw new Error('生成任务索引格式异常，已停止清理');
        for (const job of jobs) if (['queued', 'running'].includes(String(job.status))) retain(job, '正在生成');
      } else if (relative.startsWith('local-data/browser-references/')) {
        const doc = parsed as { entries?: { name: string; keys: string[]; expiresAt?: string }[] };
        if (!Array.isArray(doc.entries)) throw new Error('浏览器引用索引异常，已停止清理');
        for (const entry of doc.entries) {
          const scope = projectBrowserEntry.exec(entry.name);
          if (primary && scope && !projects.has(scope[1])) continue;
          for (const key of Date.parse(entry.expiresAt || '9999-01-01') > Date.now() ? entry.keys : []) {
          if (!refs.has(key)) refs.set(key, new Set()); refs.get(key)!.add(`浏览器资产 · ${entry.name}`);
          }
        }
      } else if (/^local-data\/font-library\/[^/]+\/recipes\/[^/]+\.json$/.test(relative)) {
        // A recipe belongs to its image. Archived/deleted projects must not lease
        // historical inputs forever; collected font cards own independent copies.
        if (images.has(path.basename(file, '.json'))) retain(parsed, '当前作品生成配方');
      } else if (/^local-data\/font-creation\/[^/]+\/[^/]+\.json$/.test(relative)) {
        const session = parsed as JsonRecord;
        if (!Array.isArray(session.runs)) throw new Error('字体创作索引异常，已停止清理');
        const { runs, ...draft } = session;
        retain(draft, '字体创作草稿与撤销');
        for (const run of runs as JsonRecord[]) retain(run, run.deletedAt ? '回收站保留' : '字体创作作品');
      } else if (/^local-data\/case-library\/[^/]+\/index\.json$/.test(relative)) {
        const index = parsed as JsonRecord;
        if (!Array.isArray(index.items)) throw new Error('参考图库索引异常，已停止清理');
        for (const item of index.items as JsonRecord[]) retain(item, item.deletedAt ? '参考图库回收站' : '案例中心参考图');
      } else if (/^local-data\/font-library\/[^/]+\/index\.json$/.test(relative)) {
        const index = parsed as JsonRecord;
        if (!Array.isArray(index.cards)) throw new Error('字体库索引异常，已停止清理');
        for (const card of index.cards as JsonRecord[]) retain(card, card.deletedAt ? '回收站保留' : '字体库收藏');
      } else retain(parsed, relative);
    }
  }
  visit(base);
  return { used: (key: string) => refs.has(key), reasons: (key: string) => [...(refs.get(key) || [])], keys: [...refs.keys()] };
}

export function activeStorageJobs(): boolean {
  const state = globalThis as typeof globalThis & { hzStorage?: { migration?: { status?: string } } };
  if (state.hzStorage?.migration?.status === 'running') return true;
  const base = getBaseDataDir();
  for (const [relative, statuses] of [['local-data/generation-jobs.json', ['queued', 'running']], ['project-archive-jobs.json', ['queued', 'running']]] as const) {
    const file = path.join(base, relative); if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
    if (!Array.isArray(jobs)) throw new Error('任务索引异常，已停止原图清理');
    if (jobs.some((job: JsonRecord) => (statuses as readonly string[]).includes(String(job.status)))) return true;
  }
  return false;
}

export function managedCopies(key: string) {
  if (!key || key !== path.basename(key) || /[\\/]/.test(key)) throw new Error('无效的原图 key');
  const files: { file: string; bytes: number; signature: string }[] = [];
  for (const root of mediaRoots()) for (const kind of ['files', 'fonts'] as const) {
    const folder = mediaFolder(root, kind);
    if (!fs.existsSync(folder)) continue;
    const directory = fs.lstatSync(folder); if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('媒体目录是符号链接或不可用');
    const file = path.join(folder, key);
    try { const info = fs.lstatSync(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('原图不是普通文件'); files.push({ file, bytes: info.size, signature: fileFingerprint(info) }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return files;
}
export function deleteManagedCopies(key: string, expected?: { file: string; signature: string }[]) {
  let bytes = 0, removed = 0; const errors: string[] = [];
  for (const copy of managedCopies(key)) {
    if (expected && !expected.some(item => item.file === copy.file && item.signature === copy.signature)) continue;
    // Synchronous check+unlink cannot interleave with a main-service reference commit.
    if (fileFingerprint(fs.lstatSync(copy.file)) !== copy.signature) continue;
    try { fs.unlinkSync(copy.file); bytes += copy.bytes; removed++; }
    catch (error) { errors.push(`${copy.file}: ${error instanceof Error ? error.message : error}`); }
  }
  return { bytes, removed, errors };
}

export function saveBrowserReferences(owner: string, clientId: string, entries: { name: string; keys: string[]; expiresAt?: string }[]) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientId) || entries.length > 5000 || entries.some(e => typeof e.name !== 'string' || !Array.isArray(e.keys) || e.keys.length > 10000 || e.keys.some(k => typeof k !== 'string' || /[\\/]/.test(k)))) throw new Error('浏览器引用格式无效');
  const dir = path.join(getBaseDataDir(), 'local-data', 'browser-references'); fs.mkdirSync(dir, { recursive: true });
  const name = createHash('sha256').update(`${owner}:${clientId}`).digest('hex'); const file = path.join(dir, `${name}.json`);
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ owner, clientId, entries, updatedAt: new Date().toISOString() })); fs.renameSync(tmp, file);
}

export function registerVerifiedBackup(root: string, entry: ProjectArchiveEntry, assets: ProjectArchiveAsset[]) {
  const file = path.join(getBaseDataDir(), 'storage-backup-evidence.json');
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (!Array.isArray(previous)) throw new Error('备份资源登记损坏，原项目保留');
  const records = [...previous.filter(item => item.entryId !== entry.id), {
    entryId: entry.id, projectId: entry.projectId, root, relativePath: entry.relativePath, packageSha256: entry.checksum,
    verifiedAt: new Date().toISOString(), assets: assets.map(asset => ({ key: asset.storageKey, originalUrl: asset.originalUrl, size: asset.size, sha256: asset.sha256, archivePath: asset.archivePath })),
  }];
  const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(records)); fs.renameSync(tmp, file);
}

// Font results and saved cards have their own indexes, but share the same trash
// and physical-reference rules as canvas images.
export function fontTrash(owner: string) {
  const ownerKey = createHash('sha256').update(owner).digest('hex').slice(0, 24);
  const data = path.join(getBaseDataDir(), 'local-data');
  const result: { id: string; file: string; field: 'runs' | 'cards'; rowId: string; name: string; keys: string[]; purgeAfter?: string }[] = [];
  for (const [folder, field] of [['font-creation', 'runs'], ['font-library', 'cards']] as const) {
    const dir = path.join(data, folder, ownerKey); if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || (field === 'cards' && name !== 'index.json')) continue;
      const file = path.join(dir, name); const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed[field])) throw new Error('字体索引异常，已停止清理');
      for (const row of parsed[field] as JsonRecord[]) if (row.deletedAt) result.push({
        id: `font-trash:${folder}:${name}:${row.id}`, file, field, rowId: String(row.id),
        name: String(row.title || row.userPrompt || '已删除字体作品'), keys: storageKeys(row), purgeAfter: typeof row.purgeAfter === 'string' ? row.purgeAfter : undefined,
      });
    }
  }
  return result;
}
export function purgeFontTrash(owner: string, id: string): string[] | null {
  const item = fontTrash(owner).find(row => row.id === id); if (!item) return null;
  // Another font writer owns this index while its lock directory exists.
  if (fs.existsSync(path.join(path.dirname(item.file), '.lock')) || fs.existsSync(item.file.replace(/\.json$/, '.lock'))) throw new Error('字体正在保存，请稍后重试');
  const parsed = JSON.parse(fs.readFileSync(item.file, 'utf8'));
  const row = (parsed[item.field] as JsonRecord[]).find(row => row.id === item.rowId && row.deletedAt);
  if (!row) return null;
  parsed[item.field] = parsed[item.field].filter((row: JsonRecord) => row.id !== item.rowId);
  const tmp = `${item.file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(parsed)); fs.renameSync(tmp, item.file);
  return item.keys;
}
