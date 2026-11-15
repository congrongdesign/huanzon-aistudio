export type CleanupKind = 'cache' | 'orphans' | 'trash';
export interface StorageDirectoryListing {
  directory: string;
  parent: string | null;
  folders: { name: string; path: string }[];
  shortcuts: { name: string; path: string }[];
  breadcrumbs: { name: string; path: string }[];
  writable: boolean;
  disk: { total: number; available: number } | null;
}
export interface StorageFileItem { id: string; name: string; bytes: number; kind: CleanupKind; }
export interface StorageScan {
  token: string;
  createdAt: string;
  items: StorageFileItem[];
  missing: { id: string; prompt: string; key: string }[];
  counts: Record<CleanupKind, { count: number; bytes: number }>;
}
export interface StorageMigration {
  id: string; status: 'running' | 'completed' | 'failed';
  total: number; processed: number; bytes: number; error?: string;
}
export interface StorageOverview {
  supported: boolean;
  reason?: string;
  directory: string;
  customDirectory: string;
  previousDirectories: string[];
  cacheLimitMB: number;
  libraryBytes: number;
  libraryCount: number;
  cacheBytes: number;
  cacheCount: number;
  disk: { total: number; available: number } | null;
  migration: StorageMigration | null;
  cleanup?: { pending: number; failed: number; reclaimedBytes: number; recent: { key: string; status: string; detail?: string; error?: string }[] };
  usage?: { active: number; trash: number; unreferenced: number };
  breakdown?: { canvas: number; fonts: number; other: number; trash: number; unreferenced: number };
}
export const formatStorageBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit < 2 ? 0 : 1 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
};
