import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getBaseDataDir } from './runtime-config';
import { registerVerifiedBackup } from './storage-lifecycle';
import { getProjectById, restoreLocalProjectSnapshot, isLocalBackendEnabled, exportLocalProjectSnapshot, clearLocalProjectArchiveData, getLocalDataDirectory, deleteLocalFileByKey, drainLocalFileCleanup } from './local-backend';
import { backupSnapshotHash } from './project-backup-snapshot';
import { projectExistsForUser, restoreSupabaseProjectSnapshot } from './project-archive';
import { getArchiveJob, getStoredArchiveJob, listStoredArchiveJobs, updateArchiveJob } from './project-archive-store';
import type { ProjectArchiveEntry, ProjectArchiveAsset, ProjectArchiveManifest, ProjectArchiveRestoreOptions } from './project-archive-types';

type Catalog = { root: string; ready: boolean; entries: ProjectArchiveEntry[]; error: string; updatedAt: string };
type State = { running?: boolean; initialized?: boolean; active?: { jobId: string; child: ChildProcess }; catalog?: Map<string, Catalog>; scans?: Set<string> };
const globalState = globalThis as typeof globalThis & { hzBackupService?: State };
const state = globalState.hzBackupService ||= {};
class BackupWorkerTimeout extends Error {}
function projectGenerating(projectId: string) {
  try {
    const jobs = JSON.parse(fs.readFileSync(path.join(getLocalDataDirectory(), 'generation-jobs.json'), 'utf8'));
    return jobs.some((j: { projectId: string; status: string }) => j.projectId === projectId && ['queued', 'running'].includes(j.status));
  } catch { return false; }
}
const catalogFile = () => path.join(getBaseDataDir(), 'project-backup-catalog.json');
function persistCatalog(value: Catalog) {
  (state.catalog ||= new Map()).set(value.root, value);
  fs.mkdirSync(getBaseDataDir(), { recursive: true });
  const file = catalogFile(); const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify([...state.catalog.values()])); fs.renameSync(temp, file);
}
export function cachedBackupCatalog(root: string): Catalog {
  if (!state.catalog) {
    state.catalog = new Map();
    try { for (const value of JSON.parse(fs.readFileSync(catalogFile(), 'utf8'))) state.catalog.set(value.root, value); } catch { /* No local catalog yet. */ }
  }
  return state.catalog.get(root) || { root, ready: false, entries: [], error: '', updatedAt: '' };
}
function workerPath() {
  const packaged = path.join(process.cwd(), 'workers/project-backup-worker.cjs');
  return process.env.HZ_BACKUP_WORKER_PATH || (fs.existsSync(packaged) ? packaged : path.join(process.cwd(), '.desktop-runtime/backup-worker/project-backup-worker.cjs'));
}
export function backupWorkerRequest<T>(input: object, options: { timeout?: number; progress?: (stage: string) => void; child?: (child: ChildProcess) => void } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = workerPath();
    if (!fs.existsSync(worker)) return reject(new Error('备份后台组件缺失，请重新安装客户端'));
    const scratch = path.join(getBaseDataDir(), 'backup-work', randomUUID());
    const child = spawn(process.execPath, ['--max-old-space-size=384', worker], {
      cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', UV_THREADPOOL_SIZE: '2', VIPS_CONCURRENCY: '1', HZ_BACKUP_WORK_DIR: scratch },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    options.child?.(child);
    let settled = false; let pending = ''; let errors = '';
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, result?: T) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(result!);
    };
    const renew = () => { clearTimeout(timer); timer = setTimeout(() => finish(new BackupWorkerTimeout('NAS 响应超时，任务已暂停，可检查连接后继续；原项目保留')), options.timeout || 120000); };
    renew();
    child.on('error', error => finish(error));
    child.on('close', (code, signal) => {
      void fsp.rm(scratch, { recursive: true, force: true }).catch(() => {});
      if (!settled) finish(new Error(signal ? '备份任务已暂停或取消' : `备份工作进程退出（${code}）${errors.slice(-250)}`));
    });
    child.stderr!.on('data', chunk => { errors = (errors + String(chunk)).slice(-4000); });
    child.stdout!.on('data', chunk => {
      pending += String(chunk);
      for (;;) {
        const index = pending.indexOf('\n'); if (index < 0) break;
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        try {
          const value = JSON.parse(line);
          if (value.progress) { renew(); options.progress?.(value.progress); }
          else if ('result' in value) finish(undefined, value.result);
          else if (value.error) finish(new Error(value.error));
        } catch { /* SDK diagnostics may also use stdout. */ }
      }
    });
    child.stdin!.end(JSON.stringify(input));
  });
}
export function refreshBackupCatalog(root: string, force = false) {
  if (!root || state.running || state.scans?.has(root)) return;
  const cached = cachedBackupCatalog(root);
  if (!force && Date.now() - Date.parse(cached.updatedAt || '1970') < 60000) return;
  (state.scans ||= new Set()).add(root);
  void backupWorkerRequest<{ entries: ProjectArchiveEntry[] }>({ action: 'scan', root }, { timeout: 15000 }).then(
    result => { if (cachedBackupCatalog(root).updatedAt === cached.updatedAt) persistCatalog({ root, ready: true, entries: result.entries, error: '', updatedAt: new Date().toISOString() }); },
    error => { if (cachedBackupCatalog(root).updatedAt === cached.updatedAt) persistCatalog({ ...cached, ready: false, error: error.message, updatedAt: new Date().toISOString() }); },
  ).finally(() => state.scans!.delete(root));
}
export function saveBackupCatalog(root: string, entries: ProjectArchiveEntry[]) {
  cachedBackupCatalog(root); persistCatalog({ root, entries, ready: true, error: '', updatedAt: new Date().toISOString() });
}
export function controlBackupJob(jobId: string, action: 'pause' | 'resume' | 'cancel') {
  const job = getStoredArchiveJob(jobId); if (!job) throw new Error('任务不存在');
  if (action === 'resume') {
    if (!['paused', 'failed', 'partial'].includes(job.status)) throw new Error('此任务无法继续');
    const results = job.results.filter(result => result.status === 'completed');
    updateArchiveJob(jobId, { status: 'queued', stage: '等待继续', results, completed: results.length, failed: 0, error: null });
    ensureBackupService();
  } else {
    if (!['queued', 'running', 'paused'].includes(job.status)) throw new Error('此任务已经结束');
    updateArchiveJob(jobId, { status: action === 'pause' ? 'paused' : 'cancelled', stage: action === 'pause' ? '已暂停，可继续；已完成备份保留' : '已取消；已完成备份保留', currentProjectId: null, currentProjectName: null });
    if (state.active?.jobId === jobId) state.active.child.kill();
  }
  return getArchiveJob(jobId);
}
export function ensureBackupService() {
  if (!state.initialized) {
    state.initialized = true;
    for (const job of listStoredArchiveJobs()) if (job.status === 'running') updateArchiveJob(job.id, { status: 'paused', stage: '上次任务中断，点击继续', currentProjectId: null, currentProjectName: null });
  }
  if (state.running) return; state.running = true;
  void (async () => {
    try {
      for (;;) {
        const job = listStoredArchiveJobs().find(item => item.status === 'queued'); if (!job) break;
        updateArchiveJob(job.id, { status: 'running', stage: '后台准备中' });
        const ids = job.action === 'archive' ? job.payload.projectIds || [] : job.payload.entryIds || [];
        const completed = new Set(job.results.filter(r => r.status === 'completed').map(r => r.entryId && job.action === 'restore' ? r.entryId : r.projectId));
        for (const id of ids) {
          if (completed.has(id)) continue;
          if (getArchiveJob(job.id)?.status !== 'running') break;
          const projectName = job.action === 'archive' ? getProjectById(id, job.payload.userId)?.name || id : cachedBackupCatalog(job.targetDir).entries.find(e => e.id === id)?.projectName || id;
          updateArchiveJob(job.id, { currentProjectId: id, currentProjectName: projectName, stage: `${projectName} · 后台处理` });
          try {
            const options = { progress: (stage: string) => { if (getArchiveJob(job.id)?.status === 'running') updateArchiveJob(job.id, { stage }); }, child: (child: ChildProcess) => { state.active = { jobId: job.id, child }; } };
            let entry: ProjectArchiveEntry; let message: string; let restoredProjectId: string | undefined; let originalRemoved = false;
            if (job.action === 'archive') {
              const result = await backupWorkerRequest<{ entry: ProjectArchiveEntry; assets: ProjectArchiveAsset[]; copies: { key: string; file: string; signature: string }[]; message: string; snapshotHash: string }>({ action: job.payload.removeOnly ? 'verify-removal' : 'backup', entryId: job.payload.backupEntryByProject?.[id], root: job.targetDir, userId: job.payload.userId, projectId: id, baseUrl: job.payload.baseUrl }, options);
              entry = result.entry; message = result.message;
              registerVerifiedBackup(job.targetDir, entry, result.assets || []);
              if (job.payload.deleteAfterBackup !== false && getArchiveJob(job.id)?.status === 'running') {
                if (!isLocalBackendEnabled()) message += '；云端项目暂保留';
                else if (!getProjectById(id, job.payload.userId)) originalRemoved = true;
                else if (projectGenerating(id)) message += '；项目仍在生成，本机项目保留，请生成完成后再次备份';
                else if (backupSnapshotHash(exportLocalProjectSnapshot(id, job.payload.userId)) !== result.snapshotHash) message += '；备份期间内容已变化，本机项目保留，请再次备份';
                else {
                  // No await between comparison and removal: edits cannot interleave.
                  // Commit removal and cleanup intents together; central collector protects shared media.
                  originalRemoved = clearLocalProjectArchiveData(id, job.payload.userId, true).deleted;
                  if (originalRemoved) for (const asset of result.assets || []) {
                    const key = asset.storageKey || asset.originalUrl.match(/\/api\/local-file\/([^?#]+)/)?.[1];
                    if (key) deleteLocalFileByKey(decodeURIComponent(key), (result.copies || []).filter(copy => copy.key === decodeURIComponent(key)));
                  }
                  message += originalRemoved ? '；已从画布移除，独占原图排队释放，共用文件保留，可在项目备份中恢复' : '；本机项目保留';
                }
              }
            } else {
              const result = await backupWorkerRequest<{ entry: ProjectArchiveEntry; prepared: { manifest: ProjectArchiveManifest; options: { assetByStorageKey: [string, { key: string; url: string }][]; assetByOriginalUrl: [string, { key: string; url: string }][] } } }>({ action: 'prepare-restore', root: job.targetDir, userId: job.payload.userId, entryId: id }, options);
              if (getArchiveJob(job.id)?.status !== 'running') break;
              const manifest = result.prepared.manifest;
              const local = isLocalBackendEnabled();
              const conflict = local ? !!getProjectById(manifest.originalProjectId, job.payload.userId) : await projectExistsForUser(manifest.originalProjectId, job.payload.userId);
              restoredProjectId = conflict ? randomUUID() : manifest.originalProjectId;
              if (conflict) manifest.data.project.name = `${manifest.data.project.name}（恢复副本）`;
              const restoreOptions: ProjectArchiveRestoreOptions = { projectId: restoredProjectId, preserveRecordIds: !conflict, assetByStorageKey: new Map(result.prepared.options.assetByStorageKey), assetByOriginalUrl: new Map(result.prepared.options.assetByOriginalUrl) };
              if (local) restoreLocalProjectSnapshot(manifest.data, job.payload.userId, restoreOptions);
              else await restoreSupabaseProjectSnapshot(manifest.data, job.payload.userId, restoreOptions);
              entry = { ...result.entry, restoredProjectId, restoredAt: new Date().toISOString() };
              message = conflict ? '已恢复为副本' : '已恢复到画布';
              // Only metadata is written by the worker; the shared DB stays single-writer.
              void backupWorkerRequest({ action: 'restored-meta', root: job.targetDir, userId: job.payload.userId, entryId: id, projectId: restoredProjectId }).catch(() => {});
            }
            const cached = cachedBackupCatalog(job.targetDir);
            saveBackupCatalog(job.targetDir, [entry, ...cached.entries.filter(e => e.id !== entry.id)]);
            const current = getArchiveJob(job.id)!;
            updateArchiveJob(job.id, { completed: current.completed + 1, results: [...current.results, { projectId: job.action === 'archive' ? id : entry.projectId, projectName, status: 'completed', message, entryId: entry.id, restoredProjectId, originalRemoved }] });
          } catch (error) {
            const current = getArchiveJob(job.id)!; if (current.status !== 'running') break;
            if (error instanceof BackupWorkerTimeout) {
              updateArchiveJob(job.id, { status: 'paused', stage: error.message, currentProjectId: null, currentProjectName: null });
              break;
            }
            updateArchiveJob(job.id, { failed: current.failed + 1, results: [...current.results, { projectId: id, projectName, status: 'failed', message: error instanceof Error ? error.message : String(error) }] });
          } finally { state.active = undefined; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        const current = getArchiveJob(job.id)!;
        if (current.status === 'running') updateArchiveJob(job.id, { status: current.failed ? 'partial' : 'completed', stage: current.failed ? '部分项目失败，可继续重试' : '备份任务完成', currentProjectId: null, currentProjectName: null });
      }
    } finally {
      state.running = false;
      try { drainLocalFileCleanup(); } catch (error) { console.error('归档后原图回收待重试', error); }
    }
  })();
}
