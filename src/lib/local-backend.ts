import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { getRuntimeBackendMode, getRuntimeDownloadDirectory } from "@/lib/runtime-config";
import { isCozeCloudRuntime } from "@/lib/deploy-mode";
import type {
  AssetVersion,
  AssetIndexEntry,
  AssetIndexJob,
  DesignAsset,
  DesignLayer,
  DesignOperation,
  DesignOperationStatus,
} from "@/lib/types";

export interface LocalProjectRecord {
  id: string;
  user_id: string | null;
  name: string;
  is_pinned: boolean;
  sort_order: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LocalProjectFolderRecord {
  id: string;
  user_id: string | null;
  name: string;
  color: string;
  parent_id: string | null;
  sort_order: number;
  is_collapsed: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface LocalImageRecord {
  id: string;
  project_id: string | null;
  user_id: string | null;
  prompt: string;
  image_url: string;
  image_key: string | null;
  reference_images: string | null;
  canvas_block_id?: string | null;
  block_order?: number;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
  size: string;
  model: string;
  status: string;
  is_favorite: boolean;
  deleted_at: string | null;
  edited_image_key: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LocalArchivedImageRecord {
  id: string;
  project_id: string | null;
  user_id: string | null;
  original_image_id: string | null;
  folder_id: string | null;
  prompt: string;
  original_prompt: string;
  image_url: string;
  image_key: string | null;
  model: string;
  size: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface LocalArchivedFolderRecord {
  id: string;
  user_id: string | null;
  name: string;
  parent_id: string | null;
  sort_order: number;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface LocalChatMessageRecord {
  id: string;
  user_id: string | null;
  project_id: string | null;
  role: "user" | "assistant";
  content: string;
  reference_image_urls: string | null;
  image_url: string | null;
  created_at: string;
}

export interface LocalReferenceImageRecord {
  id: string;
  user_id: string | null;
  project_id: string | null;
  image_url: string;
  image_key: string | null;
  file_name: string | null;
  created_at: string;
}

export interface LocalCanvasBlockRecord {
  id: string;
  project_id: string | null;
  user_id: string | null;
  name: string;
  color: string;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
  image_scale: number;
  sort_mode: "compact" | "time_desc" | "time_asc" | "batch";
  padding: number;
  locked: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface LocalPromptRecord {
  id: string;
  user_id: string | null;
  project_id: string | null;
  text: string;
  category: string;
  image_url: string | null;
  name?: string;
  content?: string;
  category_id?: number;
  library_id?: number | null;
  tags?: string;
  use_count?: number;
  is_hot?: number;
  source?: string;
  atom_ids?: string;
  model?: string;
  aspect_ratio?: string;
  vars?: unknown[];
  kind?: "atom" | "package" | "template" | "general";
  updated_at?: string;
  created_at: string;
}

export interface LocalImageTagRecord {
  id: string;
  user_id: string | null;
  image_id: string;
  tag: string;
  created_at: string;
}

export interface LocalSkillRecord {
  id: string;
  user_id: string | null;
  project_id: string | null;
  name: string;
  description: string;
  steps: string;
  created_at: string;
  updated_at: string;
}

export type LocalDesignAssetRecord = DesignAsset & { user_id: string | null };
export type LocalDesignLayerRecord = DesignLayer & { user_id: string | null };
export type LocalAssetVersionRecord = AssetVersion & { user_id: string | null };
export type LocalDesignOperationRecord = DesignOperation & { user_id: string | null };
export type LocalAssetIndexEntryRecord = AssetIndexEntry & { user_id: string | null };
export type LocalAssetIndexJobRecord = AssetIndexJob & { user_id: string | null };

interface LocalDatabase {
  version: number;
  projects: LocalProjectRecord[];
  project_folders: LocalProjectFolderRecord[];
  image_records: LocalImageRecord[];
  archived_images: LocalArchivedImageRecord[];
  archived_folders: LocalArchivedFolderRecord[];
  chat_messages: LocalChatMessageRecord[];
  reference_images: LocalReferenceImageRecord[];
  canvas_blocks: LocalCanvasBlockRecord[];
  prompt_library: LocalPromptRecord[];
  image_tags: LocalImageTagRecord[];
  custom_skills: LocalSkillRecord[];
  design_assets: LocalDesignAssetRecord[];
  design_layers: LocalDesignLayerRecord[];
  design_operations: LocalDesignOperationRecord[];
  asset_versions: LocalAssetVersionRecord[];
  asset_index_entries: LocalAssetIndexEntryRecord[];
  asset_index_jobs: LocalAssetIndexJobRecord[];
}

interface LocalFileSaveResult {
  key: string;
  url: string;
}

const APP_NAME = "环中AIStudio";
const LOCAL_DATA_SUBDIR = "local-data";
const LOCAL_FILES_SUBDIR = "files";
const DB_FILE_NAME = "db.json";

const EMPTY_DB: LocalDatabase = {
  version: 1,
  projects: [],
  project_folders: [],
  image_records: [],
  archived_images: [],
  archived_folders: [],
  chat_messages: [],
  reference_images: [],
  canvas_blocks: [],
  prompt_library: [],
  image_tags: [],
  custom_skills: [],
  design_assets: [],
  design_layers: [],
  design_operations: [],
  asset_versions: [],
  asset_index_entries: [],
  asset_index_jobs: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneEmptyDb(): LocalDatabase {
  return {
    version: 1,
    projects: [],
    project_folders: [],
    image_records: [],
    archived_images: [],
    archived_folders: [],
    chat_messages: [],
    reference_images: [],
    canvas_blocks: [],
    prompt_library: [],
    image_tags: [],
    custom_skills: [],
    design_assets: [],
    design_layers: [],
    design_operations: [],
    asset_versions: [],
    asset_index_entries: [],
    asset_index_jobs: [],
  };
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function ensureDbShape(raw: unknown): LocalDatabase {
  if (!raw || typeof raw !== "object") {
    return cloneEmptyDb();
  }
  const obj = raw as Record<string, unknown>;
  return {
    version: typeof obj.version === "number" ? obj.version : 1,
    projects: ensureArray<LocalProjectRecord>(obj.projects),
    project_folders: ensureArray<LocalProjectFolderRecord>(obj.project_folders),
    image_records: ensureArray<LocalImageRecord>(obj.image_records),
    archived_images: ensureArray<LocalArchivedImageRecord>(obj.archived_images),
    archived_folders: ensureArray<LocalArchivedFolderRecord>(obj.archived_folders),
    chat_messages: ensureArray<LocalChatMessageRecord>(obj.chat_messages),
    reference_images: ensureArray<LocalReferenceImageRecord>(obj.reference_images),
    canvas_blocks: ensureArray<LocalCanvasBlockRecord>(obj.canvas_blocks),
    prompt_library: ensureArray<LocalPromptRecord>(obj.prompt_library),
    image_tags: ensureArray<LocalImageTagRecord>(obj.image_tags),
    custom_skills: ensureArray<LocalSkillRecord>(obj.custom_skills),
    design_assets: ensureArray<LocalDesignAssetRecord>(obj.design_assets),
    design_layers: ensureArray<LocalDesignLayerRecord>(obj.design_layers),
    design_operations: ensureArray<LocalDesignOperationRecord>(obj.design_operations),
    asset_versions: ensureArray<LocalAssetVersionRecord>(obj.asset_versions),
    asset_index_entries: ensureArray<LocalAssetIndexEntryRecord>(obj.asset_index_entries),
    asset_index_jobs: ensureArray<LocalAssetIndexJobRecord>(obj.asset_index_jobs),
  };
}

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) {
    return path.resolve(process.env.LOCAL_DATA_DIR);
  }

  if (process.env.DESKTOP_ENV_PATH) {
    return path.dirname(process.env.DESKTOP_ENV_PATH);
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_NAME);
  }

  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }
  if (process.platform === "linux") {
    return path.join(home, ".config", APP_NAME);
  }
  return path.join(process.cwd(), ".local-data", APP_NAME);
}

function getLocalDataRoot(): string {
  return path.join(getBaseDataDir(), LOCAL_DATA_SUBDIR);
}

function getDbPath(): string {
  return path.join(getLocalDataRoot(), DB_FILE_NAME);
}

function getLocalFilesDir(): string {
  return path.join(getLocalDataRoot(), LOCAL_FILES_SUBDIR);
}

function ensureLocalDirs(): void {
  fs.mkdirSync(getLocalDataRoot(), { recursive: true });
  fs.mkdirSync(getLocalFilesDir(), { recursive: true });
}

function ensureDbFile(): void {
  ensureLocalDirs();
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2), "utf8");
  }
}

function readDb(): LocalDatabase {
  ensureDbFile();
  try {
    const text = fs.readFileSync(getDbPath(), "utf8");
    const parsed = JSON.parse(text) as unknown;
    return ensureDbShape(parsed);
  } catch {
    return cloneEmptyDb();
  }
}

function writeDb(db: LocalDatabase): void {
  ensureLocalDirs();
  const dbPath = getDbPath();
  const tempPath = `${dbPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tempPath, dbPath);
}

function withDb<T>(mutator: (db: LocalDatabase) => T): T {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

function safeUserId(userId?: string | null): string | null {
  return userId ?? null;
}

function sortByDateDesc<T extends { updated_at?: string | null; created_at?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aDate = new Date(a.updated_at || a.created_at || 0).getTime();
    const bDate = new Date(b.updated_at || b.created_at || 0).getTime();
    return bDate - aDate;
  });
}

function sanitizeFileKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extFromContentType(contentType?: string): string {
  if (!contentType) return "png";
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  return "bin";
}

function extFromFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  const ext = parsed.ext.replace(/^\./, "").trim().toLowerCase();
  return ext || "png";
}

function sanitizeDownloadFileName(input: string): string {
  const base = input.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  return base || `image-${Date.now()}.png`;
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveUniqueFilePath(directory: string, fileName: string): string {
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "image";
  const ext = parsed.ext || "";
  let target = path.join(directory, `${baseName}${ext}`);
  let counter = 1;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${baseName}-${counter}${ext}`);
    counter += 1;
  }
  return target;
}

