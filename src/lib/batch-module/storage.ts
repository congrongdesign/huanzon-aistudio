import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type {
  BatchImportedSlide,
  BatchLogEntry,
  BatchManifest,
  BatchOptions,
  BatchOutputFormat,
  BatchPageManifest,
  BatchSnapshot,
  CreateBatchInput,
  UnifiedTaskStatus,
} from "@/lib/batch-module/types";

const ROOT_DIR_NAME = "batch-module";
const MANIFEST_FILE = "manifest.json";
const DEFAULT_OUTPUT_FORMATS: BatchOutputFormat[] = ["zip", "pdf", "pptx"];
const MAX_BATCH_STAGE_CONCURRENCY = 16;
const manifestLocks = new Map<string, Promise<void>>();

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) {
    return path.resolve(process.env.LOCAL_DATA_DIR);
  }
  if (process.env.DESKTOP_ENV_PATH) {
    return path.dirname(process.env.DESKTOP_ENV_PATH);
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "环中AIStudio");
  }
  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "环中AIStudio");
  }
  if (process.platform === "linux") {
    return path.join(home, ".config", "环中AIStudio");
  }
  return path.join(process.cwd(), ".local-data", "环中AIStudio");
}

function getBatchRoot(): string {
  return path.join(getBaseDataDir(), ROOT_DIR_NAME);
}

export function ensureBatchRoot(): void {
  fs.mkdirSync(getBatchRoot(), { recursive: true });
}

export function getBatchDir(batchId: string): string {
  return path.join(getBatchRoot(), batchId);
}

export function getManifestPath(batchId: string): string {
  return path.join(getBatchDir(batchId), MANIFEST_FILE);
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function parsePageRange(pageRange: string, totalPages: number): number[] {
  const raw = (pageRange || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "全部" || raw === "*") {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const picked = new Set<number>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const matched = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!matched) {
      throw new Error(`页码范围格式不正确：${token}`);
    }
    const start = Number.parseInt(matched[1], 10);
    const end = Number.parseInt(matched[2] || matched[1], 10);
    if (start <= 0 || end < start || end > totalPages) {
      throw new Error(`页码范围超出限制：${token}`);
    }
    for (let page = start; page <= end; page += 1) {
      picked.add(page);
    }
  }
  if (picked.size === 0) {
    throw new Error("没有选中任何页面");
  }
  return Array.from(picked).sort((a, b) => a - b);
}

function resolveSourceKind(fileName: string, slides: BatchImportedSlide[]): CreateBatchInput["sourceKind"] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) return "pptx";
  if (lower.endsWith(".zip")) return "zip";
  return slides.length > 1 ? "images" : "images";
}

function createOptions(input: CreateBatchInput): BatchOptions {
  const totalPages = input.slides.length;
  const selectedPages = parsePageRange(input.options.pageRange || "", totalPages);
  const generateDraft = input.options.generationMode === "recolor_only" ? false : input.options.generateDraft !== false;
  const generateColored = input.options.generationMode === "draft_only" ? false : input.options.generateColored !== false;
  const mode =
    input.options.generationMode ||
    (generateDraft && generateColored ? "draft_and_color" : generateDraft ? "draft_only" : "recolor_only");
  return {
    pageRange: input.options.pageRange || "",
    selectedPages,
    generateDraft,
    generateColored,
    generationMode: mode,
    draftConcurrency: clamp(
      Number(input.options.draftConcurrency),
      1,
      Math.max(1, selectedPages.length),
      Math.min(MAX_BATCH_STAGE_CONCURRENCY, Math.max(1, selectedPages.length)),
    ),
    colorConcurrency: clamp(
      Number(input.options.colorConcurrency),
      1,
      Math.max(1, selectedPages.length),
      Math.min(MAX_BATCH_STAGE_CONCURRENCY, Math.max(1, selectedPages.length)),
    ),
    retryLimit: clamp(Number(input.options.retryLimit), 0, 5, 2),
    outputFormats: Array.isArray(input.options.outputFormats) && input.options.outputFormats.length > 0
      ? Array.from(new Set(input.options.outputFormats.filter((item): item is BatchOutputFormat => ["zip", "pdf", "pptx"].includes(item))))
      : DEFAULT_OUTPUT_FORMATS,
    aspectRatio: input.options.aspectRatio || "16:9",
    stylePrompt: (input.options.stylePrompt || "").trim(),
    draftPrompt: (input.options.draftPrompt || "").trim(),
    colorPrompt: (input.options.colorPrompt || "").trim(),
  };
}

function buildPageManifest(batchId: string, slide: BatchImportedSlide, options: BatchOptions): BatchPageManifest {
  const now = nowIso();
  const selected = options.selectedPages.includes(slide.pageNumber);
  let status: BatchPageManifest["status"] = "draft_queued";
  if (!selected) {
    status = options.generateColored ? "color_failed" : "draft_failed";
  } else if (!options.generateDraft && options.generateColored) {
    status = "color_queued";
  } else if (options.generateDraft) {
    status = "draft_queued";
  } else {
    status = "draft_succeeded";
  }

  return {
    id: randomUUID(),
    batchId,
    pageNumber: slide.pageNumber,
    title: slide.title || `第 ${slide.pageNumber} 页`,
    role: slide.role || "内容页",
    originalUrl: slide.originalUrl,
    originalKey: slide.originalKey,
    sourceText: slide.sourceText || slide.ocrText || "",
    status,
    draftAttempts: 0,
    colorAttempts: 0,
    timings: {},
    createdAt: now,
    updatedAt: now,
    error: !selected ? "未在当前页码范围内" : undefined,
  };
}

