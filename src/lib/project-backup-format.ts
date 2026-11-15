import JSZip from "jszip";
import { createHash } from "node:crypto";
import type { ArchiveRecord, ProjectArchiveManifest, ProjectArchiveSnapshot } from "./project-archive-types";

type LegacyAsset = { fileName: string; originalUrl: string; contentType?: string };
type LegacyManifest = {
  format: string; version: 1; project: ArchiveRecord; exportedAt?: string; assets?: LegacyAsset[];
  imageRecords?: ArchiveRecord[]; chatMessages?: ArchiveRecord[]; referenceImages?: ArchiveRecord[];
  prompts?: ArchiveRecord[]; skills?: ArchiveRecord[];
};

// Read both old portable/sync packages and complete v2 archives through one engine.
export async function readBackupManifest(buffer: Buffer | Uint8Array): Promise<ProjectArchiveManifest> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("manifest.json");
  if (!file) throw new Error("项目包缺少 manifest.json");
  const raw = JSON.parse(await file.async("string"));
  return normalizeBackupManifest(raw, createHash("sha256").update(buffer).digest("hex"), async asset => {
    const source = zip.file(asset.fileName);
    if (!source) throw new Error(`旧项目包缺少资源：${asset.fileName}`);
    const bytes = await source.async("nodebuffer");
    return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}

export async function normalizeBackupManifest(raw: ProjectArchiveManifest | LegacyManifest, checksum: string,
  inspect: (asset: LegacyAsset) => Promise<{ size: number; sha256: string }>): Promise<ProjectArchiveManifest> {
  if (raw.format !== "huanzon-aistudio-project" || ![1, 2].includes(raw.version)) throw new Error("不支持的项目备份格式");
  if (raw.version === 2) {
    if (!raw.originalProjectId || !raw.data?.project || !Array.isArray(raw.assets)) throw new Error("备份缺少项目信息");
    return raw as ProjectArchiveManifest;
  }
  if (!raw.project?.id) throw new Error("旧项目包缺少项目信息");
  const data: ProjectArchiveSnapshot = {
    project: raw.project, projectFolders: [], canvasBlocks: [], imageTags: [],
    imageRecords: raw.imageRecords || [], chatMessages: raw.chatMessages || [],
    referenceImages: raw.referenceImages || [], prompts: raw.prompts || [], skills: raw.skills || [],
    designAssets: [], designLayers: [], designOperations: [], assetVersions: [],
    inspirationFolders: [], inspirationItems: [], archivedImages: [],
  };
  const assets: ProjectArchiveManifest['assets'] = [];
  for (const [i, asset] of (raw.assets || []).entries()) {
    const info = await inspect(asset);
    assets.push({ id: `legacy-${i}`, storageKey: null, originalUrl: asset.originalUrl, archivePath: asset.fileName,
      contentType: asset.contentType || "application/octet-stream", ...info });
  }
  // Old exporters silently skipped unavailable files. Do not restore those as broken URLs.
  const available = new Set(assets.map(asset => asset.originalUrl));
  const requireUrl = (url: unknown) => { if (typeof url === "string" && url && !available.has(url)) throw new Error("旧备份缺少原始图片，请保留原项目并重新备份"); };
  for (const row of [...data.imageRecords, ...data.referenceImages, ...data.chatMessages, ...data.prompts]) requireUrl(row.image_url);
  for (const row of [...data.imageRecords, ...data.chatMessages]) {
    for (const key of ["reference_images", "reference_image_urls"]) {
      const value = (row as ArchiveRecord)[key];
      if (!value) continue;
      let urls: unknown = value;
      if (typeof value === "string") { try { urls = JSON.parse(value); } catch { urls = [value]; } }
      if (Array.isArray(urls)) for (const url of urls) requireUrl(url);
    }
  }
  return { format: "huanzon-aistudio-project", version: 2, mode: "archive",
    archiveId: `legacy_${checksum.slice(0, 24)}`,
    originalProjectId: String(raw.project.id), projectName: String(raw.project.name || "未命名项目"),
    exportedAt: raw.exportedAt || "", appVersion: "legacy", data, assets };
}