function keyToLocalUrl(key: string): string {
  return `/api/local-file/${encodeURIComponent(key)}`;
}

function removeFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

type LocalFileKeyIgnore = {
  imageRecordId?: string;
  archivedImageId?: string;
  referenceImageId?: string;
  designAssetId?: string;
  assetVersionId?: string;
};

export function isLocalBackendEnabled(): boolean {
  if (isCozeCloudRuntime()) return false;
  const runtimeMode = getRuntimeBackendMode();
  if (runtimeMode === "local") return true;
  if (runtimeMode === "lan") return true;
  if (process.env.LOCAL_BACKEND === "0") return false;
  if (process.env.HZ_BACKEND_MODE === "supabase") return false;
  return true;
}

export function resolveLocalFilePath(fileKey: string): string {
  ensureLocalDirs();
  const safe = sanitizeFileKey(path.basename(fileKey));
  return path.join(getLocalFilesDir(), safe);
}

export function getLocalFileUrl(fileKey: string): string {
  return keyToLocalUrl(sanitizeFileKey(path.basename(fileKey)));
}

export function deleteLocalFileByKey(fileKey?: string | null): void {
  if (!fileKey) return;
  removeFileIfExists(resolveLocalFilePath(fileKey));
}

function isLocalFileKeyReferenced(db: LocalDatabase, fileKey: string, ignore: LocalFileKeyIgnore = {}): boolean {
  if (!fileKey) return false;

  for (const record of db.image_records) {
    if (ignore.imageRecordId && record.id === ignore.imageRecordId) continue;
    if (record.image_key === fileKey || record.edited_image_key === fileKey) return true;
  }

  for (const record of db.archived_images) {
    if (ignore.archivedImageId && record.id === ignore.archivedImageId) continue;
    if (record.image_key === fileKey) return true;
  }

  for (const record of db.reference_images) {
    if (ignore.referenceImageId && record.id === ignore.referenceImageId) continue;
    if (record.image_key === fileKey) return true;
  }

  for (const record of db.design_assets) {
    if (ignore.designAssetId && record.id === ignore.designAssetId) continue;
    if (record.key === fileKey) return true;
  }

  for (const record of db.asset_versions) {
    if (ignore.assetVersionId && record.id === ignore.assetVersionId) continue;
    if (record.key === fileKey) return true;
  }

  return false;
}

function deleteLocalFileByKeyIfUnused(db: LocalDatabase, fileKey?: string | null, ignore: LocalFileKeyIgnore = {}): void {
  if (!fileKey) return;
  if (isLocalFileKeyReferenced(db, fileKey, ignore)) return;
  deleteLocalFileByKey(fileKey);
}

export function saveBinaryFile(buffer: Buffer, fileNameHint = "file", contentType?: string): LocalFileSaveResult {
  ensureLocalDirs();
  const ext = fileNameHint.includes(".")
    ? extFromFileName(fileNameHint)
    : extFromContentType(contentType);
  const key = sanitizeFileKey(`${path.parse(fileNameHint).name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
  const filePath = resolveLocalFilePath(key);
  fs.writeFileSync(filePath, buffer);
  return { key, url: getLocalFileUrl(key) };
}

export async function saveRemoteImageToLocal(remoteUrl: string, namePrefix = "image"): Promise<LocalFileSaveResult | null> {
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return saveBinaryFile(buf, `${namePrefix}.png`, contentType);
  } catch {
    return null;
  }
}

export function duplicateLocalFileByKey(sourceKey: string): LocalFileSaveResult | null {
  try {
    ensureLocalDirs();
    const sourcePath = resolveLocalFilePath(sourceKey);
    if (!fs.existsSync(sourcePath)) return null;
    const sourceName = path.basename(sourceKey) || "image.png";
    const sourceBuffer = fs.readFileSync(sourcePath);
    return saveBinaryFile(sourceBuffer, sourceName);
  } catch {
    return null;
  }
}

function extractLocalFileKeyFromUrl(fileUrl?: string | null): string | null {
  const raw = (fileUrl || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "http://local");
    if (!parsed.pathname.startsWith("/api/local-file/")) return null;
    const encodedKey = parsed.pathname.slice("/api/local-file/".length).split("/")[0];
    if (!encodedKey) return null;
    return decodeURIComponent(encodedKey);
  } catch {
    if (!raw.startsWith("/api/local-file/")) return null;
    const encodedKey = raw.slice("/api/local-file/".length).split("?")[0].split("/")[0];
    if (!encodedKey) return null;
    try {
      return decodeURIComponent(encodedKey);
    } catch {
      return encodedKey;
    }
  }
}

async function duplicateArchivedImageSource(input: {
  imageUrl: string;
  imageKey?: string | null;
  fileNameHint?: string;
}): Promise<LocalFileSaveResult | null> {
  const sourceKey = (input.imageKey || "").trim() || extractLocalFileKeyFromUrl(input.imageUrl);
  if (sourceKey) {
    const duplicate = duplicateLocalFileByKey(sourceKey);
    if (duplicate) return duplicate;
  }

  const imageUrl = (input.imageUrl || "").trim();
  if (!imageUrl) return null;

  if (imageUrl.startsWith("data:")) {
    try {
      const match = imageUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
      if (!match) return null;
      const mimeType = match[1] || "application/octet-stream";
      const isBase64 = Boolean(match[2]);
      const payload = match[3] || "";
      const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
      return saveBinaryFile(buffer, input.fileNameHint || "archived-image.png", mimeType);
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    return saveRemoteImageToLocal(imageUrl, input.fileNameHint || "archived-image");
  }

  return null;
}

export type DownloadImageSaveResult = {
  filePath: string;
  fileName: string;
  size: number;
  directory: string;
};

export async function saveRemoteImageToDownloadDirectory(
  remoteUrl: string,
  fileNameHint: string,
  explicitDirectory?: string,
): Promise<DownloadImageSaveResult> {
  const rawDirectory = (explicitDirectory || getRuntimeDownloadDirectory() || "").trim();
  if (!rawDirectory) {
    throw new Error("请先设置默认下载位置");
  }
  const directory = path.resolve(rawDirectory);

  ensureDirectory(directory);

  const response = await fetch(remoteUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`图片下载失败 (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || undefined;
  const safeFileName = sanitizeDownloadFileName(fileNameHint);
  const hasExt = Boolean(path.parse(safeFileName).ext);
  const finalName = hasExt
    ? safeFileName
    : `${safeFileName}.${extFromContentType(contentType)}`;

  const filePath = resolveUniqueFilePath(directory, finalName);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    fileName: path.basename(filePath),
    size: buffer.byteLength,
    directory,
  };
}

export function listProjects(userId?: string | null): LocalProjectRecord[] {
  const uid = safeUserId(userId);
  const db = readDb();
  return db.projects
    .filter((p) => p.user_id === uid)
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      if (a.sort_order !== b.sort_order) return b.sort_order - a.sort_order;
      const aCreated = new Date(a.created_at || 0).getTime();
      const bCreated = new Date(b.created_at || 0).getTime();
      if (aCreated !== bCreated) return bCreated - aCreated;
      return a.id.localeCompare(b.id);
    });
}

