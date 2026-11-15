export type CaseFolder = { id: string; name: string };
export type ReferenceAsset = {
  id: string; title: string; url: string; key: string; width: number; height: number;
  fileName: string; bytes: number; hash: string; folderIds: string[]; tags: string[];
  note: string; source: string; prompt: string; favorite: boolean;
  createdAt: string; updatedAt: string; lastUsedAt?: string; deletedAt?: string;
  legacyId?: string; collection?: string;
};
export type CaseLibraryResult = {
  items: ReferenceAsset[]; folders: CaseFolder[]; total: number; page: number; pageSize: number;
  counts: { all: number; favorites: number; unfiled: number; recent: number; trash: number };
  folderCounts: Record<string, number>; tags: string[];
};
export type ReferenceUse = { items: ReferenceAsset[]; mode: 'reference' | 'canvas' };
