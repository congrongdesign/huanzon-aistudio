import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { importDirectory, importSql, importWorkerRequest } from './library-import-worker';
import { mediaWritePath } from './media-storage';
import { fontOwnerKey, commitImportedFont, applyImportedFont, undoImportedFont } from './font-library-store';
import { commitImportedCase, applyImportedCase, undoImportedCase, listCaseLibrary } from './case-library-store';
import { commitImportedPrompt, applyImportedPrompt, undoImportedPrompt, getProjectById, getLocalDataDirectory } from './local-backend';
import { listLocalLibraries } from './prompt-library-store';
import { analyzeImportedImage, AnalysisWait } from './library-import-analysis';
import { getBaseDataDir } from './runtime-config';
import type { LibraryKind, LibraryImportItem, LibraryImportBatch, ImportSnapshot, ImportMedia } from './library-import-types';

type State = { initialized?: Promise<void>; running?: boolean; analyzing?: boolean; timer?: ReturnType<typeof setTimeout>; revision: number; uploads: Set<string> };
const globalState = globalThis as typeof globalThis & { hzLibraryImport?: State };
const state = globalState.hzLibraryImport ||= { revision: 0, uploads: new Set() };
const stamp = () => new Date().toISOString();
const itemPath = (id: string) => path.join(importDirectory(), 'staging', `${id}.image`);
const journalPath = (id: string) => path.join(importDirectory(), 'references', `${id}.json`);
export class ImportError extends Error { constructor(message: string, public status = 400) { super(message); } }
async function rows<T>(table: 'items' | 'batches', owner?: string, activeOnly = false): Promise<T[]> {
  const clauses = [...(owner ? ['owner=?'] : []), ...(activeOnly ? ["stage IN ('queued','saved','waiting')"] : [])];
  const result = await importSql(`SELECT data FROM ${table}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY rowid DESC`, owner ? [owner] : []);
  return result.rows.map(row => JSON.parse(String(row.data)) as T);
}
async function saveItem(item: LibraryImportItem, preserveCancellation = true) {
  const stored = await importSql('SELECT data FROM items WHERE id=? AND owner=?', [item.id, item.owner]);
  if (stored.rows.length && preserveCancellation) { const latest = JSON.parse(String(stored.rows[0].data)) as LibraryImportItem; if (latest.undone) item.undone = true; if (latest.cancelAnalysis && !item.cancelAnalysis) { item.cancelAnalysis = true; if (['saved','completed'].includes(item.stage)) item.stage = 'canceled'; } }
  item.updatedAt = stamp();
  await importSql('UPDATE items SET stage=?,data=? WHERE id=? AND owner=?', [item.stage, JSON.stringify(item), item.id, item.owner]); state.revision++;
}
async function saveBatch(batch: LibraryImportBatch) { await importSql('UPDATE batches SET data=? WHERE id=? AND owner=?', [JSON.stringify(batch), batch.id, batch.owner]); state.revision++; }
export async function initializeImports() {
  if (!state.initialized) state.initialized = (async () => {
    const items = await rows<LibraryImportItem>('items');
    for (const item of items) {
      if (item.stage === 'needs_source') { const source = await fs.stat(itemPath(item.id)).catch(() => null); if (source?.size === item.bytes) { item.staged = true; item.stage = 'queued'; await saveItem(item); } }
      if (['saving', 'analyzing', 'applying'].includes(item.stage)) { item.stage = item.cardId ? 'saved' : 'queued'; item.error = undefined; await saveItem(item); }
    }
  })().catch(error => { state.initialized = undefined; throw error; });
  await state.initialized; kickImports();
}
export async function createImportBatch(owner: string, input: { id?: string; kind: LibraryKind; groupId?: string; projectId?: string | null; targetId?: string; files: { id: string; name: string; bytes: number; sourceToken?: string }[] }) {
  await initializeImports();
  if (!['prompts', 'fonts', 'cases'].includes(input.kind) || !Array.isArray(input.files) || !input.files.length || input.files.length > 100) throw new ImportError('每次登记 1–100 张图片');
  if (input.targetId !== undefined && (typeof input.targetId !== 'string' || input.targetId.length > 100)) throw new ImportError('目标卡片不正确');
  const group = String(input.groupId || '');
  if (input.projectId && !getProjectById(input.projectId, owner)) throw new ImportError('项目不存在', 404);
  if (input.kind === 'prompts' && group && !listLocalLibraries(owner).some(g => String(g.id) === group)) throw new ImportError('分组不存在');
  if (input.kind === 'cases' && group && !(await listCaseLibrary(owner, new URLSearchParams())).folders.some(g => g.id === group)) throw new ImportError('分类不存在');
  if (input.kind === 'fonts' && group) { const { listFonts } = await import('./font-library-store'); if (!(await listFonts(owner, new URLSearchParams())).groups.some(g => g.id === group)) throw new ImportError('分组不存在'); }
  const batchId = typeof input.id === 'string' && /^[a-f0-9-]{36}$/i.test(input.id) ? input.id : randomUUID();
  const existing = (await rows<LibraryImportBatch>('batches', owner)).find(b => b.id === batchId);
  if (existing) return { batch: existing, items: (await rows<LibraryImportItem>('items', owner)).filter(i => i.batchId === batchId) };
  const batch: LibraryImportBatch = { id: batchId, owner, kind: input.kind, groupId: group, projectId: input.projectId || null, targetId: input.targetId, paused: false, createdAt: stamp() };
  const items = input.files.map(file => {
    if (!/^[a-f0-9-]{36}$/i.test(file.id) || typeof file.name !== 'string' || !Number.isFinite(file.bytes) || file.bytes <= 0 || file.bytes > 25 * 1024 * 1024) throw new ImportError('图片格式或大小不正确，单张最多 25 MiB');
    return { id: file.id, owner, batchId, kind: input.kind, originalName: path.basename(file.name).slice(0, 200), bytes: file.bytes, groupId: group, projectId: batch.projectId, targetId: input.targetId, sourceToken: file.sourceToken, stage: file.sourceToken ? 'queued' : 'needs_source', attempt: 0, createdAt: stamp(), updatedAt: stamp() } as LibraryImportItem;
  });
  await importWorkerRequest('batch', { statements: [{ sql: 'INSERT INTO batches VALUES(?,?,?)', args: [batch.id, owner, JSON.stringify(batch)] }, ...items.map(item => ({ sql: 'INSERT INTO items VALUES(?,?,?,?,?)', args: [item.id, owner, batch.id, item.stage, JSON.stringify(item)] }))] });
  state.revision++; kickImports(); return { batch, items };
}
export async function getImportItem(owner: string, id: string) {
  const data = await importSql('SELECT data FROM items WHERE id=? AND owner=?', [id, owner]); if (!data.rows.length) throw new ImportError('导入任务不存在', 404); return JSON.parse(String(data.rows[0].data)) as LibraryImportItem;
}
export async function stageImportContent(owner: string, id: string, body: ReadableStream<Uint8Array>) {
  await initializeImports(); const item = await getImportItem(owner, id);
  if (item.media || item.cardId) return item;
  if (state.uploads.has(id)) throw new ImportError('此图片正在接收', 409);
  state.uploads.add(id); await fs.mkdir(path.dirname(itemPath(id)), { recursive: true });
  const temp = `${itemPath(id)}.${randomUUID()}.tmp`;
  try {
    let size = 0;
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), new Transform({ transform(chunk, _, callback) { size += chunk.length; callback(size > 25 * 1024 * 1024 ? new Error('图片超过 25 MiB') : null, chunk); } }), (await import('node:fs')).createWriteStream(temp, { flags: 'wx' }));
    if (size !== item.bytes) throw new ImportError('文件未完整传入，请重试');
    await fs.rename(temp, itemPath(id)); item.staged = true; item.stage = 'queued'; item.error = undefined; await saveItem(item); kickImports(); return item;
  } finally { state.uploads.delete(id); await fs.unlink(temp).catch(() => {}); }
}
export async function importSnapshot(owner: string): Promise<ImportSnapshot> {
  await initializeImports();
  const result = await importSql('SELECT data FROM items WHERE owner=? ORDER BY rowid DESC LIMIT 300', [owner]);
  const all = result.rows.map(row => JSON.parse(String(row.data)) as LibraryImportItem), batches = await rows<LibraryImportBatch>('batches', owner);
  const counts = await importSql("SELECT count(*) AS total, sum(CASE WHEN stage IN ('queued','saving','saved','analyzing','applying') THEN 1 ELSE 0 END) AS active FROM items WHERE owner=?", [owner]);
  const active = Number(counts.rows[0]?.active || 0);
  const visibleItems = all.filter(i => !i.undone).slice(0, 300).map(({ sourceToken: _token, snapshot: _before, analysis, ...item }) => ({ ...item, analysis: analysis ? { ...analysis, prompt: '', description: '', ocr: '' } : undefined }));
  return { batches: batches.slice(0, 40), items: visibleItems, total: Number(counts.rows[0]?.total || 0), active, revision: state.revision };
}
async function sourcePath(item: LibraryImportItem) {
  if (item.staged) return itemPath(item.id);
  if (!item.sourceToken || !/^[a-f0-9-]{36}$/i.test(item.sourceToken)) throw new ImportError('请重新选择原图');
  const file = path.join(getBaseDataDir(), 'import-sources', `${item.sourceToken}.json`);
  const grant = JSON.parse(await fs.readFile(file, 'utf8')) as { path: string; bytes: number; mtimeMs: number; expiresAt: number };
  if (grant.expiresAt < Date.now()) throw new ImportError('原图访问已过期，请重新选择');
  const info = await fs.stat(grant.path); if (info.size !== grant.bytes || info.mtimeMs !== grant.mtimeMs) throw new ImportError('原图已被移动或修改，请重新选择');
  return grant.path;
}
async function ingest(item: LibraryImportItem) {
  if (!item.media) {
    const source = await sourcePath(item), ownerKey = createHash('sha256').update(item.owner).digest('hex').slice(0, 24);
    const destination = path.dirname(mediaWritePath('placeholder', item.kind === 'fonts' ? 'fonts' : 'files'));
    const prefix = item.kind === 'fonts' ? `${fontOwnerKey(item.owner)}_` : item.kind === 'cases' ? `case_${ownerKey}_` : `prompt_${ownerKey}_`;
    const media = await importWorkerRequest<Omit<ImportMedia, 'url'>>('ingest', { source, destination, keyPrefix: prefix, journal: journalPath(item.id) });
    item.media = { ...media, url: `/api/${item.kind === 'fonts' ? 'font-file' : 'local-file'}/${media.key}` }; await saveItem(item);
  }
  const result = item.kind === 'fonts' ? await commitImportedFont(item.owner, item) : item.kind === 'cases' ? await commitImportedCase(item.owner, item) : commitImportedPrompt(item.owner, item);
  item.cardId = result.id; item.created = result.created; item.snapshot = result.snapshot;
  item.committedRevision = String(result.snapshot.version || result.snapshot.updatedAt || result.snapshot.updated_at || '');
  item.stage = item.cancelAnalysis ? 'canceled' : item.targetId || !result.created ? 'completed' : 'saved'; await saveItem(item);
  await fs.unlink(itemPath(item.id)).catch(() => {});
  // Cards now own their media references. The journal remains until the queue commit is durable.
  await fs.unlink(journalPath(item.id)).catch(() => {});
  if (item.sourceToken) await fs.unlink(path.join(getBaseDataDir(), 'import-sources', `${item.sourceToken}.json`)).catch(() => {});
}
function frontWorkActive() {
  try { const file = path.join(getLocalDataDirectory(), 'generation-jobs.json'); return JSON.parse(requireRead(file)).some((j: { status: string }) => ['queued', 'running'].includes(j.status)); } catch { return false; }
}
function requireRead(file: string) { return readFileSync(file, 'utf8'); }
import { readFileSync } from 'node:fs';
async function analysis(item: LibraryImportItem) {
  const cacheId = createHash('sha256').update(`${item.owner}:${item.kind}:${item.media!.hash}:v1:${JSON.stringify(readAnalysisModelFingerprint())}`).digest('hex');
  if (!item.analysis) {
    const cached = await importSql('SELECT data FROM cache WHERE id=?', [cacheId]);
    item.analysis = cached.rows.length ? JSON.parse(String(cached.rows[0].data)) : await analyzeImportedImage(item);
    await importSql('INSERT OR REPLACE INTO cache VALUES(?,?)', [cacheId, JSON.stringify(item.analysis)]); await saveItem(item);
  }
  // Refresh cancellation/undo after a request returns; do not revive a deleted card.
  const latest = await getImportItem(item.owner, item.id);
  if (latest.cancelAnalysis) { latest.analysis = item.analysis; latest.stage = 'canceled'; await saveItem(latest); return; }
  item.stage = 'applying'; await saveItem(item);
  item.committedRevision = item.kind === 'fonts' ? await applyImportedFont(item.owner, item) : item.kind === 'cases' ? await applyImportedCase(item.owner, item) : applyImportedPrompt(item.owner, item);
  item.stage = 'completed'; item.error = undefined; await saveItem(item);
}
import { readProviderProfilesStore } from './provider-profiles-store';
function readAnalysisModelFingerprint() { const store = readProviderProfilesStore(); return { bindings: store.capabilityBindings, profiles: store.profiles.map(p => ({ id: p.id, url: p.baseUrl, enabled: p.enabled })) }; }
export function kickImports(delay = 0) {
  if (state.running) return;
  if (state.timer) { if (delay) return; clearTimeout(state.timer); state.timer = undefined; }
  state.timer = setTimeout(() => { state.timer = undefined; void runImports().catch(error => console.error('Import scheduler:', error instanceof Error ? error.message : error)).finally(() => { if (!state.timer && !state.running) kickImports(5000); }); }, delay); state.timer.unref?.();
}
async function runImports() {
  if (state.running) return; state.running = true;
  let continueSoon = false, saveAgainSoon = false;
  try {
    const items = await rows<LibraryImportItem>('items', undefined, true), batches = await rows<LibraryImportBatch>('batches');
    const batchMap = new Map(batches.map(b => [b.id, b]));
    const next = items.slice().reverse().find(i => !i.undone && i.stage === 'queued');
    if (next) {
      continueSoon = true; saveAgainSoon = true;
      try { next.stage = 'saving'; await saveItem(next); await ingest(next); }
      catch (error) { next.stage = 'failed'; next.error = error instanceof Error ? error.message.slice(0, 250) : '保存失败'; await saveItem(next); }
    }
    if (!state.analyzing && !frontWorkActive()) {
      const candidate = items.slice().reverse().find(i => !i.undone && !batchMap.get(i.batchId)?.paused && (i.stage === 'saved' || (i.stage === 'waiting' && (i.nextAttempt || 0) <= Date.now())));
      if (candidate) {
        state.analyzing = true;
        void (async () => {
          try { candidate.stage = 'analyzing'; await saveItem(candidate); await analysis(candidate); }
          catch (error) {
            const latest = await getImportItem(candidate.owner, candidate.id);
            latest.error = error instanceof Error ? error.message.slice(0, 250) : '整理失败'; latest.attempt++;
            latest.stage = latest.cancelAnalysis ? 'canceled' : error instanceof AnalysisWait ? 'waiting' : 'failed';
            if (error instanceof AnalysisWait) latest.nextAttempt = Date.now() + error.retryAfter;
            await saveItem(latest);
          } finally { state.analyzing = false; kickImports(); }
        })().catch(error => console.error('Import analysis:', error instanceof Error ? error.message : error));
      }
    }
    if (!continueSoon && items.some(i => i.stage === 'saved' || i.stage === 'waiting' || i.stage === 'queued')) continueSoon = true;
  } finally { state.running = false; if (continueSoon) kickImports(saveAgainSoon ? 15 : 800); }
}
export async function importBatchAction(owner: string, batchId: string, action: string) {
  await initializeImports(); const batch = (await rows<LibraryImportBatch>('batches', owner)).find(b => b.id === batchId); if (!batch) throw new ImportError('批次不存在', 404);
  if (!['pause', 'resume', 'retry', 'cancel', 'undo'].includes(action)) throw new ImportError('未知操作');
  if (action === 'pause' || action === 'resume') { batch.paused = action === 'pause'; await saveBatch(batch); }
  const items = (await rows<LibraryImportItem>('items', owner)).filter(i => i.batchId === batchId && !i.undone);
  for (const item of items) {
    if (action === 'retry' && ['failed', 'waiting', 'canceled'].includes(item.stage)) { item.stage = item.cardId ? 'saved' : item.staged || item.sourceToken ? 'queued' : 'needs_source'; item.cancelAnalysis = false; item.error = undefined; item.nextAttempt = undefined; await saveItem(item, false); }
    if (action === 'cancel' || action === 'undo') { item.cancelAnalysis = true; if (['saved', 'waiting', 'failed', 'needs_source'].includes(item.stage)) item.stage = 'canceled'; await saveItem(item); }
    if (action === 'undo') {
      if (['saving', 'analyzing', 'applying'].includes(item.stage)) { item.preserved = true; await saveItem(item); continue; }
      if (item.cardId) { const removed = item.kind === 'fonts' ? await undoImportedFont(owner, item) : item.kind === 'cases' ? await undoImportedCase(owner, item) : undoImportedPrompt(owner, item); item.undone = removed; item.preserved = !removed; }
      else { item.undone = true; item.stage = 'canceled'; await fs.unlink(itemPath(item.id)).catch(() => {}); }
      await saveItem(item);
    }
  }
  if (action === 'retry') { batch.paused = false; await saveBatch(batch); }
  kickImports(); return importSnapshot(owner);
}

