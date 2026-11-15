import fs from 'node:fs';
import path from 'node:path';
import { GenerationQueue, type GenerationJob } from './generation-queue';
import type { GenerationBody } from './run-generation';
import { getLocalDataDirectory } from './local-backend';

const state = globalThis as typeof globalThis & { hzGenerationQueue?: GenerationQueue<GenerationBody> };

export function generationQueue() {
  if (!state.hzGenerationQueue) {
    const file = path.join(getLocalDataDirectory(), 'generation-jobs.json');
    let previous: GenerationJob[] = [];
    if (fs.existsSync(file)) previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.hzGenerationQueue = new GenerationQueue<GenerationBody>(async (userId, body, signal) => {
      const { runGeneration } = await import('./run-generation');
      return runGeneration(userId, body, signal);
    }, jobs => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(jobs));
      fs.renameSync(`${file}.tmp`, file);
    }, previous);
  }
  return state.hzGenerationQueue;
}