export function createProject(userId: string | null, name: string, folderId: string | null = null): LocalProjectRecord {
  return withDb((db) => {
    const uid = safeUserId(userId);
    const highestSortOrder = db.projects
      .filter((p) => p.user_id === uid)
      .reduce((max, project) => Math.max(max, Number(project.sort_order) || 0), 0);
    const now = nowIso();
    const project: LocalProjectRecord = {
      id: randomUUID(),
      user_id: uid,
      name: name || "未命名项目",
      is_pinned: false,
      sort_order: highestSortOrder + 1,
      folder_id: folderId,
      created_at: now,
      updated_at: now,
    };
    db.projects.push(project);
    return project;
  });
}

export function getProjectById(projectId: string, userId?: string | null): LocalProjectRecord | null {
  const uid = safeUserId(userId);
  const db = readDb();
  return db.projects.find((p) => p.id === projectId && p.user_id === uid) || null;
}

export function updateProject(
  projectId: string,
  userId: string | null,
  updates: Partial<Pick<LocalProjectRecord, "name" | "is_pinned" | "sort_order" | "folder_id">>,
): LocalProjectRecord | null {
  return withDb((db) => {
    const target = db.projects.find((p) => p.id === projectId && p.user_id === userId);
    if (!target) return null;
    if (updates.name !== undefined) target.name = updates.name;
    if (updates.is_pinned !== undefined) target.is_pinned = updates.is_pinned;
    if (updates.sort_order !== undefined) target.sort_order = updates.sort_order;
    if (updates.folder_id !== undefined) target.folder_id = updates.folder_id;
    target.updated_at = nowIso();
    return target;
  });
}

export function deleteProjectCascade(projectId: string, userId: string | null): boolean {
  return withDb((db) => {
    const exists = db.projects.some((p) => p.id === projectId && p.user_id === userId);
    if (!exists) return false;

    const deletingImageIds = new Set(
      db.image_records
        .filter((r) => r.project_id === projectId && r.user_id === userId)
        .map((r) => r.id),
    );
    const deletingImageKeys = db.image_records
      .filter((r) => r.project_id === projectId && r.user_id === userId)
      .flatMap((r) => [r.image_key, r.edited_image_key])
      .filter(Boolean) as string[];
    const deletingArchivedKeys = db.archived_images
      .filter((r) => r.project_id === projectId && r.user_id === userId)
      .map((r) => r.image_key)
      .filter(Boolean) as string[];
    const deletingRefKeys = db.reference_images
      .filter((r) => r.project_id === projectId && r.user_id === userId)
      .map((r) => r.image_key)
      .filter(Boolean) as string[];

    db.chat_messages = db.chat_messages.filter((m) => !(m.project_id === projectId && m.user_id === userId));
    db.image_records = db.image_records.filter((r) => !(r.project_id === projectId && r.user_id === userId));
    db.canvas_blocks = db.canvas_blocks.filter((b) => !(b.project_id === projectId && b.user_id === userId));
    db.archived_images = db.archived_images.filter((r) => !(r.project_id === projectId && r.user_id === userId));
    db.reference_images = db.reference_images.filter((r) => !(r.project_id === projectId && r.user_id === userId));
    db.image_tags = db.image_tags.filter((tag) => !deletingImageIds.has(tag.image_id));
    db.prompt_library = db.prompt_library.filter((p) => !(p.project_id === projectId && p.user_id === userId));
    db.custom_skills = db.custom_skills.filter((s) => !(s.project_id === projectId && s.user_id === userId));
    db.projects = db.projects.filter((p) => !(p.id === projectId && p.user_id === userId));

    for (const key of new Set([...deletingImageKeys, ...deletingArchivedKeys, ...deletingRefKeys])) {
      deleteLocalFileByKeyIfUnused(db, key);
    }
    return true;
  });
}

