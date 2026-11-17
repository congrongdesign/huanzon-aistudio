export type LibraryKind = 'prompts' | 'fonts' | 'cases';
export type ImportStage = 'needs_source' | 'queued' | 'saving' | 'saved' | 'analyzing' | 'applying' | 'completed' | 'waiting' | 'failed' | 'canceled';
export type ImportAnalysis = { title: string; description: string; tags: string[]; category: string; prompt: string; sampleText: string; confidence: number; model: string; ocr: string };
export type ImportMedia = { key: string; url: string; hash: string; width: number; height: number; bytes: number };
export type LibraryImportItem = {
  id: string; owner: string; batchId: string; kind: LibraryKind; originalName: string; bytes: number;
  groupId: string; projectId: string | null; targetId?: string; stage: ImportStage; error?: string;
  sourceToken?: string; staged?: boolean; media?: ImportMedia; cardId?: string; created?: boolean;
  snapshot?: Record<string, unknown>; analysis?: ImportAnalysis; attempt: number; nextAttempt?: number;
  cancelAnalysis?: boolean; committedRevision?: string; undone?: boolean; preserved?: boolean;
  createdAt: string; updatedAt: string;
};
export type LibraryImportBatch = { id: string; owner: string; kind: LibraryKind; groupId: string; projectId: string | null; targetId?: string; paused: boolean; createdAt: string; undoRequested?: boolean };
export type ImportSnapshot = { batches: LibraryImportBatch[]; items: LibraryImportItem[]; revision: number; total: number; active: number };
export const LIBRARY_LABELS: Record<LibraryKind, string> = { prompts: '提示词库', fonts: '字体库', cases: '案例中心' };
export const IMPORT_STAGE_LABELS: Record<ImportStage, string> = { needs_source: '等待传入原图', queued: '等待保存', saving: '正在保存原图', saved: '已保存 · 等待整理', analyzing: '正在分析', applying: '正在整理资料', completed: '整理完成', waiting: '等待处理', failed: '处理失败', canceled: '已取消整理' };
