import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { readBackupManifest } from "./project-backup-format";
import { S3Config, S3Storage } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import {
  clearLocalProjectArchiveData,
  exportLocalProjectSnapshot,
  getProjectById,
  isLocalBackendEnabled,
  resolveLocalFilePath,
  restoreLocalProjectSnapshot,
  saveBinaryFile,
} from "@/lib/local-backend";
import type {
  ArchiveRecord,
  ProjectArchiveAsset,
  ProjectArchiveAssetReplacement,
  ProjectArchiveManifest,
  ProjectArchiveRestoreOptions,
  ProjectArchiveSnapshot,
} from "@/lib/project-archive-types";

type SourcedAsset = {
  id: string;
  storageKey: string | null;
  originalUrl: string;
  contentType?: string;
  historicalOnly: boolean;
};

export class MissingLocalArchiveAsset extends Error {}

type DownloadedAsset = {
  buffer: Buffer;
  contentType: string;
  ext: string;
};

const ARCHIVE_FORMAT = "huanzon-aistudio-project" as const;
const ARCHIVE_VERSION = 2 as const;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || "0.2.2";

function asRecord(value: unknown): ArchiveRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ArchiveRecord
    : {};
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseUrlArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item));
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item))
      : [];
  } catch {
    return [value];
  }
}

function sha256(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeFileName(value: string, fallback: string): string {
  return (value || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || fallback;
}

function extFromContentType(contentType?: string): string {
  const type = (contentType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("svg")) return "svg";
  if (type.includes("bmp")) return "bmp";
  if (type.includes("avif")) return "avif";
  if (type.includes("png")) return "png";
  return "";
}

function extFromUrl(url: string): string {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const ext = path.extname(clean).replace(".", "").toLowerCase();
    return ext && ext.length <= 8 ? ext : "png";
  } catch {
    return "png";
  }
}

function normalizeAssetUrl(url: string): string {
  return url.trim();
}

function makeUrlAssetId(url: string): string {
  return `url:${sha256(Buffer.from(normalizeAssetUrl(url))).slice(0, 24)}`;
}

function inferMimeType(ext: string): string {
  const clean = ext.toLowerCase();
  if (clean === "jpg" || clean === "jpeg") return "image/jpeg";
  if (clean === "webp") return "image/webp";
  if (clean === "gif") return "image/gif";
  if (clean === "svg") return "image/svg+xml";
  if (clean === "bmp") return "image/bmp";
  if (clean === "avif") return "image/avif";
  return "image/png";
}

async function querySupabaseRows(
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (query: any) => any,
): Promise<ArchiveRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await apply(supabase.from(table).select("*"));
  if (error) throw new Error(`读取 ${table} 失败：${error.message}`);
  return (data || []) as ArchiveRecord[];
}

function collectFolderChain(
  folders: ArchiveRecord[],
  folderId: unknown,
): ArchiveRecord[] {
  const byId = new Map(folders.map((folder) => [asText(folder.id), folder]));
  const chain: ArchiveRecord[] = [];
  let current = asText(folderId);
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    chain.unshift(folder);
    current = asText(folder.parent_id);
  }
  return chain;
}

