import fs from "fs";
import { open, mkdir, rename, unlink } from "node:fs/promises";
import os from "os";
import path from "path";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { readBackupManifest } from "./project-backup-format";
import { assertRepository } from './backup-connection';
import type {
  ProjectArchiveEntry,
  ProjectArchiveJob,
  ProjectArchiveJobAction,
  ProjectArchiveManifest,
} from "@/lib/project-archive-types";

export type ArchiveConfig = {
  syncDir: string;
  updatedAt: string | null;
  repositoryId?: string;
  remote?: import("./project-archive-types").BackupRemoteLocation;
};

const CONFIG_FILE = "project-archive-config.json";
const PACKAGE_DIR = "project-packages";

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) return path.resolve(process.env.LOCAL_DATA_DIR);
  if (process.env.DESKTOP_ENV_PATH) return path.dirname(process.env.DESKTOP_ENV_PATH);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "环中AIStudio");
  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "环中AIStudio");
  if (process.platform === "linux") return path.join(home, ".config", "环中AIStudio");
  return path.join(process.cwd(), ".local-data", "环中AIStudio");
}

function getConfigPath(): string {
  return path.join(getBaseDataDir(), CONFIG_FILE);
}

function sha256(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

export function readArchiveConfig(): ArchiveConfig {
  try {
    const filePath = getConfigPath();
    if (!fs.existsSync(filePath)) {
      const legacy = path.join(getBaseDataDir(), "cloud-sync-config.json");
      if (fs.existsSync(legacy)) { const config = JSON.parse(fs.readFileSync(legacy, "utf8")); return { syncDir: typeof config.syncDir === "string" ? config.syncDir : "", updatedAt: null }; }
      return { syncDir: "", updatedAt: null };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ArchiveConfig>;
    return {
      syncDir: typeof parsed.syncDir === "string" ? parsed.syncDir : "",
      repositoryId: parsed.repositoryId,
      remote: parsed.remote,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return { syncDir: "", updatedAt: null };
  }
}

export function writeArchiveConfig(syncDir: string, remote?: ArchiveConfig["remote"]): ArchiveConfig {
  const root = safeArchiveRoot(syncDir);
  assertArchiveRoot(root);
  fs.accessSync(root, fs.constants.W_OK);
  const marker = path.join(root, ".huanzon-aistudio-repository.json");
  let repositoryId: string;
  if (fs.existsSync(marker)) repositoryId = JSON.parse(fs.readFileSync(marker, "utf8")).id;
  else { repositoryId = randomUUID(); writeJsonAtomic(marker, { id: repositoryId, version: 1 }); }
  const config: ArchiveConfig = {
    syncDir: root,
    repositoryId,
    remote,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(getConfigPath(), config);
  return config;
}

export function safeArchiveRoot(raw: string): string {
  if (!path.isAbsolute((raw || "").trim())) throw new Error("请选择绝对路径的备份文件夹");
  const resolved = path.resolve(raw.trim());
  if (!resolved || resolved === path.parse(resolved).root) throw new Error("归档目录无效");
  return resolved;
}

export function getArchiveRoot(syncDir?: string): string {
  const raw = syncDir?.trim() || readArchiveConfig().syncDir;
  if (!raw) throw new Error("请先配置 NAS / 本地归档目录");
  return safeArchiveRoot(raw);
}

export function assertArchiveRoot(root: string): void {
  const config = readArchiveConfig();
  assertRepository(root, path.resolve(config.syncDir || '.') === path.resolve(root) ? config.repositoryId : undefined);
}

function resolveRootPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("归档路径非法");
  }
  return resolved;
}

export function makeArchiveEntry(manifest: ProjectArchiveManifest, size: number, checksum: string, fileName: string): ProjectArchiveEntry {
  const relativePath = path.posix.join(PACKAGE_DIR, manifest.originalProjectId, fileName);
  const metaRelativePath = `${relativePath}.meta.json`;
  const now = new Date().toISOString();
  return {
    id: manifest.archiveId,
    archiveId: manifest.archiveId,
    projectId: manifest.originalProjectId,
    projectName: manifest.projectName,
    fileName,
    relativePath,
    metaRelativePath,
    size,
    checksum,
    manifestVersion: manifest.version,
    createdAt: manifest.exportedAt || now,
    updatedAt: now,
    archivedAt: now,
    restoredAt: null,
    restoredProjectId: null,
    ownerId: typeof manifest.data.project.user_id === "string" ? manifest.data.project.user_id : undefined,
    sourceFormat: manifest.appVersion === "legacy" ? "legacy" : "archive",
    missingHistoryAssetCount: manifest.missingHistoryAssets?.length || 0,
    deviceName: process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname() || "未知设备",
    counts: {
      images: manifest.data.imageRecords.length,
      messages: manifest.data.chatMessages.length,
      references: manifest.data.referenceImages.length,
      prompts: manifest.data.prompts.length,
      skills: manifest.data.skills.length,
      designAssets: manifest.data.designAssets.length,
      inspirationItems: manifest.data.inspirationItems.length,
    },
  };
}

export async function writeArchivePackage(
  root: string,
  buffer: Buffer,
  fileName: string,
  manifest: ProjectArchiveManifest,
): Promise<ProjectArchiveEntry> {
  assertArchiveRoot(root);
  const entry = makeArchiveEntry(manifest, buffer.length, sha256(buffer), fileName);
  const packagePath = resolveRootPath(root, entry.relativePath);
  const metaPath = resolveRootPath(root, entry.metaRelativePath);
  await mkdir(path.dirname(packagePath), { recursive: true });
  const partPath = `${packagePath}.${randomUUID()}.part`;
  // Bounded writes avoid oversized SMB writes; validate the actual file before
  // making it discoverable as a completed backup. Never accept a partial copy.
  try {
    const file = await open(partPath, "wx");
    try {
      for (let offset = 0; offset < buffer.length;) {
        const length = Math.min(1024 * 1024, buffer.length - offset);
        const { bytesWritten } = await file.write(buffer, offset, length, offset);
        if (!bytesWritten) throw new Error("备份写入未完成");
        offset += bytesWritten;
      }
      await file.sync();
    } finally { await file.close(); }
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(partPath, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
    if (hash.digest("hex") !== entry.checksum) throw new Error("NAS 写入校验失败，请检查连接后重试；本机项目已保留");
    await rename(partPath, packagePath);
  } catch (error) {
    await unlink(partPath).catch(() => {});
    throw error;
  }
  const zip = await JSZip.loadAsync(buffer);
  entry.thumbnailDataUrl = await archiveThumbnail(zip, manifest);
  writeJsonAtomic(metaPath, entry);
  return entry;
}

function isArchivePackage(fileName: string): boolean {
  return /\.hz(archive|proj)\.zip$/i.test(fileName);
}

async function createEntryFromPackage(packagePath: string, root: string): Promise<ProjectArchiveEntry | null> {
  try {
    const buffer = fs.readFileSync(packagePath);
    const zip = await JSZip.loadAsync(buffer);
    const manifest = await readBackupManifest(buffer);
    const entry = makeArchiveEntry(manifest, buffer.length, sha256(buffer), path.basename(packagePath));
    const relativePath = path.relative(root, packagePath).split(path.sep).join(path.posix.sep);
    entry.relativePath = relativePath;
    entry.metaRelativePath = `${relativePath}.meta.json`;
    entry.archivedAt = fs.statSync(packagePath).mtime.toISOString();
    entry.updatedAt = entry.archivedAt;
    entry.thumbnailDataUrl = await archiveThumbnail(zip, manifest);
    return entry;
  } catch {
    return null;
  }
}

async function archiveThumbnail(zip: JSZip, manifest: ProjectArchiveManifest): Promise<string> {
  const rows = manifest.data.imageRecords.filter(row => !row.deleted_at);
  const selected = rows.slice(0, 4).map(row => manifest.assets.find(asset =>
    (row.image_key && asset.storageKey === row.image_key) || (row.image_url && asset.originalUrl === row.image_url),
  )).filter(Boolean);
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < selected.length; i++) {
    const file = zip.file(selected[i]!.archivePath);
    if (!file) continue;
    try {
      const input = await sharp(await file.async("nodebuffer"), { limitInputPixels: 80_000_000 }).rotate().resize(selected.length === 1 ? 480 : 238, selected.length <= 2 ? 300 : 148, { fit: "cover" }).webp({ quality: 65 }).toBuffer();
      tiles.push({ input, left: selected.length === 1 ? 0 : (i % 2) * 242, top: selected.length <= 2 ? 0 : Math.floor(i / 2) * 152 });
    } catch { /* Preview failure does not invalidate project data. */ }
  }
  if (!tiles.length) return "";
  return `data:image/webp;base64,${(await sharp({ create: { width: 480, height: 300, channels: 3, background: "#ececec" } }).composite(tiles).webp({ quality: 65 }).toBuffer()).toString("base64")}`;
}

export async function listArchiveEntries(rootInput?: string): Promise<ProjectArchiveEntry[]> {
  const root = getArchiveRoot(rootInput);
  assertArchiveRoot(root);
  const packages: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && (current !== root || entry.name === PACKAGE_DIR)) stack.push(fullPath);
      else if (entry.isFile() && isArchivePackage(entry.name)) packages.push(fullPath);
    }
  }
  const result: ProjectArchiveEntry[] = [];
  for (const packagePath of packages) {
    const metaPath = `${packagePath}.meta.json`;
    let entry: ProjectArchiveEntry | null = null;
    if (fs.existsSync(metaPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(metaPath, "utf8")) as ProjectArchiveEntry;
        if (saved.id && saved.projectId && saved.thumbnailDataUrl !== undefined && saved.sourceFormat) entry = saved;
      } catch { /* Rebuild metadata from the package. */ }
    }
    if (!entry) {
      const rebuilt = await createEntryFromPackage(packagePath, root);
      if (rebuilt) {
        let old: Partial<ProjectArchiveEntry> = {};
        try { old = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch { /* No previous metadata. */ }
        entry = { ...rebuilt, restoredAt: old.restoredAt || null, restoredProjectId: old.restoredProjectId || null };
        writeJsonAtomic(metaPath, entry);
      }
    }
    if (entry) {
      entry.relativePath = path.relative(root, packagePath).split(path.sep).join(path.posix.sep);
      entry.metaRelativePath = `${entry.relativePath}.meta.json`;
      result.push(entry);
    }
  }
  result.sort((a, b) => new Date(b.archivedAt || b.updatedAt).getTime() - new Date(a.archivedAt || a.updatedAt).getTime());
  return result;
}

