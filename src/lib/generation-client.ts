'use client';
import { publishGeneration } from './generation-presentation';

type Pending = { resolve: (value: Response) => void; reject: (reason: unknown) => void; cleanup: () => void; started: number; requestId: string };
const pending = new Map<string, Pending>();
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let pollHeaders: Record<string, string> = {};

function schedulePoll() {
  if (pollTimer || polling || !pending.size) return;
  pollTimer = setTimeout(() => { pollTimer = undefined; void poll(); }, 1000);
}
async function poll() {
  polling = true;
  try {
    const ids = [...pending.keys()];
    const response = await fetch(`/api/generation-jobs?ids=${encodeURIComponent(ids.join(','))}`, { headers: pollHeaders, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('读取任务状态失败');
    const data = await response.json();
    for (const id of ids) {
      const entry = pending.get(id);
      if (!entry) continue;
      const job = data.jobs?.find((item: { id: string }) => item.id === id);
      if (job) publishGeneration(entry.requestId, job.status === "queued" ? "queued" : job.status === "running" ? "running" : job.status);
      if (job?.result) {
        pending.delete(id);
        entry.cleanup();
        entry.resolve(Response.json(job.result.payload, { status: job.result.status }));
      } else if (!job || Date.now() - entry.started > 30 * 60 * 1000) {
        pending.delete(id);
        entry.cleanup();
        publishGeneration(entry.requestId, "failed");
        entry.reject(new Error(!job ? '任务状态已失效，请检查任务结果后重试' : '等待任务超时，请检查任务结果后重试'));
      }
    }
  } catch {
    // A transient network failure must not create a second billable request.
    for (const [id, entry] of pending) {
      publishGeneration(entry.requestId, "reconnecting");
      if (Date.now() - entry.started > 30 * 60 * 1000) {
        pending.delete(id);
        entry.cleanup();
        publishGeneration(entry.requestId, 'failed');
        entry.reject(new Error('任务状态连接超时，请检查任务结果后重试'));
      }
    }
  } finally {
    polling = false;
    schedulePoll();
  }
}

// Keep legacy/cloud long requests below the browser's per-origin connection limit.
let activeLegacy = 0;
const legacyWaiters: Array<() => void> = [];
async function legacyRequest(body: object, headers: Record<string, string>, signal: AbortSignal, requestId: string) {
  publishGeneration(requestId, "queued");
  if (activeLegacy >= 3) await new Promise<void>(resolve => legacyWaiters.push(resolve));
  else activeLegacy++;
  try {
    signal.throwIfAborted();
    publishGeneration(requestId, "running");
    const response = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify(body), signal });
    publishGeneration(requestId, response.ok ? 'completed' : 'failed');
    return response;
  } catch (error) {
    publishGeneration(requestId, signal.aborted ? 'cancelled' : 'failed');
    throw error;
  } finally {
    const next = legacyWaiters.shift();
    if (next) next(); else activeLegacy--;
  }
}

export async function requestGeneration(body: object, headers: Record<string, string>, signal: AbortSignal, requestId: string, useQueue: boolean) {
  publishGeneration(requestId, "submitting");
  if (!useQueue) return legacyRequest(body, headers, signal, requestId);
  // Do not abort submission: if accepted just before cancellation we still need its ID.
  let response: Response;
  const submit = () => fetch('/api/generation-jobs', { method: 'POST', headers, body: JSON.stringify({ ...body, requestId }), signal: AbortSignal.timeout(15000) });
  try { response = await submit(); } catch {
    // Same id makes an uncertain submission safe to retry without generating twice.
    try { response = await submit(); } catch (error) {
      publishGeneration(requestId, signal.aborted ? 'cancelled' : 'failed');
      throw error;
    }
  }
  if (response.status === 409) return legacyRequest(body, headers, signal, requestId);
  if (!response.ok) { publishGeneration(requestId, 'failed'); return response; }
  const { jobId, status } = await response.json();
  publishGeneration(requestId, status === "running" ? "running" : "queued");
  if (typeof jobId !== 'string') { publishGeneration(requestId, 'failed'); throw new Error('任务提交响应无效'); }
  const cancel = () => { void fetch(`/api/generation-jobs?id=${encodeURIComponent(jobId)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) }).catch(() => {}); };
  if (signal.aborted) { publishGeneration(requestId, 'cancelled'); cancel(); signal.throwIfAborted(); }
  pollHeaders = headers;
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      publishGeneration(requestId, "cancelled");
      pending.delete(jobId);
      signal.removeEventListener('abort', onAbort);
      cancel();
      reject(new DOMException('任务已取消', 'AbortError'));
    };
    pending.set(jobId, { resolve, reject, requestId, started: Date.now(), cleanup: () => signal.removeEventListener('abort', onAbort) });
    signal.addEventListener('abort', onAbort, { once: true });
    schedulePoll();
  });
}
