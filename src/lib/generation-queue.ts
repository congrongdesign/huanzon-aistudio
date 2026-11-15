import { randomUUID } from 'node:crypto';

export type GenerationJob = {
  id: string;
  userId: string;
  requestId: string;
  projectId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  result?: { status: number; payload: Record<string, unknown> };
};

/** A bounded worker queue; HTTP connections are used only for submission/status. */
export class GenerationQueue<T> {
  private jobs = new Map<string, GenerationJob>();
  private pending: Array<{ job: GenerationJob; input: T }> = [];
  private controllers = new Map<string, AbortController>();
  private running = 0;

  constructor(
    private execute: (userId: string, input: T, signal: AbortSignal) => Promise<NonNullable<GenerationJob['result']>>,
    private persist: (jobs: GenerationJob[]) => void,
    previous: GenerationJob[] = [],
    private concurrency = 4,
  ) {
    for (const job of previous) {
      // Never silently repeat a potentially billable request after a service restart.
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.result = { status: 503, payload: { error: '本地服务已重启，任务已中断；请确认后重试。' } };
      }
      this.jobs.set(job.id, job);
    }
  }

  submit(userId: string, requestId: string, projectId: string | null, input: T) {
    const existing = [...this.jobs.values()].find(job => job.userId === userId && job.requestId === requestId);
    if (existing) return existing;
    if (this.pending.length >= 128) throw new Error('任务队列已满，请稍后再试');
    const now = new Date().toISOString();
    const job: GenerationJob = { id: randomUUID(), userId, requestId, projectId, status: 'queued', createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job);
    this.pending.push({ job, input });
    try { this.save(); } catch (error) {
      this.jobs.delete(job.id);
      this.pending.pop();
      throw error;
    }
    setImmediate(() => this.drain());
    return job;
  }

  list(userId: string, ids: string[]) {
    return ids.map(id => this.jobs.get(id)).filter((job): job is GenerationJob => Boolean(job && job.userId === userId));
  }

  cancel(userId: string, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId) return false;
    if (job.status !== 'queued' && job.status !== 'running') return true;
    this.controllers.get(id)?.abort();
    this.pending = this.pending.filter(entry => entry.job.id !== id);
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    job.result = { status: 499, payload: { error: '任务已取消' } };
    this.save();
    return true;
  }

  private save() {
    // Keep active jobs plus recent results; inputs/API keys are never persisted.
    const ordered = [...this.jobs.values()];
    const terminal = ordered.filter(job => !['queued', 'running'].includes(job.status)).slice(-500);
    const retained = [...ordered.filter(job => ['queued', 'running'].includes(job.status)), ...terminal];
    this.jobs = new Map(retained.map(job => [job.id, job]));
    this.persist(retained);
  }

  private drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const { job, input } = this.pending.shift()!;
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      job.status = 'running';
      this.running++;
      try { this.save(); } catch (error) {
        this.controllers.delete(job.id);
        this.running--;
        job.status = 'failed';
        job.result = { status: 503, payload: { error: '任务状态无法保存，请检查本地磁盘空间后重试' } };
        console.error('Unable to persist generation start', error);
        continue;
      }
      void (async () => {
        try {
          const result = await this.execute(job.userId, input, controller.signal);
          if (job.status !== 'cancelled') {
            job.result = result;
            job.status = result.status < 400 ? 'completed' : 'failed';
          }
        } catch (error) {
          if (job.status !== 'cancelled') {
            job.status = 'failed';
            job.result = { status: 500, payload: { error: error instanceof Error ? error.message : '生成失败' } };
          }
        } finally {
          job.updatedAt = new Date().toISOString();
          this.controllers.delete(job.id);
          this.running--;
          try { this.save(); } catch (error) { console.error('Unable to persist generation result', error); }
          this.drain();
        }
      })();
    }
  }
}