export function listProjectFolders(userId?: string | null): LocalProjectFolderRecord[] {
  const uid = safeUserId(userId);
  const db = readDb();
  return db.project_folders
    .filter((f) => f.user_id === uid)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function createProjectFolder(
  userId: string | null,
  input: Partial<Pick<LocalProjectFolderRecord, "name" | "color" | "parent_id" | "sort_order" | "is_collapsed">>,
): LocalProjectFolderRecord {
  return withDb((db) => {
    const now = nowIso();
    const folder: LocalProjectFolderRecord = {
      id: randomUUID(),
      user_id: userId,
      name: input.name || "新建文件夹",
      color: input.color || "#6366f1",
      parent_id: input.parent_id || null,
      sort_order: input.sort_order ?? 0,
      is_collapsed: input.is_collapsed ?? false,
      created_at: now,
      updated_at: now,
    };
    db.project_folders.push(folder);
    return folder;
  });
}

export function updateProjectFolder(
  folderId: string,
  userId: string | null,
  input: Partial<Pick<LocalProjectFolderRecord, "name" | "color" | "parent_id" | "sort_order" | "is_collapsed">>,
): LocalProjectFolderRecord | null {
  return withDb((db) => {
    const folder = db.project_folders.find((f) => f.id === folderId && f.user_id === userId);
    if (!folder) return null;
    if (input.name !== undefined) folder.name = input.name;
    if (input.color !== undefined) folder.color = input.color;
    if (input.parent_id !== undefined) folder.parent_id = input.parent_id;
    if (input.sort_order !== undefined) folder.sort_order = input.sort_order;
    if (input.is_collapsed !== undefined) folder.is_collapsed = input.is_collapsed;
    folder.updated_at = nowIso();
    return folder;
  });
}

export function deleteProjectFolder(folderId: string, userId: string | null): boolean {
  return withDb((db) => {
    const exists = db.project_folders.some((f) => f.id === folderId && f.user_id === userId);
    if (!exists) return false;
    db.project_folders = db.project_folders.filter((f) => !(f.id === folderId && f.user_id === userId));
    db.projects.forEach((p) => {
      if (p.user_id === userId && p.folder_id === folderId) {
        p.folder_id = null;
        p.updated_at = nowIso();
      }
    });
    return true;
  });
}

export function listChatMessages(
  projectId: string,
  userId?: string | null,
  limit?: number,
  ascending = true,
): LocalChatMessageRecord[] {
  const uid = safeUserId(userId);
  const db = readDb();
  let items = db.chat_messages.filter((m) => m.project_id === projectId && m.user_id === uid);
  items = items.sort((a, b) => {
    const aDate = new Date(a.created_at).getTime();
    const bDate = new Date(b.created_at).getTime();
    return ascending ? aDate - bDate : bDate - aDate;
  });
  if (limit && limit > 0) {
    items = ascending ? items.slice(-limit) : items.slice(0, limit);
  }
  return items;
}

export function createChatMessage(
  projectId: string | null,
  userId: string | null,
  role: "user" | "assistant",
  content: string,
  referenceImageUrls?: string[] | null,
  imageUrl?: string | null,
): LocalChatMessageRecord {
  return withDb((db) => {
    const message: LocalChatMessageRecord = {
      id: randomUUID(),
      user_id: userId,
      project_id: projectId,
      role,
      content,
      reference_image_urls: referenceImageUrls && referenceImageUrls.length > 0
        ? JSON.stringify(referenceImageUrls)
        : null,
      image_url: imageUrl || null,
      created_at: nowIso(),
    };
    db.chat_messages.push(message);
    return message;
  });
}

export function updateChatMessageImageUrl(messageId: string, imageUrl: string): LocalChatMessageRecord | null {
  return withDb((db) => {
    const msg = db.chat_messages.find((m) => m.id === messageId);
    if (!msg) return null;
    msg.image_url = imageUrl;
    return msg;
  });
}

export function patchChatMessage(messageId: string, updates: Partial<Pick<LocalChatMessageRecord, "content" | "image_url">>): LocalChatMessageRecord | null {
  return withDb((db) => {
    const msg = db.chat_messages.find((m) => m.id === messageId);
    if (!msg) return null;
    if (updates.content !== undefined) msg.content = updates.content;
    if (updates.image_url !== undefined) msg.image_url = updates.image_url;
    return msg;
  });
}

export function listCanvasBlocks(
  userId: string | null,
  projectId?: string | null,
): LocalCanvasBlockRecord[] {
  const db = readDb();
  let rows = db.canvas_blocks.filter((row) => row.user_id === userId);
  if (projectId) rows = rows.filter((row) => row.project_id === projectId);
  return [...rows].sort((a, b) => {
    const at = new Date(a.updated_at || a.created_at || 0).getTime();
    const bt = new Date(b.updated_at || b.created_at || 0).getTime();
    return bt - at;
  });
}

export function getCanvasBlockById(
  id: string,
  userId: string | null,
): LocalCanvasBlockRecord | null {
  const db = readDb();
  return db.canvas_blocks.find((row) => row.id === id && row.user_id === userId) || null;
}

export function createCanvasBlock(
  input: Partial<LocalCanvasBlockRecord> & { user_id: string | null; project_id: string | null },
): LocalCanvasBlockRecord {
  return withDb((db) => {
    const now = nowIso();
    const row: LocalCanvasBlockRecord = {
      id: input.id || randomUUID(),
      project_id: input.project_id ?? null,
      user_id: input.user_id ?? null,
      name: (input.name || "画板").trim() || "画板",
      color: input.color || "#3b82f6",
      canvas_x: Math.round(input.canvas_x ?? 80),
      canvas_y: Math.round(input.canvas_y ?? 80),
      canvas_width: Math.max(320, Math.round(input.canvas_width ?? 960)),
      canvas_height: Math.max(220, Math.round(input.canvas_height ?? 600)),
      image_scale: Math.max(0.4, Math.min(2.2, Number(input.image_scale ?? 1) || 1)),
      sort_mode: (input.sort_mode as LocalCanvasBlockRecord["sort_mode"]) || "compact",
      padding: Math.max(8, Math.round(input.padding ?? 20)),
      locked: Boolean(input.locked),
      created_at: now,
      updated_at: now,
    };
    db.canvas_blocks.push(row);
    return row;
  });
}

export function updateCanvasBlock(
  id: string,
  userId: string | null,
  updates: Partial<LocalCanvasBlockRecord>,
): LocalCanvasBlockRecord | null {
  return withDb((db) => {
    const row = db.canvas_blocks.find((item) => item.id === id && item.user_id === userId);
    if (!row) return null;
    if (updates.name !== undefined) row.name = updates.name.trim() || row.name;
    if (updates.color !== undefined) row.color = updates.color || row.color;
    if (updates.canvas_x !== undefined) row.canvas_x = Math.round(updates.canvas_x);
    if (updates.canvas_y !== undefined) row.canvas_y = Math.round(updates.canvas_y);
    if (updates.canvas_width !== undefined) row.canvas_width = Math.max(320, Math.round(updates.canvas_width));
    if (updates.canvas_height !== undefined) row.canvas_height = Math.max(220, Math.round(updates.canvas_height));
    if (updates.image_scale !== undefined) {
      const nextScale = Number(updates.image_scale);
      if (Number.isFinite(nextScale)) {
        row.image_scale = Math.max(0.4, Math.min(2.2, nextScale));
      }
    }
    if (updates.sort_mode !== undefined) row.sort_mode = updates.sort_mode;
    if (updates.padding !== undefined) row.padding = Math.max(8, Math.round(updates.padding));
    if (updates.locked !== undefined) row.locked = Boolean(updates.locked);
    row.updated_at = nowIso();
    return row;
  });
}

export function deleteCanvasBlock(
  id: string,
  userId: string | null,
): boolean {
  return withDb((db) => {
    const idx = db.canvas_blocks.findIndex((item) => item.id === id && item.user_id === userId);
    if (idx < 0) return false;
    db.canvas_blocks.splice(idx, 1);
    for (const image of db.image_records) {
      if (image.user_id !== userId) continue;
      if (image.canvas_block_id === id) {
        image.canvas_block_id = null;
        image.block_order = 0;
        image.updated_at = nowIso();
      }
    }
    return true;
  });
}

export function listImageRecords(
  userId: string | null,
  options?: {
    projectId?: string | null;
    includeDeleted?: boolean;
    page?: number;
    pageSize?: number;
  },
): { records: LocalImageRecord[]; total: number } {
  const includeDeleted = options?.includeDeleted ?? false;
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.max(1, options?.pageSize ?? 50);
  const projectId = options?.projectId ?? null;

  const db = readDb();
  let records = db.image_records.filter((r) => r.user_id === userId);
  if (projectId) records = records.filter((r) => r.project_id === projectId);
  if (!includeDeleted) records = records.filter((r) => !r.deleted_at);
  records = sortByDateDesc(records);
  const total = records.length;
  const paged = records.slice((page - 1) * pageSize, page * pageSize);
  return { records: paged, total };
}

export function getImageRecordById(id: string, userId?: string | null): LocalImageRecord | null {
  const uid = safeUserId(userId);
  const db = readDb();
  return db.image_records.find((r) => r.id === id && r.user_id === uid) || null;
}

export function createImageRecord(
  input: Partial<LocalImageRecord> & Pick<LocalImageRecord, "prompt" | "user_id">,
): LocalImageRecord {
  return withDb((db) => {
    const now = nowIso();
    const record: LocalImageRecord = {
      id: input.id || randomUUID(),
      project_id: input.project_id ?? null,
      user_id: input.user_id ?? null,
      prompt: input.prompt,
      image_url: input.image_url || "",
      image_key: input.image_key ?? null,
      reference_images: input.reference_images ?? null,
      canvas_block_id: input.canvas_block_id ?? null,
      block_order: Math.round(input.block_order ?? 0),
      canvas_x: Math.round(input.canvas_x ?? 40),
      canvas_y: Math.round(input.canvas_y ?? 40),
      canvas_width: Math.round(input.canvas_width ?? 320),
      canvas_height: Math.round(input.canvas_height ?? 320),
      size: input.size || "1:1",
      model: input.model || "gpt-image-2",
      status: input.status || "pending",
      is_favorite: input.is_favorite ?? false,
      deleted_at: input.deleted_at ?? null,
      edited_image_key: input.edited_image_key ?? null,
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    db.image_records.push(record);
    return record;
  });
}

export function upsertImageRecord(input: LocalImageRecord): LocalImageRecord {
  return withDb((db) => {
    const normalized: LocalImageRecord = {
      ...input,
      canvas_block_id: input.canvas_block_id ?? null,
      block_order: Math.round(input.block_order ?? 0),
    };
    const idx = db.image_records.findIndex((r) => r.id === normalized.id && r.user_id === normalized.user_id);
    if (idx >= 0) {
      db.image_records[idx] = { ...db.image_records[idx], ...normalized, updated_at: nowIso() };
      return db.image_records[idx];
    }
    db.image_records.push(normalized);
    return normalized;
  });
}

export function updateImageRecord(
  id: string,
  userId: string | null,
  updates: Partial<LocalImageRecord>,
): LocalImageRecord | null {
  return withDb((db) => {
    const record = db.image_records.find((r) => r.id === id && r.user_id === userId);
    if (!record) return null;
    if (updates.prompt !== undefined) record.prompt = updates.prompt;
    if (updates.image_url !== undefined) record.image_url = updates.image_url;
    if (updates.image_key !== undefined) record.image_key = updates.image_key;
    if (updates.reference_images !== undefined) record.reference_images = updates.reference_images;
    if (updates.canvas_block_id !== undefined) record.canvas_block_id = updates.canvas_block_id;
    if (updates.block_order !== undefined) record.block_order = Math.round(updates.block_order ?? 0);
    if (updates.canvas_x !== undefined) record.canvas_x = Math.round(updates.canvas_x);
    if (updates.canvas_y !== undefined) record.canvas_y = Math.round(updates.canvas_y);
    if (updates.canvas_width !== undefined) record.canvas_width = Math.round(updates.canvas_width);
    if (updates.canvas_height !== undefined) record.canvas_height = Math.round(updates.canvas_height);
    if (updates.size !== undefined) record.size = updates.size;
    if (updates.model !== undefined) record.model = updates.model;
    if (updates.status !== undefined) record.status = updates.status;
    if (updates.is_favorite !== undefined) record.is_favorite = updates.is_favorite;
    if (updates.project_id !== undefined) record.project_id = updates.project_id;
    if (updates.deleted_at !== undefined) record.deleted_at = updates.deleted_at;
    if (updates.edited_image_key !== undefined) record.edited_image_key = updates.edited_image_key;
    record.updated_at = nowIso();
    return record;
  });
}

export function softDeleteImageRecord(id: string, userId: string | null): LocalImageRecord | null {
  return updateImageRecord(id, userId, { deleted_at: nowIso() });
}

export function restoreImageRecord(id: string, userId: string | null): LocalImageRecord | null {
  return updateImageRecord(id, userId, { deleted_at: null });
}

export function hardDeleteImageRecord(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const idx = db.image_records.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx < 0) return false;
    const record = db.image_records[idx];
    db.image_records.splice(idx, 1);
    db.image_tags = db.image_tags.filter((tag) => tag.image_id !== record.id);
    deleteLocalFileByKeyIfUnused(db, record.image_key, { imageRecordId: record.id });
    deleteLocalFileByKeyIfUnused(db, record.edited_image_key, { imageRecordId: record.id });
    return true;
  });
}