export function buildBatchManifest(input: CreateBatchInput): BatchManifest {
  if (!Array.isArray(input.slides) || input.slides.length === 0) {
    throw new Error("没有可处理的页面");
  }
  const batchId = `batch_${randomUUID().replace(/-/g, "")}`;
  const options = createOptions(input);
  const createdAt = nowIso();
  const pages = input.slides
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((slide) => buildPageManifest(batchId, slide, options));

  const manifest: BatchManifest = {
    batch: {
      id: batchId,
      userId: input.userId,
      sourceFileName: input.sourceFileName || "未命名批量文件",
      sourceKind: input.sourceKind || resolveSourceKind(input.sourceFileName, input.slides),
      referenceImageUrl: input.referenceImageUrl,
      referenceImageKey: input.referenceImageKey,
      pageCount: input.slides.length,
      selectedPageCount: options.selectedPages.length,
      status: options.generateDraft || options.generateColored ? "running" : "completed",
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      options,
      generation: input.generation,
      logs: [
        {
          at: createdAt,
          level: "info",
          stage: "rendering",
          message: `已创建批量任务，共 ${input.slides.length} 页，选中 ${options.selectedPages.length} 页。`,
        },
      ],
    },
    pages,
  };

  return manifest;
}

async function withManifestLock<T>(batchId: string, task: () => Promise<T>): Promise<T> {
  const previous = manifestLocks.get(batchId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  manifestLocks.set(batchId, previous.then(() => current));
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (manifestLocks.get(batchId) === current) {
      manifestLocks.delete(batchId);
    }
  }
}

