export type LibraryKind = 'prompts' | 'fonts' | 'cases';
export type TransferScope = { mode: 'all' | 'group' | 'selected'; groupId?: string; ids?: string[] };
export type TransferPreview = {
  kind: LibraryKind; name: string; author: string; description: string; createdAt: string;
  total: number; images: number; missing: number; bytes: number; duplicates: number; conflicts: number;
  items: { title: string; status: 'new' | 'duplicate' | 'conflict' }[];
  groups: { id: string; name: string }[];
};
export type TransferResult = { added: number; skipped: number; conflicts: number; groupId: string | null; groupName: string };
