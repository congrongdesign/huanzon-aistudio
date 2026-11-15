export type ArchiveRecord = Record<string, unknown>;

export interface ProjectArchiveSnapshot {
  project: ArchiveRecord;
  projectFolders: ArchiveRecord[];
  imageRecords: ArchiveRecord[];
  imageTags: ArchiveRecord[];
  canvasBlocks: ArchiveRecord[];
  chatMessages: ArchiveRecord[];
  referenceImages: ArchiveRecord[];
  prompts: ArchiveRecord[];
  skills: ArchiveRecord[];
  designAssets: ArchiveRecord[];
  designLayers: ArchiveRecord[];
  designOperations: ArchiveRecord[];
  assetVersions: ArchiveRecord[];
  inspirationFolders: ArchiveRecord[];
  inspirationItems: ArchiveRecord[];
  archivedImages: ArchiveRecord[];
}

export interface ProjectArchiveAsset {
  id: string;
  storageKey: string | null;
  originalUrl: string;
  archivePath: string;
  contentType: string;
  size: number;
  sha256: string;
}

export interface ProjectArchiveManifest {
  format: "huanzon-aistudio-project";
  version: 2;
  mode: "archive";
  archiveId: string;
  originalProjectId: string;
  projectName: string;
  exportedAt: string;
  appVersion: string;
  data: ProjectArchiveSnapshot;
  assets: ProjectArchiveAsset[];
  missingHistoryAssets?: { originalUrl: string; reason: string }[];
}

export interface ProjectArchiveEntry {
  id: string;
  archiveId: string;
  projectId: string;
  projectName: string;
  fileName: string;
  relativePath: string;
  metaRelativePath: string;
  size: number;
  checksum: string;
  manifestVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
  restoredAt: string | null;
  restoredProjectId: string | null;
  deviceName: string;
  ownerId?: string;
  thumbnailDataUrl?: string;
  sourceFormat?: "legacy" | "archive";
  missingHistoryAssetCount?: number;
  counts: {
    images: number;
    messages: number;
    references: number;
    prompts: number;
    skills: number;
    designAssets: number;
    inspirationItems: number;
  };
}

export type ProjectArchiveJobAction = "archive" | "restore";
export type ProjectArchiveJobStatus = "queued" | "running" | "paused" | "cancelled" | "completed" | "failed" | "partial";

export interface ProjectArchiveJobResult {
  projectId: string;
  projectName: string;
  status: "completed" | "failed" | "skipped";
  message: string;
  entryId?: string;
  restoredProjectId?: string;
  originalRemoved?: boolean;
}

export interface ProjectArchiveJob {
  id: string;
  action: ProjectArchiveJobAction;
  status: ProjectArchiveJobStatus;
  stage: string;
  targetDir: string;
  total: number;
  completed: number;
  failed: number;
  currentProjectId: string | null;
  currentProjectName: string | null;
  results: ProjectArchiveJobResult[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectArchiveAssetReplacement {
  url: string;
  key: string | null;
}

export interface ProjectArchiveRestoreOptions {
  projectId: string;
  preserveRecordIds: boolean;
  assetByStorageKey: Map<string, ProjectArchiveAssetReplacement>;
  assetByOriginalUrl: Map<string, ProjectArchiveAssetReplacement>;
}