export async function writeManifest(manifest: BatchManifest): Promise<void> {
  ensureBatchRoot();
  fs.mkdirSync(getBatchDir(manifest.batch.id), { recursive: true });
  const filePath = getManifestPath(manifest.batch.id);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

export async function readManifest(batchId: string): Promise<BatchManifest> {
  const filePath = getManifestPath(batchId);
  if (!fs.existsSync(filePath)) {
    throw new Error("批量任务不存在");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BatchManifest;
}

export async function updateManifest(batchId: string, updater: (manifest: BatchManifest) => void): Promise<BatchManifest> {
  return withManifestLock(batchId, async () => {
    const manifest = await readManifest(batchId);
    updater(manifest);
    manifest.batch.updatedAt = nowIso();
    await writeManifest(manifest);
    return manifest;
  });
}

export async function createManifest(input: CreateBatchInput): Promise<BatchManifest> {
  const manifest = buildBatchManifest(input);
  await writeManifest(manifest);
  return manifest;
}

export async function listManifests(userId?: string | null): Promise<BatchManifest[]> {
  ensureBatchRoot();
  const dirs = fs.existsSync(getBatchRoot()) ? fs.readdirSync(getBatchRoot()) : [];
  const manifests: BatchManifest[] = [];
  for (const dir of dirs) {
    const filePath = getManifestPath(dir);
    if (!fs.existsSync(filePath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(filePath, "utf8")) as BatchManifest;
      if (userId === undefined || manifest.batch.userId === userId) {
        manifests.push(manifest);
      }
    } catch {
      // ignore broken manifest
    }
  }
  manifests.sort((a, b) => {
    const aTime = new Date(a.batch.updatedAt || a.batch.createdAt).getTime();
    const bTime = new Date(b.batch.updatedAt || b.batch.createdAt).getTime();
    return bTime - aTime;
  });
  return manifests;
}

export async function deleteManifest(batchId: string, userId: string | null): Promise<boolean> {
  const manifest = await readManifest(batchId).catch(() => null);
  if (!manifest || manifest.batch.userId !== userId) return false;
  fs.rmSync(getBatchDir(batchId), { recursive: true, force: true });
  return true;
}

export function addLog(manifest: BatchManifest, entry: BatchLogEntry): void {
  manifest.batch.logs.unshift(entry);
  manifest.batch.logs = manifest.batch.logs.slice(0, 120);
}

export function finalizeBatchStatus(manifest: BatchManifest): void {
  if (manifest.batch.status === "paused" || manifest.batch.status === "cancelled") return;
  const selectedPages = manifest.pages.filter((page) => manifest.batch.options.selectedPages.includes(page.pageNumber));
  const done = selectedPages.filter((page) => {
    if (manifest.batch.options.generateColored) return page.status === "color_succeeded";
    if (manifest.batch.options.generateDraft) return page.status === "draft_succeeded";
    return true;
  }).length;
  const failed = selectedPages.filter((page) => page.status === "draft_failed" || page.status === "color_failed").length;
  const running = selectedPages.filter((page) => page.status === "draft_generating" || page.status === "color_generating").length;
  const queued = selectedPages.filter((page) => page.status === "draft_queued" || page.status === "color_queued").length;
  if (running > 0 || queued > 0) {
    manifest.batch.status = "running";
    return;
  }
  manifest.batch.completedAt = nowIso();
  manifest.batch.status = failed > 0 ? (done > 0 ? "partially_failed" : "failed") : "completed";
}

function toUnifiedBatchStatus(status: BatchManifest["batch"]["status"]): UnifiedTaskStatus {
  if (status === "created") return "queued";
  if (status === "running" || status === "paused") return "running";
  if (status === "completed") return "completed";
  if (status === "partially_failed" || status === "failed") return "failed";
  return "cancelled";
}

function toUnifiedPageStatus(status: BatchPageManifest["status"]): UnifiedTaskStatus {
  if (status === "draft_queued" || status === "color_queued") return "queued";
  if (status === "draft_generating" || status === "color_generating") return "running";
  if (status === "draft_succeeded" || status === "color_succeeded") return "completed";
  return "failed";
}

export function toBatchSnapshot(manifest: BatchManifest): BatchSnapshot {
  const selectedPages = manifest.pages.filter((page) => manifest.batch.options.selectedPages.includes(page.pageNumber));
  const completedPages = selectedPages.filter((page) => {
    if (manifest.batch.options.generateColored) return page.status === "color_succeeded";
    if (manifest.batch.options.generateDraft) return page.status === "draft_succeeded";
    return true;
  }).length;
  const processingPages = selectedPages.filter((page) => page.status === "draft_generating" || page.status === "color_generating").length;
  const failedPages = selectedPages.filter((page) => page.status === "draft_failed" || page.status === "color_failed").length;
  const totalElapsedMs = manifest.batch.startedAt
    ? Math.max(
        0,
        (manifest.batch.completedAt ? new Date(manifest.batch.completedAt).getTime() : Date.now()) - new Date(manifest.batch.startedAt).getTime(),
      )
    : null;
  const timingValues = selectedPages
    .map((page) => (page.timings.draftMs || 0) + (page.timings.colorMs || 0))
    .filter((value) => value > 0);
  const avgPageMs = timingValues.length > 0
    ? Math.round(timingValues.reduce((sum, value) => sum + value, 0) / timingValues.length)
    : null;

  return {
    batchId: manifest.batch.id,
    sourceFileName: manifest.batch.sourceFileName,
    sourceKind: manifest.batch.sourceKind,
    status: manifest.batch.status,
    unifiedStatus: toUnifiedBatchStatus(manifest.batch.status),
    pageCount: manifest.batch.pageCount,
    selectedPageCount: manifest.batch.selectedPageCount,
    completedPages,
    processingPages,
    failedPages,
    progress: manifest.batch.selectedPageCount > 0 ? Math.round(((completedPages + failedPages) / manifest.batch.selectedPageCount) * 100) : 0,
    totalElapsedMs,
    avgPageMs,
    referenceImageUrl: manifest.batch.referenceImageUrl,
    error: manifest.batch.error,
    recovery: {
      resumable: manifest.batch.status === "running" || manifest.batch.status === "paused",
      canRetryFailedPages: failedPages > 0,
      queuedPages: selectedPages.filter((page) => page.status === "draft_queued" || page.status === "color_queued").length,
      runningPages: processingPages,
      failedPages,
    },
    options: manifest.batch.options,
    pages: manifest.pages
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page) => ({
        page: page.pageNumber,
        title: page.title,
        role: page.role,
        status: page.status,
        unifiedStatus: toUnifiedPageStatus(page.status),
        originalUrl: page.originalUrl,
        draftUrl: page.draftImageUrl,
        coloredUrl: page.coloredImageUrl,
        error: page.error,
        draftAttempts: page.draftAttempts,
        colorAttempts: page.colorAttempts,
        draftMs: page.timings.draftMs ?? null,
        colorMs: page.timings.colorMs ?? null,
        totalMs: (page.timings.draftMs || 0) + (page.timings.colorMs || 0) || null,
      })),
    metrics: {
      draft: {
        queued: selectedPages.filter((page) => page.status === "draft_queued").length,
        running: selectedPages.filter((page) => page.status === "draft_generating").length,
        succeeded: selectedPages.filter((page) => page.status === "draft_succeeded" || page.status === "color_queued" || page.status === "color_generating" || page.status === "color_succeeded" || page.status === "color_failed").length,
        failed: selectedPages.filter((page) => page.status === "draft_failed").length,
      },
      color: {
        queued: selectedPages.filter((page) => page.status === "color_queued").length,
        running: selectedPages.filter((page) => page.status === "color_generating").length,
        succeeded: selectedPages.filter((page) => page.status === "color_succeeded").length,
        failed: selectedPages.filter((page) => page.status === "color_failed").length,
      },
    },
    logs: manifest.batch.logs,
  };
}

export async function fetchPageCountFromPdf(buffer: Buffer): Promise<number> {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}