export async function findArchiveEntry(rootInput: string, entryId: string): Promise<ProjectArchiveEntry> {
  const root = getArchiveRoot(rootInput);
  const entries = await listArchiveEntries(root);
  const entry = entries.find((item) => item.id === entryId || item.archiveId === entryId);
  if (!entry) throw new Error("NAS 归档包不存在");
  return entry;
}

export function readArchiveEntryBuffer(rootInput: string, entry: ProjectArchiveEntry): Buffer {
  const root = getArchiveRoot(rootInput);
  assertArchiveRoot(root);
  const packagePath = resolveRootPath(root, entry.relativePath);
  if (!fs.existsSync(packagePath)) throw new Error("NAS 归档包文件不存在");
  const buffer = fs.readFileSync(packagePath);
  if (entry.checksum && sha256(buffer) !== entry.checksum) throw new Error("备份包校验失败，文件可能已损坏");
  return buffer;
}

export function updateArchiveEntryMeta(
  rootInput: string,
  entry: ProjectArchiveEntry,
  updates: Partial<ProjectArchiveEntry>,
): ProjectArchiveEntry {
  const root = getArchiveRoot(rootInput);
  const next: ProjectArchiveEntry = {
    ...entry,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(resolveRootPath(root, next.metaRelativePath), next);
  return next;
}

export function deleteArchivePackage(rootInput: string, entry: ProjectArchiveEntry): void {
  const root = getArchiveRoot(rootInput);
  assertArchiveRoot(root);
  const packagePath = resolveRootPath(root, entry.relativePath);
  const metaPath = resolveRootPath(root, entry.metaRelativePath);
  if (fs.existsSync(packagePath)) fs.unlinkSync(packagePath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  const packageDir = path.dirname(packagePath);
  if (fs.existsSync(packageDir) && fs.readdirSync(packageDir).length === 0) fs.rmdirSync(packageDir);
}

export type ProjectArchiveJobPayload = {
  userId: string;
  projectIds?: string[];
  entryIds?: string[];
  deleteAfterBackup?: boolean;
  removeOnly?: boolean;
  backupEntryByProject?: Record<string, string>;
  baseUrl?: string;
  operationIds?: Record<string, string>;
};

export type StoredArchiveJob = ProjectArchiveJob & {
  payload: ProjectArchiveJobPayload;
};

const JOBS_FILE = "project-archive-jobs.json";

function getJobsPath(): string {
  return path.join(getBaseDataDir(), JOBS_FILE);
}

function readStoredJobs(): StoredArchiveJob[] {
  try {
    const filePath = getJobsPath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const rawJobs = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { jobs?: unknown }).jobs)
        ? (parsed as { jobs: unknown[] }).jobs
        : [];
    return rawJobs.filter((item): item is StoredArchiveJob => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.action === "string" && Boolean(record.payload);
    });
  } catch {
    return [];
  }
}

