import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type SkillRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface SkillRunRecord {
  id: string;
  skillId: string;
  projectId: string;
  userId: string | null;
  status: SkillRunStatus;
  prompt: string;
  inputFiles: string[];
  outputDir: string;
  logFile: string;
  command?: string;
  error?: string;
  resultFiles: Array<{ name: string; path: string; relativePath: string; size: number }>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

const RUN_ROOT = path.join(process.cwd(), 'output', 'skill-runs');
const INDEX_FILE = path.join(RUN_ROOT, 'index.json');

function ensureRoot() {
  fs.mkdirSync(RUN_ROOT, { recursive: true });
}

function readIndex(): SkillRunRecord[] {
  ensureRoot();
  try {
    if (!fs.existsSync(INDEX_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) as { runs?: SkillRunRecord[] };
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

function writeIndex(runs: SkillRunRecord[]) {
  ensureRoot();
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ runs }, null, 2), 'utf8');
  fs.renameSync(tmp, INDEX_FILE);
}

export function createSkillRun(input: Pick<SkillRunRecord, 'skillId' | 'projectId' | 'userId' | 'prompt'>): SkillRunRecord {
  ensureRoot();
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outputDir = path.join(RUN_ROOT, id);
  fs.mkdirSync(path.join(outputDir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'final'), { recursive: true });
  const now = new Date().toISOString();
  const record: SkillRunRecord = {
    id,
    skillId: input.skillId,
    projectId: input.projectId,
    userId: input.userId,
    status: 'queued',
    prompt: input.prompt,
    inputFiles: [],
    outputDir,
    logFile: path.join(outputDir, 'run.log'),
    resultFiles: [],
    createdAt: now,
  };
  fs.writeFileSync(path.join(outputDir, 'run.json'), JSON.stringify(record, null, 2), 'utf8');
  writeIndex([record, ...readIndex()]);
  return record;
}

export function updateSkillRun(id: string, patch: Partial<SkillRunRecord>): SkillRunRecord | null {
  const runs = readIndex();
  const index = runs.findIndex((run) => run.id === id);
  if (index < 0) return null;
  const next = { ...runs[index], ...patch };
  runs[index] = next;
  writeIndex(runs);
  try {
    fs.writeFileSync(path.join(next.outputDir, 'run.json'), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // ignore run mirror write failure
  }
  return next;
}

export function getSkillRun(id: string): SkillRunRecord | null {
  return readIndex().find((run) => run.id === id) || null;
}

export function listSkillRuns(projectId?: string, userId?: string | null): SkillRunRecord[] {
  return readIndex()
    .filter((run) => (projectId ? run.projectId === projectId : true))
    .filter((run) => (userId !== undefined ? run.userId === userId : true))
    .slice(0, 80);
}

function collectFiles(dir: string, root = dir): Array<{ name: string; path: string; relativePath: string; size: number }> {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: Array<{ name: string; path: string; relativePath: string; size: number }> = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, root));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!['.pptx', '.pdf', '.png', '.jpg', '.jpeg', '.json', '.txt', '.md'].includes(ext)) continue;
    const stat = fs.statSync(full);
    files.push({ name: entry.name, path: full, relativePath: path.relative(root, full).split(path.sep).join('/'), size: stat.size });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-Hans-CN', { numeric: true }));
}

export function refreshSkillRunResults(id: string): SkillRunRecord | null {
  const run = getSkillRun(id);
  if (!run) return null;
  const resultFiles = collectFiles(run.outputDir);
  return updateSkillRun(id, { resultFiles });
}

export function getSkillRunRoot(): string {
  ensureRoot();
  return RUN_ROOT;
}