export function listImageTagsForImage(imageId: string, userId: string | null): LocalImageTagRecord[] | null {
  const db = readDb();
  const image = db.image_records.find((r) => r.id === imageId && r.user_id === userId && !r.deleted_at);
  if (!image) return null;
  return db.image_tags
    .filter((tag) => tag.image_id === imageId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function listImageTagSummary(
  userId: string | null,
  projectId?: string | null,
): { tags: Array<{ tag: string; count: number }>; imageTagMap: Record<string, string[]> } {
  const db = readDb();
  const allowedImageIds = new Set(
    db.image_records
      .filter((r) => r.user_id === userId && !r.deleted_at && (!projectId || r.project_id === projectId))
      .map((r) => r.id),
  );

  const tagCounts: Record<string, number> = {};
  const imageTagMap: Record<string, string[]> = {};
  for (const row of db.image_tags) {
    if (!allowedImageIds.has(row.image_id)) continue;
    tagCounts[row.tag] = (tagCounts[row.tag] || 0) + 1;
    if (!imageTagMap[row.image_id]) imageTagMap[row.image_id] = [];
    imageTagMap[row.image_id].push(row.tag);
  }

  const tags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return { tags, imageTagMap };
}

export function createImageTag(
  userId: string | null,
  imageId: string,
  tag: string,
): { tag: LocalImageTagRecord | null; status: "created" | "duplicate" | "forbidden" } {
  const normalizedTag = tag.trim();
  if (!normalizedTag) return { tag: null, status: "forbidden" };

  return withDb((db) => {
    const image = db.image_records.find((r) => r.id === imageId && r.user_id === userId && !r.deleted_at);
    if (!image) return { tag: null, status: "forbidden" as const };

    const existing = db.image_tags.find((row) => row.image_id === imageId && row.tag === normalizedTag);
    if (existing) return { tag: existing, status: "duplicate" as const };

    const record: LocalImageTagRecord = {
      id: randomUUID(),
      user_id: userId,
      image_id: imageId,
      tag: normalizedTag,
      created_at: nowIso(),
    };
    db.image_tags.push(record);
    return { tag: record, status: "created" as const };
  });
}

export function deleteImageTagById(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const tagRecord = db.image_tags.find((tag) => tag.id === id);
    if (!tagRecord) return false;
    const image = db.image_records.find((r) => r.id === tagRecord.image_id && r.user_id === userId);
    if (!image) return false;
    db.image_tags = db.image_tags.filter((tag) => tag.id !== id);
    return true;
  });
}

export function deleteImageTagByImageAndTag(imageId: string, tag: string, userId: string | null): boolean {
  return withDb((db) => {
    const image = db.image_records.find((r) => r.id === imageId && r.user_id === userId);
    if (!image) return false;
    const normalizedTag = tag.trim();
    const before = db.image_tags.length;
    db.image_tags = db.image_tags.filter((row) => !(row.image_id === imageId && row.tag === normalizedTag));
    return db.image_tags.length < before;
  });
}

export function listArchivedImages(
  userId: string | null,
  options?: { projectId?: string | null; folderId?: string | null },
): LocalArchivedImageRecord[] {
  const db = readDb();
  let records = db.archived_images.filter((r) => r.user_id === userId);
  if (options?.projectId) records = records.filter((r) => r.project_id === options.projectId);
  if (options?.folderId !== undefined) {
    records = records.filter((r) => String(r.folder_id || "") === String(options.folderId || ""));
  }
  return sortByDateDesc(records);
}

export async function createArchivedImageRecord(
  input: Partial<LocalArchivedImageRecord> &
    Pick<LocalArchivedImageRecord, "project_id" | "user_id" | "image_url" | "prompt">,
): Promise<LocalArchivedImageRecord> {
  const duplicated = await duplicateArchivedImageSource({
    imageUrl: input.image_url,
    imageKey: input.image_key ?? null,
    fileNameHint: `archived_${Date.now()}.png`,
  });

  return withDb((db) => {
    const now = nowIso();
    const resolvedImageUrl = input.image_url || "";
    const record: LocalArchivedImageRecord = {
      id: input.id || randomUUID(),
      project_id: input.project_id ?? null,
      user_id: input.user_id ?? null,
      original_image_id: input.original_image_id ?? null,
      folder_id: input.folder_id ?? null,
      prompt: input.prompt || "",
      original_prompt: input.original_prompt || "",
      image_url: duplicated?.url || resolvedImageUrl,
      image_key: duplicated?.key || null,
      model: input.model || "",
      size: input.size || "1:1",
      tags: input.tags || "",
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    db.archived_images.push(record);
    return record;
  });
}

export function updateArchivedImageRecord(
  id: string,
  userId: string | null,
  updates: Partial<LocalArchivedImageRecord>,
): LocalArchivedImageRecord | null {
  return withDb((db) => {
    const record = db.archived_images.find((r) => r.id === id && r.user_id === userId);
    if (!record) return null;
    if (updates.project_id !== undefined) record.project_id = updates.project_id;
    if (updates.original_image_id !== undefined) record.original_image_id = updates.original_image_id;
    if (updates.folder_id !== undefined) record.folder_id = updates.folder_id;
    if (updates.prompt !== undefined) record.prompt = updates.prompt;
    if (updates.original_prompt !== undefined) record.original_prompt = updates.original_prompt;
    if (updates.image_url !== undefined) record.image_url = updates.image_url;
    if (updates.image_key !== undefined) record.image_key = updates.image_key;
    if (updates.model !== undefined) record.model = updates.model;
    if (updates.size !== undefined) record.size = updates.size;
    if (updates.tags !== undefined) record.tags = updates.tags;
    record.updated_at = nowIso();
    return record;
  });
}

export function deleteArchivedImageRecord(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const idx = db.archived_images.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx < 0) return false;
    const record = db.archived_images[idx];
    db.archived_images.splice(idx, 1);
    deleteLocalFileByKeyIfUnused(db, record.image_key, { archivedImageId: record.id });
    return true;
  });
}

export function listArchivedFolders(userId: string | null): LocalArchivedFolderRecord[] {
  const db = readDb();
  return db.archived_folders
    .filter((f) => f.user_id === userId)
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

export function createArchivedFolderRecord(
  userId: string | null,
  input: Partial<LocalArchivedFolderRecord> & Pick<LocalArchivedFolderRecord, "name">,
): LocalArchivedFolderRecord {
  return withDb((db) => {
    const folders = db.archived_folders.filter((f) => f.user_id === userId);
    const nextOrder = (folders[folders.length - 1]?.sort_order || 0) + 1;
    const now = nowIso();
    const folder: LocalArchivedFolderRecord = {
      id: input.id || randomUUID(),
      user_id: userId,
      name: input.name || "新建文件夹",
      parent_id: input.parent_id ?? null,
      sort_order: input.sort_order ?? nextOrder,
      color: input.color || "#6366f1",
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    db.archived_folders.push(folder);
    return folder;
  });
}

export function updateArchivedFolderRecord(
  id: string,
  userId: string | null,
  updates: Partial<LocalArchivedFolderRecord>,
): LocalArchivedFolderRecord | null {
  return withDb((db) => {
    const folder = db.archived_folders.find((f) => f.id === id && f.user_id === userId);
    if (!folder) return null;
    if (updates.name !== undefined) folder.name = updates.name;
    if (updates.parent_id !== undefined) folder.parent_id = updates.parent_id;
    if (updates.sort_order !== undefined) folder.sort_order = updates.sort_order;
    if (updates.color !== undefined) folder.color = updates.color;
    folder.updated_at = nowIso();
    return folder;
  });
}

export function deleteArchivedFolderRecord(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const exists = db.archived_folders.some((f) => f.id === id && f.user_id === userId);
    if (!exists) return false;

    const toDelete = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of db.archived_folders) {
        if (folder.user_id !== userId) continue;
        if (folder.parent_id && toDelete.has(folder.parent_id) && !toDelete.has(folder.id)) {
          toDelete.add(folder.id);
          changed = true;
        }
      }
    }

    for (const record of db.archived_images) {
      if (record.user_id !== userId) continue;
      if (record.folder_id && toDelete.has(record.folder_id)) {
        record.folder_id = null;
        record.updated_at = nowIso();
      }
    }

    db.archived_folders = db.archived_folders.filter((f) => !(f.user_id === userId && toDelete.has(f.id)));
    return true;
  });
}