function writeStoredJobs(jobs: StoredArchiveJob[]): void {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = jobs
    .filter((job) => ["queued", "running", "waiting", "paused"].includes(job.status) || new Date(job.updatedAt || job.createdAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100);
  const unfinished = jobs.filter(job => ["queued", "running", "waiting", "paused"].includes(job.status));
  writeJsonAtomic(getJobsPath(), { version: 1, jobs: [...unfinished, ...recent.filter(job => !unfinished.some(active => active.id === job.id))] });
}

export function listStoredArchiveJobs(): StoredArchiveJob[] {
  return readStoredJobs();
}

export function createArchiveJob(
  action: ProjectArchiveJobAction,
  targetDir: string,
  total: number,
  payload: ProjectArchiveJobPayload,
): ProjectArchiveJob {
  const now = new Date().toISOString();
  const job: StoredArchiveJob = {
    id: `archive_job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    action,
    status: "queued",
    stage: action === "archive" ? "准备归档" : "准备恢复",
    targetDir,
    total,
    completed: 0,
    failed: 0,
    currentProjectId: null,
    currentProjectName: null,
    results: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    payload: { ...payload, operationIds: payload.operationIds || Object.fromEntries((payload.projectIds || []).map(id => [id, `archive_${randomUUID()}`])) },
  };
  const jobs = readStoredJobs();
  jobs.unshift(job);
  writeStoredJobs(jobs);
  return publicArchiveJob(job);
}

export function getArchiveJob(jobId: string): ProjectArchiveJob | null {
  const job = readStoredJobs().find((item) => item.id === jobId);
  return job ? publicArchiveJob(job) : null;
}

export function getStoredArchiveJob(jobId: string): StoredArchiveJob | null {
  return readStoredJobs().find((item) => item.id === jobId) || null;
}

export function updateArchiveJob(
  jobId: string,
  updates: Partial<ProjectArchiveJob>,
): ProjectArchiveJob | null {
  const jobs = readStoredJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) return null;
  const next = { ...jobs[index], ...updates, updatedAt: new Date().toISOString() };
  jobs[index] = next;
  writeStoredJobs(jobs);
  return publicArchiveJob(next);
}

function publicArchiveJob(job: StoredArchiveJob): ProjectArchiveJob {
  const { payload: _payload, ...publicJob } = job;
  return publicJob;
}
