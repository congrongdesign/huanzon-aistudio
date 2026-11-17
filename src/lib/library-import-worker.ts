import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { getBaseDataDir } from './runtime-config';

type WorkerState = { worker: Worker; sequence: number; pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> };
const globalState = globalThis as typeof globalThis & { hzImportWorker?: WorkerState };
export const importDirectory = () => path.join(getBaseDataDir(), 'local-data', 'library-import');
export function importWorkerRequest<T>(op: string, input: Record<string, unknown>): Promise<T> {
  let state = globalState.hzImportWorker;
  if (!state) {
    const packaged = path.join(process.cwd(), 'workers/library-import-worker.cjs');
    const file = process.env.HZ_IMPORT_WORKER_PATH || (fs.existsSync(packaged) ? packaged : path.join(process.cwd(), '.desktop-runtime/backup-worker/library-import-worker.cjs'));
    if (!fs.existsSync(file)) return Promise.reject(new Error('导入后台组件缺失，请重新构建或更新客户端'));
    const worker = new Worker(file, { workerData: { root: importDirectory() }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    state = { worker, sequence: 0, pending: new Map() }; globalState.hzImportWorker = state;
    const current = state;
    worker.on('message', (message: { id: number; result?: unknown; error?: string }) => { const task = current.pending.get(message.id); if (!task) return; clearTimeout(task.timer); current.pending.delete(message.id); if (message.error) task.reject(new Error(message.error)); else task.resolve(message.result); });
    const fail = () => { if (globalState.hzImportWorker === current) globalState.hzImportWorker = undefined; for (const task of current.pending.values()) { clearTimeout(task.timer); task.reject(new Error('导入后台已退出，任务将保留供重试')); } current.pending.clear(); };
    worker.on('error', fail); worker.on('exit', fail); worker.unref();
  }
  const current = state;
  return new Promise((resolve, reject) => {
    const id = ++current.sequence;
    const timer = setTimeout(() => { current.pending.delete(id); reject(new Error('后台任务超时，请重试')); void current.worker.terminate(); }, 120_000);
    current.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    current.worker.postMessage({ id, op, input });
  });
}
export async function importSql(sql: string, args: (string | number | null)[] = []) { return importWorkerRequest<{ rows: Record<string, unknown>[]; affected: number }>('sql', { sql, args }); }