export function hardDeleteTrashedBefore(userId: string | null, olderThanDays: number): number {
  return withDb((db) => {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const toDelete = db.image_records.filter((r) => {
      if (r.user_id !== userId || !r.deleted_at) return false;
      return new Date(r.deleted_at).getTime() < cutoff;
    });

    const before = db.image_records.length;
    const idSet = new Set(toDelete.map((r) => r.id));
    db.image_records = db.image_records.filter((r) => !idSet.has(r.id));
    const keysToDelete = new Set<string>();
    for (const record of toDelete) {
      if (record.image_key) keysToDelete.add(record.image_key);
      if (record.edited_image_key) keysToDelete.add(record.edited_image_key);
    }
    for (const key of keysToDelete) {
      deleteLocalFileByKeyIfUnused(db, key);
    }
    return before - db.image_records.length;
  });
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function listDesignAssets(
  userId: string | null,
  options?: { projectId?: string | null; kind?: string | null; ids?: string[] },
): LocalDesignAssetRecord[] {
  const db = readDb();
  const idSet = options?.ids?.length ? new Set(options.ids) : null;
  let records = db.design_assets.filter((r) => r.user_id === userId);
  if (options?.projectId) records = records.filter((r) => r.project_id === options.projectId);
  if (options?.kind) records = records.filter((r) => r.kind === options.kind);
  if (idSet) records = records.filter((r) => idSet.has(r.id));
  return sortByDateDesc(records);
}

export function getDesignAssetById(id: string, userId: string | null): LocalDesignAssetRecord | null {
  const db = readDb();
  return db.design_assets.find((r) => r.id === id && r.user_id === userId) || null;
}

export function createDesignAsset(
  userId: string | null,
  input: Partial<LocalDesignAssetRecord> & Pick<LocalDesignAssetRecord, "url">,
): LocalDesignAssetRecord {
  return withDb((db) => {
    const now = nowIso();
    const record: LocalDesignAssetRecord = {
      id: input.id || randomUUID(),
      project_id: input.project_id ?? null,
      user_id: userId,
      kind: input.kind || "image",
      url: input.url,
      key: input.key ?? null,
      width: Math.round(input.width ?? 0),
      height: Math.round(input.height ?? 0),
      mime_type: input.mime_type || "image/png",
      metadata: normalizeMetadata(input.metadata),
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    db.design_assets.push(record);
    return record;
  });
}

export function updateDesignAsset(
  id: string,
  userId: string | null,
  updates: Partial<LocalDesignAssetRecord>,
): LocalDesignAssetRecord | null {
  return withDb((db) => {
    const record = db.design_assets.find((r) => r.id === id && r.user_id === userId);
    if (!record) return null;
    if (updates.project_id !== undefined) record.project_id = updates.project_id;
    if (updates.kind !== undefined) record.kind = updates.kind;
    if (updates.url !== undefined) record.url = updates.url;
    if (updates.key !== undefined) record.key = updates.key;
    if (updates.width !== undefined) record.width = Math.round(updates.width);
    if (updates.height !== undefined) record.height = Math.round(updates.height);
    if (updates.mime_type !== undefined) record.mime_type = updates.mime_type;
    if (updates.metadata !== undefined) record.metadata = normalizeMetadata(updates.metadata);
    record.updated_at = nowIso();
    return record;
  });
}

export function deleteDesignAsset(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const idx = db.design_assets.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx < 0) return false;
    const asset = db.design_assets[idx];
    db.design_layers = db.design_layers.map((layer) => (
      layer.asset_id === id && layer.user_id === userId ? { ...layer, asset_id: null, updated_at: nowIso() } : layer
    ));
    db.asset_versions = db.asset_versions.filter((version) => !(version.asset_id === id && version.user_id === userId));
    db.design_assets.splice(idx, 1);
    deleteLocalFileByKeyIfUnused(db, asset.key, { designAssetId: asset.id });
    return true;
  });
}

export function listAssetVersions(
  userId: string | null,
  options?: { assetId?: string | null; parentAssetId?: string | null; operationId?: string | null },
): LocalAssetVersionRecord[] {
  const db = readDb();
  let records = db.asset_versions.filter((r) => r.user_id === userId);
  if (options?.assetId) records = records.filter((r) => r.asset_id === options.assetId);
  if (options?.parentAssetId) records = records.filter((r) => r.parent_asset_id === options.parentAssetId);
  if (options?.operationId) records = records.filter((r) => r.operation_id === options.operationId);
  return records.sort((a, b) => (b.version_index || 0) - (a.version_index || 0));
}

export function createAssetVersion(
  userId: string | null,
  input: Partial<LocalAssetVersionRecord> & Pick<LocalAssetVersionRecord, "asset_id" | "url">,
): LocalAssetVersionRecord {
  return withDb((db) => {
    const nextIndex = db.asset_versions
      .filter((version) => version.asset_id === input.asset_id && version.user_id === userId)
      .reduce((max, version) => Math.max(max, version.version_index || 0), 0) + 1;
    const record: LocalAssetVersionRecord = {
      id: input.id || randomUUID(),
      asset_id: input.asset_id,
      parent_asset_id: input.parent_asset_id ?? null,
      operation_id: input.operation_id ?? null,
      user_id: userId,
      version_index: input.version_index ?? nextIndex,
      label: input.label || `版本 ${nextIndex}`,
      url: input.url,
      key: input.key ?? null,
      metadata: normalizeMetadata(input.metadata),
      created_at: input.created_at || nowIso(),
    };
    db.asset_versions.push(record);
    return record;
  });
}

export function deleteAssetVersion(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const idx = db.asset_versions.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx < 0) return false;
    const version = db.asset_versions[idx];
    db.asset_versions.splice(idx, 1);
    deleteLocalFileByKeyIfUnused(db, version.key, { assetVersionId: version.id });
    return true;
  });
}

export function listDesignLayers(
  userId: string | null,
  options?: { projectId?: string | null; documentId?: string | null; assetId?: string | null },
): LocalDesignLayerRecord[] {
  const db = readDb();
  let records = db.design_layers.filter((r) => r.user_id === userId);
  if (options?.projectId) records = records.filter((r) => r.project_id === options.projectId);
  if (options?.documentId) records = records.filter((r) => r.document_id === options.documentId);
  if (options?.assetId) records = records.filter((r) => r.asset_id === options.assetId);
  return records.sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
}

export function createDesignLayer(
  userId: string | null,
  input: Partial<LocalDesignLayerRecord>,
): LocalDesignLayerRecord {
  return withDb((db) => {
    const now = nowIso();
    const record: LocalDesignLayerRecord = {
      id: input.id || randomUUID(),
      document_id: input.document_id ?? null,
      project_id: input.project_id ?? null,
      user_id: userId,
      asset_id: input.asset_id ?? null,
      type: input.type || "image",
      name: input.name || "图层",
      x: Math.round(input.x ?? 0),
      y: Math.round(input.y ?? 0),
      width: Math.round(input.width ?? 0),
      height: Math.round(input.height ?? 0),
      opacity: input.opacity ?? 1,
      visible: input.visible ?? true,
      locked: input.locked ?? false,
      z_index: Math.round(input.z_index ?? 0),
      props: normalizeMetadata(input.props),
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    db.design_layers.push(record);
    return record;
  });
}

export function updateDesignLayer(
  id: string,
  userId: string | null,
  updates: Partial<LocalDesignLayerRecord>,
): LocalDesignLayerRecord | null {
  return withDb((db) => {
    const record = db.design_layers.find((r) => r.id === id && r.user_id === userId);
    if (!record) return null;
    if (updates.document_id !== undefined) record.document_id = updates.document_id;
    if (updates.project_id !== undefined) record.project_id = updates.project_id;
    if (updates.asset_id !== undefined) record.asset_id = updates.asset_id;
    if (updates.type !== undefined) record.type = updates.type;
    if (updates.name !== undefined) record.name = updates.name;
    if (updates.x !== undefined) record.x = Math.round(updates.x);
    if (updates.y !== undefined) record.y = Math.round(updates.y);
    if (updates.width !== undefined) record.width = Math.round(updates.width);
    if (updates.height !== undefined) record.height = Math.round(updates.height);
    if (updates.opacity !== undefined) record.opacity = updates.opacity;
    if (updates.visible !== undefined) record.visible = updates.visible;
    if (updates.locked !== undefined) record.locked = updates.locked;
    if (updates.z_index !== undefined) record.z_index = Math.round(updates.z_index);
    if (updates.props !== undefined) record.props = normalizeMetadata(updates.props);
    record.updated_at = nowIso();
    return record;
  });
}

export function deleteDesignLayer(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const before = db.design_layers.length;
    db.design_layers = db.design_layers.filter((r) => !(r.id === id && r.user_id === userId));
    return db.design_layers.length < before;
  });
}

