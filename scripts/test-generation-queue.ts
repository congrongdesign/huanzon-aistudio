import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { GenerationQueue, type GenerationJob } from '../src/lib/generation-queue';

async function main() {
  let active = 0;
  let peak = 0;
  let executed = 0;
  let persisted: GenerationJob[] = [];
  const releases: Array<() => void> = [];
  const queue = new GenerationQueue<number>(async (_user, input, signal) => {
    active++; executed++; peak = Math.max(peak, active);
    try {
      await new Promise<void>((resolve, reject) => {
        releases[input] = resolve;
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
      return { status: input === 6 ? 502 : 200, payload: { id: input } };
    } finally { active--; }
  }, jobs => { persisted = structuredClone(jobs); });
  const jobs = Array.from({ length: 8 }, (_, i) => queue.submit('owner', `request-${i}`, 'project', i));
  assert.equal(queue.submit('owner', 'request-0', 'project', 0).id, jobs[0].id);
  await delay(10);
  assert.equal(active, 4);
  assert.equal(queue.list('other-user', jobs.map(job => job.id)).length, 0);
  assert.equal(queue.cancel('other-user', jobs[0].id), false);
  queue.cancel('owner', jobs[7].id); // queued: never executed
  queue.cancel('owner', jobs[0].id); // running: frees a worker
  await delay(10);
  for (let round = 0; round < 4; round++) { releases.forEach(release => release?.()); await delay(10); }
  assert.equal(peak, 4);
  assert.equal(executed, 7);
  assert.equal(jobs[0].status, 'cancelled');
  assert.equal(jobs[7].status, 'cancelled');
  assert.equal(jobs[6].status, 'failed');
  assert.equal(jobs[1].status, 'completed');
  const restored = new GenerationQueue(async () => { throw new Error('must not auto-run'); }, () => {}, [{ ...persisted[0], status: 'running' }]);
  assert.equal(restored.list('owner', [persisted[0].id])[0].status, 'failed');
  assert.equal(queue.list('owner', jobs.map(job => job.id)).length, 8);
  console.log('PASS: 8 jobs, max 4 workers, deduplication, user isolation, queued/running cancellation, failures, safe restart.');
}
void main();