async function loadSupabaseProjectSnapshot(
  projectId: string,
  userId: string,
): Promise<ProjectArchiveSnapshot> {
  const supabase = getSupabaseClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projectError || !project) throw new Error("项目不存在或无权限");

  const [
    imageRecords,
    canvasBlocks,
    chatMessages,
    referenceImages,
    prompts,
    skills,
    designAssets,
    designLayers,
    designOperations,
    inspirationFolders,
    inspirationItems,
    archivedImages,
    allProjectFolders,
  ] = await Promise.all([
    querySupabaseRows("image_records", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("canvas_blocks", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("chat_messages", (query) => query.eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: true })),
    querySupabaseRows("reference_images", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("prompt_library", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("custom_skills", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("design_assets", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("design_layers", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("design_operations", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("inspiration_folders", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("inspiration_items", (query) => query.eq("project_id", projectId).eq("user_id", userId)),
    querySupabaseRows("archived_images", (query) => query.eq("project_id", projectId).eq("user_id", userId)).catch(() => []),
    querySupabaseRows("project_folders", (query) => query.eq("user_id", userId)),
  ]);

  const imageIds = imageRecords.map((record) => asText(record.id)).filter(Boolean);
  const assetIds = designAssets.map((record) => asText(record.id)).filter(Boolean);
  const [imageTags, assetVersions] = await Promise.all([
    imageIds.length
      ? querySupabaseRows("image_tags", (query) => query.in("image_id", imageIds))
      : Promise.resolve([]),
    assetIds.length
      ? querySupabaseRows("asset_versions", (query) => query.in("asset_id", assetIds).eq("user_id", userId))
      : Promise.resolve([]),
  ]);

  return {
    project: project as ArchiveRecord,
    projectFolders: collectFolderChain(allProjectFolders, project.folder_id),
    imageRecords,
    imageTags,
    canvasBlocks,
    chatMessages,
    referenceImages,
    prompts,
    skills,
    designAssets,
    designLayers,
    designOperations,
    assetVersions,
    inspirationFolders,
    inspirationItems,
    archivedImages,
  };
}

export async function loadProjectSnapshot(
  projectId: string,
  userId: string | null,
): Promise<ProjectArchiveSnapshot> {
  if (!userId) throw new Error("未登录");
  if (isLocalBackendEnabled()) return exportLocalProjectSnapshot(projectId, userId);
  return loadSupabaseProjectSnapshot(projectId, userId);
}

function addSourcedAsset(
  assets: Map<string, SourcedAsset>,
  input: { key?: unknown; url?: unknown; contentType?: unknown; historicalOnly?: boolean },
): void {
  const storageKey = asOptionalText(input.key);
  const originalUrl = asText(input.url).trim();
  if (!storageKey && !originalUrl) return;
  const id = storageKey ? `key:${storageKey}` : makeUrlAssetId(originalUrl);
  const existing = assets.get(id);
  if (existing) {
    existing.historicalOnly &&= input.historicalOnly === true;
    return;
  }
  assets.set(id, {
    id,
    storageKey,
    originalUrl,
    contentType: asOptionalText(input.contentType) || undefined,
    historicalOnly: input.historicalOnly === true,
  });
}

export function collectProjectAssets(snapshot: ProjectArchiveSnapshot): SourcedAsset[] {
  const assets = new Map<string, SourcedAsset>();

  for (const image of snapshot.imageRecords) {
    addSourcedAsset(assets, {
      key: image.image_key,
      url: image.image_url,
      contentType: "image/png",
    });
    addSourcedAsset(assets, { key: image.edited_image_key, url: "" });
    for (const url of parseUrlArray(image.reference_images)) addSourcedAsset(assets, { url, historicalOnly: true });
  }
  for (const reference of snapshot.referenceImages) {
    addSourcedAsset(assets, { key: reference.image_key, url: reference.image_url });
  }
  for (const message of snapshot.chatMessages) {
    addSourcedAsset(assets, { url: message.image_url, historicalOnly: true });
    for (const url of parseUrlArray(message.reference_image_urls)) addSourcedAsset(assets, { url, historicalOnly: true });
  }
  for (const prompt of snapshot.prompts) addSourcedAsset(assets, { url: prompt.image_url });
  for (const asset of snapshot.designAssets) {
    addSourcedAsset(assets, {
      key: asset.key,
      url: asset.url,
      contentType: asset.mime_type,
    });
  }
  for (const version of snapshot.assetVersions) {
    addSourcedAsset(assets, { key: version.key, url: version.url });
  }
  for (const item of snapshot.inspirationItems) {
    addSourcedAsset(assets, { key: item.image_key, url: item.image_url });
  }
  for (const image of snapshot.archivedImages) {
    addSourcedAsset(assets, { key: image.image_key, url: image.image_url });
  }

  return Array.from(assets.values());
}

function dataUrlToBuffer(url: string): DownloadedAsset | null {
  const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const contentType = match[1] || "image/png";
  const base64 = Boolean(match[2]);
  const payload = match[3] || "";
  const buffer = base64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { buffer, contentType, ext: extFromContentType(contentType) };
}

export async function downloadAsset(
  source: SourcedAsset,
  baseUrl: string,
): Promise<DownloadedAsset> {
  if (source.storageKey && isLocalBackendEnabled()) {
    const filePath = resolveLocalFilePath(source.storageKey);
    if (!fs.existsSync(filePath)) throw new MissingLocalArchiveAsset(`项目图片不存在：${source.storageKey}`);
    const buffer = fs.readFileSync(filePath);
    const ext = extFromUrl(filePath);
    return { buffer, contentType: source.contentType || inferMimeType(ext), ext };
  }

  let url = source.originalUrl;
  if (source.storageKey && !isLocalBackendEnabled()) {
    const s3 = new S3Storage(new S3Config());
    url = await s3.generatePresignedUrl({ key: source.storageKey, expireTime: 3600 });
  }
  if (!url) throw new Error("项目资源缺少 URL 和存储 key");

  if (url.startsWith("data:")) {
    const decoded = dataUrlToBuffer(url);
    if (!decoded) throw new Error("项目资源中的 data URL 无效");
    return decoded;
  }

  if (url.startsWith("/api/local-file/")) {
    const key = decodeURIComponent(url.split("/").pop() || "");
    const filePath = resolveLocalFilePath(key);
    if (!fs.existsSync(filePath)) throw new MissingLocalArchiveAsset(`项目图片不存在：${key}`);
    const buffer = fs.readFileSync(filePath);
    const ext = extFromUrl(filePath);
    return { buffer, contentType: inferMimeType(ext), ext };
  }

  const absolute = url.startsWith("/") && baseUrl
    ? new URL(url, baseUrl).toString()
    : url;
  const response = await fetch(absolute, { cache: "no-store" });
  if (!response.ok) throw new Error(`项目资源下载失败 (${response.status})：${absolute}`);
  const contentType = response.headers.get("content-type") || source.contentType || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType, ext: extFromContentType(contentType) || extFromUrl(absolute) };
}

export async function buildProjectArchive(input: {
  projectId: string;
  userId: string | null;
  baseUrl: string;
  onProgress?: (progress: { stage: string; current: number; total: number }) => void;
}): Promise<{ buffer: Buffer; fileName: string; manifest: ProjectArchiveManifest }> {
  const snapshot = await loadProjectSnapshot(input.projectId, input.userId);
  const sources = collectProjectAssets(snapshot);
  input.onProgress?.({ stage: `已读取项目数据，准备处理 ${sources.length} 个资源`, current: 0, total: sources.length });
  const zip = new JSZip();
  const assets: ProjectArchiveAsset[] = [];
  const missingHistoryAssets: NonNullable<ProjectArchiveManifest["missingHistoryAssets"]> = [];

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    let downloaded: DownloadedAsset;
    try {
      downloaded = await downloadAsset(source, input.baseUrl);
    } catch (error) {
      // Deleted images may remain linked by old messages and generation inputs.
      // Keep those records and report the unavailable files without weakening
      // the requirement that current canvas/library originals must be present.
      if (!source.historicalOnly || !(error instanceof MissingLocalArchiveAsset)) throw error;
      missingHistoryAssets.push({ originalUrl: source.originalUrl, reason: error.message });
      continue;
    }
    const digest = sha256(downloaded.buffer);
    const ext = downloaded.ext || extFromContentType(downloaded.contentType) || "bin";
    const archivePath = `assets/${String(index + 1).padStart(5, "0")}-${digest.slice(0, 12)}.${ext}`;
    zip.file(archivePath, downloaded.buffer);
    assets.push({
      id: source.id,
      storageKey: source.storageKey,
      originalUrl: source.originalUrl,
      archivePath,
      contentType: downloaded.contentType || inferMimeType(ext),
      size: downloaded.buffer.byteLength,
      sha256: digest,
    });
    input.onProgress?.({
      stage: `正在打包资源 ${index + 1}/${sources.length}`,
      current: index + 1,
      total: sources.length,
    });
  }

  const archiveId = `archive_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const projectName = asText(snapshot.project.name, "项目画板");
  const manifest: ProjectArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    mode: "archive",
    archiveId,
    originalProjectId: input.projectId,
    projectName,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    data: snapshot,
    assets,
    ...(missingHistoryAssets.length ? { missingHistoryAssets } : {}),
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  input.onProgress?.({ stage: "正在生成压缩包", current: sources.length, total: sources.length });
  zip.file("README.txt", [
    "环中AIStudio NAS 项目归档包",
    "",
    `项目：${projectName}`,
    `项目 ID：${input.projectId}`,
    `归档时间：${manifest.exportedAt}`,
    `图片资源：${assets.length}`,
    ...(missingHistoryAssets.length ? [
      `历史缺失资源：${missingHistoryAssets.length}（原文件在备份前已不存在，对话和原链接保留）`,
      ...missingHistoryAssets.map(asset => asset.originalUrl),
    ] : []),
    "",
    "此文件用于“资产 → 项目备份”恢复项目，请勿手工修改。",
  ].join("\n"));

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const fileName = `${safeFileName(projectName, "项目画板")}_${manifest.exportedAt.replace(/[:.]/g, "-")}.hzarchive.zip`;
  return { buffer, fileName, manifest };
}

export async function verifyProjectArchiveBuffer(
  buffer: Buffer | Uint8Array,
): Promise<ProjectArchiveManifest> {
  const zip = await JSZip.loadAsync(buffer);
  const manifest = await readBackupManifest(buffer);

  for (const asset of manifest.assets || []) {
    const file = zip.file(asset.archivePath);
    if (!file) throw new Error(`归档包缺少资源：${asset.archivePath}`);
    const assetBuffer = Buffer.from(await file.async("nodebuffer"));
    if (assetBuffer.byteLength !== asset.size) {
      throw new Error(`资源大小校验失败：${asset.archivePath}`);
    }
    if (sha256(assetBuffer) !== asset.sha256) {
      throw new Error(`资源校验失败：${asset.archivePath}`);
    }
  }

  return manifest;
}

async function saveArchiveAssets(
  manifest: ProjectArchiveManifest,
  zip: JSZip,
): Promise<Map<string, ProjectArchiveAssetReplacement>> {
  const results = new Map<string, ProjectArchiveAssetReplacement>();
  if (isLocalBackendEnabled()) {
    for (const asset of manifest.assets) {
      const file = zip.file(asset.archivePath);
      if (!file) throw new Error(`归档包缺少资源：${asset.archivePath}`);
      const buffer = Buffer.from(await file.async("nodebuffer"));
      const saved = saveBinaryFile(buffer, path.basename(asset.archivePath), asset.contentType);
      results.set(asset.id, { url: saved.url, key: saved.key });
    }
    return results;
  }

  const s3 = new S3Storage(new S3Config());
  for (const asset of manifest.assets) {
    const file = zip.file(asset.archivePath);
    if (!file) throw new Error(`归档包缺少资源：${asset.archivePath}`);
    const buffer = Buffer.from(await file.async("nodebuffer"));
    const key = await s3.uploadFile({
      fileContent: buffer,
      fileName: path.basename(asset.archivePath),
      contentType: asset.contentType || "image/png",
    });
    const url = await s3.generatePresignedUrl({ key, expireTime: 86400 });
    results.set(asset.id, { url, key });
  }
  return results;
}

export function buildReplacementOptions(
  manifest: ProjectArchiveManifest,
  assetResults: Map<string, ProjectArchiveAssetReplacement>,
  projectId: string,
  preserveRecordIds: boolean,
): ProjectArchiveRestoreOptions {
  const assetByStorageKey = new Map<string, ProjectArchiveAssetReplacement>();
  const assetByOriginalUrl = new Map<string, ProjectArchiveAssetReplacement>();
  for (const asset of manifest.assets) {
    const replacement = assetResults.get(asset.id);
    if (!replacement) continue;
    if (asset.storageKey) assetByStorageKey.set(asset.storageKey, replacement);
    if (asset.originalUrl) assetByOriginalUrl.set(asset.originalUrl, replacement);
  }
  return { projectId, preserveRecordIds, assetByStorageKey, assetByOriginalUrl };
}

export async function projectExistsForUser(projectId: string, userId: string): Promise<boolean> {
  if (isLocalBackendEnabled()) return Boolean(getProjectById(projectId, userId));
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function importProjectArchiveBuffer(
  buffer: Buffer | Uint8Array,
  userId: string | null,
): Promise<{ project: ArchiveRecord; manifest: ProjectArchiveManifest; restoredAsCopy: boolean }> {
  if (!userId) throw new Error("未登录");
  const manifest = await verifyProjectArchiveBuffer(buffer);
  const originalId = manifest.originalProjectId;
  const conflict = await projectExistsForUser(originalId, userId);
  const projectId = conflict ? randomUUID() : originalId;
  const preserveRecordIds = !conflict;
  if (conflict) {
    manifest.data.project = { ...manifest.data.project, name: `${asText(manifest.data.project.name, "恢复项目")}（恢复副本）` };
  }
  const zip = await JSZip.loadAsync(buffer);
  const assetResults = await saveArchiveAssets(manifest, zip);
  const options = buildReplacementOptions(manifest, assetResults, projectId, preserveRecordIds);

  if (isLocalBackendEnabled()) {
    const project = restoreLocalProjectSnapshot(manifest.data, userId, options);
    return { project: project as unknown as ArchiveRecord, manifest, restoredAsCopy: conflict };
  }

  const project = await restoreSupabaseProjectSnapshot(manifest.data, userId, options);
  return { project, manifest, restoredAsCopy: conflict };
}

export async function clearArchivedProjectData(
  projectId: string,
  userId: string,
): Promise<{ storageKeys: string[] }> {
  if (isLocalBackendEnabled()) {
    const result = clearLocalProjectArchiveData(projectId, userId);
    if (!result.deleted || getProjectById(projectId, userId)) {
      throw new Error("项目清理未完成，已保留归档包并停止后续操作");
    }
    return { storageKeys: result.storageKeys };
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("archive_clear_project_data", {
    p_project_id: projectId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`数据库归档清理失败，请先执行 migrations/2026-10-11-project-archive.sql：${error.message}`);
  }
  const storageKeys = Array.isArray(data?.storageKeys)
    ? data.storageKeys.filter((key: unknown): key is string => typeof key === "string" && Boolean(key))
    : [];

  if (storageKeys.length > 0) {
    const s3 = new S3Storage(new S3Config());
    for (const key of storageKeys) {
      try {
        await s3.deleteFile({ fileKey: key });
      } catch {
        // The archive is already committed. Orphan cleanup can be retried safely.
      }
    }
  }

  const { data: remainingProject } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (remainingProject) {
    throw new Error("项目清理未完成，已保留归档包并停止后续操作");
  }
  return { storageKeys };
}

function chunkRows<T>(rows: T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function insertSupabaseRows(table: string, rows: ArchiveRecord[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabaseClient();
  for (const chunk of chunkRows(rows)) {
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`恢复 ${table} 失败：${error.message}`);
  }
}

export async function restoreSupabaseProjectSnapshot(
  snapshot: ProjectArchiveSnapshot,
  userId: string,
  options: ProjectArchiveRestoreOptions,
): Promise<ArchiveRecord> {
  const supabase = getSupabaseClient();
  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("id", options.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) throw new Error("目标项目 ID 已存在，无法覆盖恢复");

  const makeId = (value: unknown, preserve: boolean): string => {
    const original = asText(value);
    return preserve && original ? original : randomUUID();
  };

  const folderRows = await querySupabaseRows("project_folders", (query) => query.eq("user_id", userId));
  const existingFolderIds = new Set(folderRows.map((folder) => asText(folder.id)));
  const folderIdMap = new Map<string, string>();
  const folderInserts: ArchiveRecord[] = [];
  for (const folder of snapshot.projectFolders) {
    const originalId = asText(folder.id);
    if (!originalId) continue;
    const nextId = options.preserveRecordIds && existingFolderIds.has(originalId)
      ? originalId
      : makeId(originalId, options.preserveRecordIds);
    folderIdMap.set(originalId, nextId);
    if (!existingFolderIds.has(originalId)) {
      folderInserts.push({
        id: nextId,
        user_id: userId,
        name: asText(folder.name, "项目文件夹"),
        parent_id: folder.parent_id ? folderIdMap.get(asText(folder.parent_id)) || null : null,
        sort_order: asNumber(folder.sort_order),
        color: asText(folder.color, "#6366f1"),
        is_collapsed: asBoolean(folder.is_collapsed),
        created_at: asText(folder.created_at, new Date().toISOString()),
        updated_at: asOptionalText(folder.updated_at),
      });
    }
  }
  await insertSupabaseRows("project_folders", folderInserts);

  const blockIdMap = new Map<string, string>();
  const imageIdMap = new Map<string, string>();
  const assetIdMap = new Map<string, string>();
  const operationIdMap = new Map<string, string>();
  const inspirationFolderIdMap = new Map<string, string>();
  for (const row of snapshot.canvasBlocks) blockIdMap.set(asText(row.id), makeId(row.id, options.preserveRecordIds));
  for (const row of snapshot.imageRecords) imageIdMap.set(asText(row.id), makeId(row.id, options.preserveRecordIds));
  for (const row of snapshot.designAssets) assetIdMap.set(asText(row.id), makeId(row.id, options.preserveRecordIds));
  for (const row of snapshot.designOperations) operationIdMap.set(asText(row.id), makeId(row.id, options.preserveRecordIds));
  for (const row of snapshot.inspirationFolders) inspirationFolderIdMap.set(asText(row.id), makeId(row.id, options.preserveRecordIds));

  const mappedUrl = (value: unknown): string | null => {
    const raw = asText(value);
    if (!raw) return null;
    return options.assetByOriginalUrl.get(raw)?.url || raw;
  };
  const mappedKey = (keyValue: unknown, urlValue: unknown): string | null => {
    const key = asOptionalText(keyValue);
    const url = asText(urlValue);
    if (key && options.assetByStorageKey.has(key)) return options.assetByStorageKey.get(key)?.key || null;
    if (url && options.assetByOriginalUrl.has(url)) return options.assetByOriginalUrl.get(url)?.key || null;
    return key;
  };
  const mappedUrlArray = (value: unknown): string | null => {
    if (!value) return null;
    const urls = parseUrlArray(value);
    if (urls.length === 0) return asOptionalText(value);
    return JSON.stringify(urls.map((url) => mappedUrl(url) || url));
  };

  const project: ArchiveRecord = {
    id: options.projectId,
    user_id: userId,
    name: asText(snapshot.project.name, "恢复项目"),
    folder_id: snapshot.project.folder_id ? folderIdMap.get(asText(snapshot.project.folder_id)) || null : null,
    is_pinned: asBoolean(snapshot.project.is_pinned),
    sort_order: asNumber(snapshot.project.sort_order),
    created_at: asText(snapshot.project.created_at, new Date().toISOString()),
    updated_at: asOptionalText(snapshot.project.updated_at),
  };
  await insertSupabaseRows("projects", [project]);

  await insertSupabaseRows("canvas_blocks", snapshot.canvasBlocks.map((row) => ({
    id: blockIdMap.get(asText(row.id)),
    project_id: options.projectId,
    user_id: userId,
    name: asText(row.name, "画板"),
    color: asText(row.color, "#3b82f6"),
    canvas_x: asNumber(row.canvas_x),
    canvas_y: asNumber(row.canvas_y),
    canvas_width: asNumber(row.canvas_width, 960),
    canvas_height: asNumber(row.canvas_height, 600),
    image_scale: asNumber(row.image_scale, 1),
    sort_mode: asText(row.sort_mode, "compact"),
    padding: asNumber(row.padding, 20),
    locked: asBoolean(row.locked),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asOptionalText(row.updated_at),
  })));

  await insertSupabaseRows("image_records", snapshot.imageRecords.map((row) => ({
    id: imageIdMap.get(asText(row.id)),
    project_id: options.projectId,
    user_id: userId,
    prompt: asText(row.prompt),
    image_url: mappedUrl(row.image_url) || asText(row.image_url),
    image_key: mappedKey(row.image_key, row.image_url),
    reference_images: mappedUrlArray(row.reference_images),
    canvas_block_id: row.canvas_block_id ? blockIdMap.get(asText(row.canvas_block_id)) || null : null,
    block_order: asNumber(row.block_order),
    canvas_x: asNumber(row.canvas_x, 40),
    canvas_y: asNumber(row.canvas_y, 40),
    canvas_width: asNumber(row.canvas_width, 320),
    canvas_height: asNumber(row.canvas_height, 320),
    size: asText(row.size, "1:1"),
    model: asText(row.model, "gpt-image-2"),
    status: asText(row.status, "completed"),
    is_favorite: asBoolean(row.is_favorite),
    deleted_at: asOptionalText(row.deleted_at),
    edited_image_key: mappedKey(row.edited_image_key, ""),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asOptionalText(row.updated_at),
  })));

  await insertSupabaseRows("image_tags", snapshot.imageTags.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    image_id: imageIdMap.get(asText(row.image_id)),
    tag: asText(row.tag),
    created_at: asText(row.created_at, new Date().toISOString()),
  })).filter((row) => row.image_id));

  await insertSupabaseRows("chat_messages", snapshot.chatMessages.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    user_id: userId,
    project_id: options.projectId,
    role: asText(row.role, "user") === "assistant" ? "assistant" : "user",
    content: asText(row.content),
    reference_image_urls: mappedUrlArray(row.reference_image_urls),
    image_url: mappedUrl(row.image_url),
    created_at: asText(row.created_at, new Date().toISOString()),
  })));

  await insertSupabaseRows("reference_images", snapshot.referenceImages.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    user_id: userId,
    project_id: options.projectId,
    image_url: mappedUrl(row.image_url) || asText(row.image_url),
    image_key: mappedKey(row.image_key, row.image_url),
    file_name: asOptionalText(row.file_name),
    created_at: asText(row.created_at, new Date().toISOString()),
  })));

  await insertSupabaseRows("prompt_library", snapshot.prompts.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    user_id: userId,
    project_id: options.projectId,
    text: asText(row.text, asText(row.content)),
    category: asText(row.category, "general"),
    image_url: mappedUrl(row.image_url),
    created_at: asText(row.created_at, new Date().toISOString()),
  })));

  await insertSupabaseRows("custom_skills", snapshot.skills.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    user_id: userId,
    project_id: options.projectId,
    name: asText(row.name, "恢复技能"),
    description: asText(row.description),
    steps: asText(row.steps, "[]"),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asText(row.updated_at, new Date().toISOString()),
  })));

  await insertSupabaseRows("design_assets", snapshot.designAssets.map((row) => ({
    id: assetIdMap.get(asText(row.id)),
    project_id: options.projectId,
    user_id: userId,
    kind: asText(row.kind, "image"),
    url: mappedUrl(row.url) || asText(row.url),
    key: mappedKey(row.key, row.url),
    width: asNumber(row.width),
    height: asNumber(row.height),
    mime_type: asText(row.mime_type, "image/png"),
    metadata: asRecord(row.metadata),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asOptionalText(row.updated_at),
  })));

  await insertSupabaseRows("design_operations", snapshot.designOperations.map((row) => ({
    id: operationIdMap.get(asText(row.id)),
    document_id: asOptionalText(row.document_id),
    project_id: options.projectId,
    user_id: userId,
    input_asset_ids: Array.isArray(row.input_asset_ids) ? row.input_asset_ids.map((id) => assetIdMap.get(asText(id)) || asText(id)).filter(Boolean) : [],
    output_asset_ids: Array.isArray(row.output_asset_ids) ? row.output_asset_ids.map((id) => assetIdMap.get(asText(id)) || asText(id)).filter(Boolean) : [],
    kind: asText(row.kind, "generate"),
    prompt: asText(row.prompt),
    mask_asset_id: row.mask_asset_id ? assetIdMap.get(asText(row.mask_asset_id)) || null : null,
    provider: asText(row.provider),
    model: asText(row.model),
    params: asRecord(row.params),
    status: asText(row.status, "completed"),
    error: asOptionalText(row.error),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asOptionalText(row.updated_at),
    completed_at: asOptionalText(row.completed_at),
  })));

  await insertSupabaseRows("design_layers", snapshot.designLayers.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    document_id: asOptionalText(row.document_id),
    project_id: options.projectId,
    user_id: userId,
    asset_id: row.asset_id ? assetIdMap.get(asText(row.asset_id)) || null : null,
    type: asText(row.type, "image"),
    name: asText(row.name, "图层"),
    x: asNumber(row.x),
    y: asNumber(row.y),
    width: asNumber(row.width),
    height: asNumber(row.height),
    opacity: asNumber(row.opacity, 1),
    visible: asBoolean(row.visible, true),
    locked: asBoolean(row.locked),
    z_index: asNumber(row.z_index),
    props: asRecord(row.props),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asOptionalText(row.updated_at),
  })));

  await insertSupabaseRows("asset_versions", snapshot.assetVersions.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    asset_id: assetIdMap.get(asText(row.asset_id)),
    parent_asset_id: row.parent_asset_id ? assetIdMap.get(asText(row.parent_asset_id)) || null : null,
    operation_id: row.operation_id ? operationIdMap.get(asText(row.operation_id)) || null : null,
    user_id: userId,
    version_index: asNumber(row.version_index, 1),
    label: asText(row.label, "版本"),
    url: mappedUrl(row.url) || asText(row.url),
    key: mappedKey(row.key, row.url),
    metadata: asRecord(row.metadata),
    created_at: asText(row.created_at, new Date().toISOString()),
  })).filter((row) => row.asset_id));

  await insertSupabaseRows("inspiration_folders", snapshot.inspirationFolders.map((row) => ({
    id: inspirationFolderIdMap.get(asText(row.id)),
    user_id: userId,
    project_id: options.projectId,
    name: asText(row.name, "灵感文件夹"),
    parent_id: row.parent_id ? inspirationFolderIdMap.get(asText(row.parent_id)) || null : null,
    sort_order: asNumber(row.sort_order),
    color: asText(row.color, "#6366f1"),
    created_at: asText(row.created_at, new Date().toISOString()),
    updated_at: asOptionalText(row.updated_at),
  })));

  await insertSupabaseRows("inspiration_items", snapshot.inspirationItems.map((row) => ({
    id: makeId(row.id, options.preserveRecordIds),
    folder_id: row.folder_id ? inspirationFolderIdMap.get(asText(row.folder_id)) || null : null,
    project_id: options.projectId,
    user_id: userId,
    image_url: mappedUrl(row.image_url) || asText(row.image_url),
    image_key: mappedKey(row.image_key, row.image_url),
    file_name: asOptionalText(row.file_name),
    source: asText(row.source, "upload"),
    dominant_color: asOptionalText(row.dominant_color),
    width: asNumber(row.width),
    height: asNumber(row.height),
    created_at: asText(row.created_at, new Date().toISOString()),
  })));

  if (snapshot.archivedImages.length > 0) {
    await insertSupabaseRows("archived_images", snapshot.archivedImages.map((row) => ({
      id: makeId(row.id, options.preserveRecordIds),
      project_id: options.projectId,
      user_id: userId,
      original_image_id: row.original_image_id ? imageIdMap.get(asText(row.original_image_id)) || null : null,
      folder_id: asOptionalText(row.folder_id),
      prompt: asText(row.prompt),
      original_prompt: asText(row.original_prompt),
      image_url: mappedUrl(row.image_url) || asText(row.image_url),
      image_key: mappedKey(row.image_key, row.image_url),
      model: asText(row.model),
      size: asText(row.size, "1:1"),
      tags: asText(row.tags),
      created_at: asText(row.created_at, new Date().toISOString()),
      updated_at: asText(row.updated_at, new Date().toISOString()),
    })));
  }

  return project;
}
