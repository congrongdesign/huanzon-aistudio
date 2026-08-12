export type BatchOutputFormat = "zip" | "pdf" | "pptx";
export type BatchGenerationMode = "draft_and_color" | "draft_only" | "recolor_only";
export type BatchJobStage = "draft_generation" | "colorization";
export type BatchLogLevel = "info" | "warn" | "error";
export type UnifiedTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type BatchStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "partially_failed"
  | "failed"
  | "cancelled";
export type BatchPageStatus =
  | "draft_queued"
  | "draft_generating"
  | "draft_succeeded"
  | "draft_failed"
  | "color_queued"
  | "color_generating"
  | "color_succeeded"
  | "color_failed";

export interface BatchImportedSlide {
  id: string;
  pageNumber: number;
  title: string;
  role: string;
  originalUrl: string;
  originalKey?: string;
  fileName: string;
  width?: number;
  height?: number;
  ocrText?: string;
  sourceText?: string;
  textHash?: string;
  status?: "ready" | "needs_image";
}

export interface BatchOptions {
  pageRange: string;
  selectedPages: number[];
  generateDraft: boolean;
  generateColored: boolean;
  generationMode: BatchGenerationMode;
  draftConcurrency: number;
  colorConcurrency: number;
  retryLimit: number;
  outputFormats: BatchOutputFormat[];
  aspectRatio: string;
  stylePrompt: string;
  draftPrompt: string;
  colorPrompt: string;
}

export interface BatchLogEntry {
  at: string;
  level: BatchLogLevel;
  stage?: BatchJobStage | "rendering" | "export";
  page?: number;
  status?: string;
  message: string;
  error?: string;
}

export interface BatchPageManifest {
  id: string;
  batchId: string;
  pageNumber: number;
  title: string;
  role: string;
  originalUrl: string;
  originalKey?: string;
  sourceText: string;
  draftImageUrl?: string;
  draftImageKey?: string;
  coloredImageUrl?: string;
  coloredImageKey?: string;
  status: BatchPageStatus;
  error?: string;
  draftAttempts: number;
  colorAttempts: number;
  timings: {
    draftMs?: number;
    colorMs?: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface BatchManifest {
  batch: {
    id: string;
    userId: string | null;
    sourceFileName: string;
    sourceKind: "pptx" | "pdf" | "zip" | "images";
    referenceImageUrl?: string;
    referenceImageKey?: string;
    pageCount: number;
    selectedPageCount: number;
    status: BatchStatus;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    options: BatchOptions;
    generation: {
      apiKey: string;
      baseUrl: string;
      model: string;
      imageSize?: string;
    };
    logs: BatchLogEntry[];
  };
  pages: BatchPageManifest[];
}

export interface BatchSnapshot {
  batchId: string;
  sourceFileName: string;
  sourceKind: "pptx" | "pdf" | "zip" | "images";
  status: BatchStatus;
  unifiedStatus: UnifiedTaskStatus;
  pageCount: number;
  selectedPageCount: number;
  completedPages: number;
  processingPages: number;
  failedPages: number;
  progress: number;
  totalElapsedMs: number | null;
  avgPageMs: number | null;
  referenceImageUrl?: string;
  error?: string;
  recovery: {
    resumable: boolean;
    canRetryFailedPages: boolean;
    queuedPages: number;
    runningPages: number;
    failedPages: number;
  };
  options: BatchOptions;
  pages: Array<{
    page: number;
    title: string;
    role: string;
    status: BatchPageStatus;
    unifiedStatus: UnifiedTaskStatus;
    originalUrl: string;
    draftUrl?: string;
    coloredUrl?: string;
    error?: string;
    draftAttempts: number;
    colorAttempts: number;
    draftMs?: number | null;
    colorMs?: number | null;
    totalMs?: number | null;
  }>;
  metrics: {
    draft: {
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
    };
    color: {
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
    };
  };
  logs: BatchLogEntry[];
}

export interface CreateBatchInput {
  userId: string | null;
  sourceFileName: string;
  sourceKind: "pptx" | "pdf" | "zip" | "images";
  referenceImageUrl?: string;
  referenceImageKey?: string;
  slides: BatchImportedSlide[];
  options: Partial<BatchOptions>;
  generation: {
    apiKey: string;
    baseUrl: string;
    model: string;
    imageSize?: string;
  };
}