export function listDesignOperations(
  userId: string | null,
  options?: {
    projectId?: string | null;
    documentId?: string | null;
    status?: DesignOperationStatus | null;
    assetId?: string | null;
  },
): LocalDesignOperationRecord[] {
  const db = readDb();
  let records = db.design_operations.filter((r) => r.user_id === userId);
  if (options?.projectId) records = records.filter((r) => r.project_id === options.projectId);
  if (options?.documentId) records = records.filter((r) => r.document_id === options.documentId);
  if (options?.status) records = records.filter((r) => r.status === options.status);
  if (options?.assetId) {
    records = records.filter((r) => (
      r.mask_asset_id === options.assetId ||
      r.input_asset_ids.includes(options.assetId || "") ||
      r.output_asset_ids.includes(options.assetId || "")
    ));
  }
  return sortByDateDesc(records);
}

export function getDesignOperationById(id: string, userId: string | null): LocalDesignOperationRecord | null {
  const db = readDb();
  return db.design_operations.find((r) => r.id === id && r.user_id === userId) || null;
}

export function createDesignOperation(
  userId: string | null,
  input: Partial<LocalDesignOperationRecord> & Pick<LocalDesignOperationRecord, "kind">,
): LocalDesignOperationRecord {
  return withDb((db) => {
    const now = nowIso();
    const status = input.status || "queued";
    const record: LocalDesignOperationRecord = {
      id: input.id || randomUUID(),
      document_id: input.document_id ?? null,
      project_id: input.project_id ?? null,
      user_id: userId,
      input_asset_ids: normalizeStringArray(input.input_asset_ids),
      output_asset_ids: normalizeStringArray(input.output_asset_ids),
      kind: input.kind,
      prompt: input.prompt || "",
      mask_asset_id: input.mask_asset_id ?? null,
      provider: input.provider || "",
      model: input.model || "",
      params: normalizeMetadata(input.params),
      status,
      error: input.error ?? null,
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
      completed_at: input.completed_at || (status === "completed" || status === "failed" || status === "cancelled" ? now : null),
    };
    db.design_operations.push(record);
    return record;
  });
}

export function updateDesignOperation(
  id: string,
  userId: string | null,
  updates: Partial<LocalDesignOperationRecord>,
): LocalDesignOperationRecord | null {
  return withDb((db) => {
    const record = db.design_operations.find((r) => r.id === id && r.user_id === userId);
    if (!record) return null;
    if (updates.document_id !== undefined) record.document_id = updates.document_id;
    if (updates.project_id !== undefined) record.project_id = updates.project_id;
    if (updates.input_asset_ids !== undefined) record.input_asset_ids = normalizeStringArray(updates.input_asset_ids);
    if (updates.output_asset_ids !== undefined) record.output_asset_ids = normalizeStringArray(updates.output_asset_ids);
    if (updates.kind !== undefined) record.kind = updates.kind;
    if (updates.prompt !== undefined) record.prompt = updates.prompt;
    if (updates.mask_asset_id !== undefined) record.mask_asset_id = updates.mask_asset_id;
    if (updates.provider !== undefined) record.provider = updates.provider;
    if (updates.model !== undefined) record.model = updates.model;
    if (updates.params !== undefined) record.params = normalizeMetadata(updates.params);
    if (updates.status !== undefined) record.status = updates.status;
    if (updates.error !== undefined) record.error = updates.error;
    if (updates.completed_at !== undefined) {
      record.completed_at = updates.completed_at;
    } else if (updates.status === "completed" || updates.status === "failed" || updates.status === "cancelled") {
      record.completed_at = nowIso();
    }
    record.updated_at = nowIso();
    return record;
  });
}

export function deleteDesignOperation(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const before = db.design_operations.length;
    db.design_operations = db.design_operations.filter((r) => !(r.id === id && r.user_id === userId));
    return db.design_operations.length < before;
  });
}

export function listAssetIndexEntries(
  userId: string | null,
  options?: {
    projectId?: string | null;
    sourceType?: "design_asset" | "image_record" | null;
    sourceId?: string | null;
    keyword?: string | null;
    limit?: number;
  },
): LocalAssetIndexEntryRecord[] {
  const db = readDb();
  let records = db.asset_index_entries.filter((r) => r.user_id === userId);
  if (options?.projectId) records = records.filter((r) => r.project_id === options.projectId);
  if (options?.sourceType) records = records.filter((r) => r.source_type === options.sourceType);
  if (options?.sourceId) records = records.filter((r) => r.source_id === options.sourceId);
  if (options?.keyword) {
    const q = options.keyword.trim().toLowerCase();
    if (q) {
      records = records.filter((r) => {
        const haystacks = [
          r.prompt,
          r.model,
          r.size,
          r.caption,
          r.ocr_text,
          r.dominant_color || "",
          ...(Array.isArray(r.tags) ? r.tags : []),
          ...(Array.isArray(r.keywords) ? r.keywords : []),
        ];
        return haystacks.some((item) => String(item || "").toLowerCase().includes(q));
      });
    }
  }
  const sorted = sortByDateDesc(records);
  if (options?.limit && options.limit > 0) return sorted.slice(0, options.limit);
  return sorted;
}

export function getAssetIndexEntryBySource(
  userId: string | null,
  sourceType: "design_asset" | "image_record",
  sourceId: string,
): LocalAssetIndexEntryRecord | null {
  const db = readDb();
  return db.asset_index_entries.find((r) => (
    r.user_id === userId &&
    r.source_type === sourceType &&
    r.source_id === sourceId
  )) || null;
}

export function upsertAssetIndexEntry(
  userId: string | null,
  input: Partial<LocalAssetIndexEntryRecord> & Pick<LocalAssetIndexEntryRecord, "source_type" | "source_id" | "url">,
): LocalAssetIndexEntryRecord {
  return withDb((db) => {
    const existingIndex = db.asset_index_entries.findIndex((r) => (
      r.user_id === userId &&
      r.source_type === input.source_type &&
      r.source_id === input.source_id
    ));
    const now = nowIso();
    const normalized: LocalAssetIndexEntryRecord = {
      id: existingIndex >= 0 ? db.asset_index_entries[existingIndex].id : (input.id || randomUUID()),
      user_id: userId,
      project_id: input.project_id ?? null,
      source_type: input.source_type,
      source_id: input.source_id,
      kind: input.kind || "image",
      url: input.url,
      key: input.key ?? null,
      width: Math.round(input.width ?? 0),
      height: Math.round(input.height ?? 0),
      prompt: input.prompt || "",
      model: input.model || "",
      size: input.size || "",
      tags: normalizeStringArray(input.tags),
      caption: input.caption || "",
      ocr_text: input.ocr_text || "",
      dominant_color: input.dominant_color ?? null,
      keywords: normalizeStringArray(input.keywords),
      metadata: normalizeMetadata(input.metadata),
      created_at: existingIndex >= 0 ? db.asset_index_entries[existingIndex].created_at : (input.created_at || now),
      updated_at: now,
    };
    if (existingIndex >= 0) {
      db.asset_index_entries[existingIndex] = normalized;
      return normalized;
    }
    db.asset_index_entries.push(normalized);
    return normalized;
  });
}

export function listAssetIndexJobs(
  userId: string | null,
  options?: { projectId?: string | null; status?: string | null; limit?: number },
): LocalAssetIndexJobRecord[] {
  const db = readDb();
  let records = db.asset_index_jobs.filter((r) => r.user_id === userId);
  if (options?.projectId) records = records.filter((r) => r.project_id === options.projectId);
  if (options?.status) records = records.filter((r) => r.status === options.status);
  const sorted = sortByDateDesc(records);
  if (options?.limit && options.limit > 0) return sorted.slice(0, options.limit);
  return sorted;
}