export async function enqueueFontOrganization(owner: string, cardId?: string, force = false) {
  await initializeImports();
  const { fontOrganizationCandidates, getFont } = await import('./font-library-store');
  const ids = await fontOrganizationCandidates(owner, cardId, force);
  const existing = await rows<LibraryImportItem>('items', owner);
  const wanted = ids.filter(id => !existing.some(i => i.cardId === id && ['saved', 'analyzing', 'applying', 'waiting'].includes(i.stage)));
  if (!wanted.length) return fontImportOrganizationStatus(owner);
  const batch: LibraryImportBatch = { id: randomUUID(), owner, kind: 'fonts', groupId: '', projectId: null, paused: false, createdAt: stamp() };
  const items: LibraryImportItem[] = [];
  for (const id of wanted) {
    const card = await getFont(owner, id);
    items.push({ id: randomUUID(), owner, batchId: batch.id, kind: 'fonts', originalName: card.title, bytes: 0, groupId: card.groupId || '', projectId: null, stage: 'saved', attempt: 0, cardId: id, created: true, media: { key: card.cover.key, url: card.cover.url, hash: card.cover.key, bytes: 0, width: card.cover.width || 1, height: card.cover.height || 1 }, snapshot: structuredClone(card) as unknown as Record<string, unknown>, createdAt: stamp(), updatedAt: stamp() });
  }
  await importWorkerRequest('batch', { statements: [{ sql: 'INSERT INTO batches VALUES(?,?,?)', args: [batch.id, owner, JSON.stringify(batch)] }, ...items.map(item => ({ sql: 'INSERT INTO items VALUES(?,?,?,?,?)', args: [item.id, owner, item.batchId, item.stage, JSON.stringify(item)] }))] });
  state.revision++; kickImports(); return fontImportOrganizationStatus(owner);
}
export async function fontImportOrganizationStatus(owner: string) {
  await initializeImports();
  const items = (await rows<LibraryImportItem>('items', owner)).filter(i => i.kind === 'fonts' && !i.undone);
  const active = items.filter(i => ['saved', 'analyzing', 'applying', 'queued', 'saving'].includes(i.stage));
  const errors = items.filter(i => ['failed', 'waiting'].includes(i.stage));
  return { running: active.length > 0, total: items.length, completed: items.filter(i => i.stage === 'completed').length, failed: errors.length, current: active.find(i => i.stage === 'analyzing')?.originalName || '', errors: errors.map(i => ({ id: i.cardId || i.id, title: i.originalName, error: i.error || '等待处理' })) };
}