export function getAssetIndexJobById(id: string, userId: string | null): LocalAssetIndexJobRecord | null {
  const db = readDb();
  return db.asset_index_jobs.find((r) => r.id === id && r.user_id === userId) || null;
}

export function createAssetIndexJob(
  userId: string | null,
  input: Partial<LocalAssetIndexJobRecord> & Pick<LocalAssetIndexJobRecord, "mode">,
): LocalAssetIndexJobRecord {
  return withDb((db) => {
    const now = nowIso();
    const status = input.status || "queued";
    const record: LocalAssetIndexJobRecord = {
      id: input.id || randomUUID(),
      user_id: userId,
      project_id: input.project_id ?? null,
      mode: input.mode,
      status,
      source_count: Math.max(0, Math.round(input.source_count ?? 0)),
      indexed_count: Math.max(0, Math.round(input.indexed_count ?? 0)),
      failed_count: Math.max(0, Math.round(input.failed_count ?? 0)),
      params: normalizeMetadata(input.params),
      stats: normalizeMetadata(input.stats),
      error: input.error ?? null,
      error_code: input.error_code ?? null,
      retryable: input.retryable ?? null,
      started_at: input.started_at ?? (status === "running" ? now : null),
      completed_at: input.completed_at ?? (
        status === "completed" || status === "failed" || status === "cancelled" ? now : null
      ),
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    db.asset_index_jobs.push(record);
    return record;
  });
}

export function updateAssetIndexJob(
  id: string,
  userId: string | null,
  updates: Partial<LocalAssetIndexJobRecord>,
): LocalAssetIndexJobRecord | null {
  return withDb((db) => {
    const record = db.asset_index_jobs.find((r) => r.id === id && r.user_id === userId);
    if (!record) return null;
    if (updates.project_id !== undefined) record.project_id = updates.project_id;
    if (updates.mode !== undefined) record.mode = updates.mode;
    if (updates.status !== undefined) {
      record.status = updates.status;
      if (updates.status === "running" && !record.started_at) {
        record.started_at = nowIso();
      }
      if (updates.status === "completed" || updates.status === "failed" || updates.status === "cancelled") {
        record.completed_at = updates.completed_at ?? nowIso();
      }
    }
    if (updates.source_count !== undefined) record.source_count = Math.max(0, Math.round(updates.source_count));
    if (updates.indexed_count !== undefined) record.indexed_count = Math.max(0, Math.round(updates.indexed_count));
    if (updates.failed_count !== undefined) record.failed_count = Math.max(0, Math.round(updates.failed_count));
    if (updates.params !== undefined) record.params = normalizeMetadata(updates.params);
    if (updates.stats !== undefined) record.stats = normalizeMetadata(updates.stats);
    if (updates.error !== undefined) record.error = updates.error;
    if (updates.error_code !== undefined) record.error_code = updates.error_code;
    if (updates.retryable !== undefined) record.retryable = updates.retryable;
    if (updates.started_at !== undefined) record.started_at = updates.started_at;
    if (updates.completed_at !== undefined) record.completed_at = updates.completed_at;
    record.updated_at = nowIso();
    return record;
  });
}

export function listReferenceImages(userId: string | null, projectId?: string | null): LocalReferenceImageRecord[] {
  const db = readDb();
  let refs = db.reference_images.filter((r) => r.user_id === userId);
  if (projectId) refs = refs.filter((r) => r.project_id === projectId);
  return refs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function createReferenceImage(
  userId: string | null,
  input: Pick<LocalReferenceImageRecord, "project_id" | "image_url"> & Partial<Pick<LocalReferenceImageRecord, "image_key" | "file_name">>,
): LocalReferenceImageRecord {
  return withDb((db) => {
    const record: LocalReferenceImageRecord = {
      id: randomUUID(),
      user_id: userId,
      project_id: input.project_id ?? null,
      image_url: input.image_url,
      image_key: input.image_key ?? null,
      file_name: input.file_name ?? null,
      created_at: nowIso(),
    };
    db.reference_images.push(record);
    return record;
  });
}

export function deleteReferenceImage(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const idx = db.reference_images.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx < 0) return false;
    const record = db.reference_images[idx];
    db.reference_images.splice(idx, 1);
    deleteLocalFileByKeyIfUnused(db, record.image_key, { referenceImageId: record.id });
    return true;
  });
}

export function listPrompts(userId: string | null, projectId?: string | null): LocalPromptRecord[] {
  const db = readDb();
  let items = db.prompt_library.filter((p) => p.user_id === userId);
  if (projectId) items = items.filter((p) => p.project_id === projectId);
  return sortByDateDesc(items);
}

export function createPrompt(
  userId: string | null,
  input: Pick<LocalPromptRecord, "project_id" | "text"> & Partial<Omit<LocalPromptRecord, "id" | "user_id" | "project_id" | "text" | "created_at">>,
): LocalPromptRecord {
  return withDb((db) => {
    const now = nowIso();
    const record: LocalPromptRecord = {
      id: randomUUID(),
      user_id: userId,
      project_id: input.project_id ?? null,
      text: input.text,
      category: input.category || "general",
      image_url: input.image_url || null,
      name: input.name,
      content: input.content || input.text,
      category_id: input.category_id ?? 0,
      library_id: input.library_id ?? null,
      tags: input.tags || "",
      use_count: input.use_count ?? 0,
      is_hot: input.is_hot ?? 0,
      source: input.source || "",
      atom_ids: input.atom_ids || "",
      model: input.model || "",
      aspect_ratio: input.aspect_ratio || "",
      vars: input.vars || [],
      kind: input.kind || "general",
      created_at: now,
      updated_at: now,
    };
    db.prompt_library.push(record);
    return record;
  });
}

export function updatePrompt(id: string, userId: string | null, updates: Partial<LocalPromptRecord>): LocalPromptRecord | null {
  return withDb((db) => {
    const idx = db.prompt_library.findIndex((p) => p.id === id && p.user_id === userId);
    if (idx < 0) return null;
    db.prompt_library[idx] = {
      ...db.prompt_library[idx],
      ...updates,
      updated_at: nowIso(),
    };
    if (updates.content && !updates.text) db.prompt_library[idx].text = updates.content;
    if (updates.text && !updates.content) db.prompt_library[idx].content = updates.text;
    return db.prompt_library[idx];
  });
}

export function deletePrompt(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const before = db.prompt_library.length;
    db.prompt_library = db.prompt_library.filter((p) => !(p.id === id && p.user_id === userId));
    return db.prompt_library.length < before;
  });
}

export function listSkills(userId: string | null, projectId: string): LocalSkillRecord[] {
  const db = readDb();
  return sortByDateDesc(
    db.custom_skills.filter((s) => s.user_id === userId && s.project_id === projectId),
  );
}

export function createSkill(
  userId: string | null,
  input: Pick<LocalSkillRecord, "project_id" | "name" | "steps"> & Partial<Pick<LocalSkillRecord, "description">>,
): LocalSkillRecord {
  return withDb((db) => {
    const now = nowIso();
    const skill: LocalSkillRecord = {
      id: randomUUID(),
      user_id: userId,
      project_id: input.project_id ?? null,
      name: input.name,
      description: input.description || "",
      steps: input.steps,
      created_at: now,
      updated_at: now,
    };
    db.custom_skills.push(skill);
    return skill;
  });
}

export function updateSkill(
  id: string,
  userId: string | null,
  input: Partial<Pick<LocalSkillRecord, "name" | "description" | "steps">>,
): LocalSkillRecord | null {
  return withDb((db) => {
    const skill = db.custom_skills.find((s) => s.id === id && s.user_id === userId);
    if (!skill) return null;
    if (input.name !== undefined) skill.name = input.name;
    if (input.description !== undefined) skill.description = input.description;
    if (input.steps !== undefined) skill.steps = input.steps;
    skill.updated_at = nowIso();
    return skill;
  });
}

export function deleteSkill(id: string, userId: string | null): boolean {
  return withDb((db) => {
    const before = db.custom_skills.length;
    db.custom_skills = db.custom_skills.filter((s) => !(s.id === id && s.user_id === userId));
    return db.custom_skills.length < before;
  });
}

export function ensureDefaultProjectForUser(userId: string | null): LocalProjectRecord {
  const existing = listProjects(userId);
  if (existing.length > 0) return existing[0];
  return createProject(userId, "默认项目");
}
