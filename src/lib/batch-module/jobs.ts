import { saveBinaryFile, saveRemoteImageToLocal } from "@/lib/local-backend";
import { callGenerateApi, type GenerateRequest } from "@/lib/generate-core";
import {
  addLog,
  createManifest,
  finalizeBatchStatus,
  listManifests,
  readManifest,
  toBatchSnapshot,
  updateManifest,
} from "@/lib/batch-module/storage";
import type {
  BatchImportedSlide,
  BatchJobStage,
  BatchManifest,
  BatchPageManifest,
  BatchSnapshot,
  CreateBatchInput,
} from "@/lib/batch-module/types";

type QueueJob = {
  batchId: string;
  pageNumber: number;
  stage: BatchJobStage;
};

let bootstrapOncePromise: Promise<void> | null = null;

class StageQueue {
  private queue: QueueJob[] = [];
  private running = new Map<string, QueueJob>();

  constructor(
    private readonly stage: BatchJobStage,
    private readonly getConcurrency: (manifest: BatchManifest) => number,
    private readonly worker: (job: QueueJob) => Promise<void>,
  ) {}

  enqueue(job: QueueJob) {
    const key = this.keyOf(job);
    if (this.running.has(key) || this.queue.some((item) => this.keyOf(item) === key)) return;
    this.queue.push(job);
    void this.drain();
  }

  removeBatch(batchId: string) {
    this.queue = this.queue.filter((job) => job.batchId !== batchId);
  }

  wake() {
    void this.drain();
  }

  private keyOf(job: QueueJob) {
    return `${job.batchId}:${job.pageNumber}:${job.stage}`;
  }

  private async drain() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const grouped = new Map<string, QueueJob[]>();
      for (const job of this.queue) {
        const list = grouped.get(job.batchId) || [];
        list.push(job);
        grouped.set(job.batchId, list);
      }
      for (const [batchId, jobs] of grouped) {
        const manifest = await readManifest(batchId).catch(() => null);
        if (!manifest || manifest.batch.status === "paused" || manifest.batch.status === "cancelled") continue;
        const currentRunning = Array.from(this.running.values()).filter((job) => job.batchId === batchId).length;
        const allowed = Math.max(1, this.getConcurrency(manifest));
        const capacity = Math.max(0, allowed - currentRunning);
        if (capacity <= 0) continue;
        for (const job of jobs.slice(0, capacity)) {
          const key = this.keyOf(job);
          const index = this.queue.findIndex((item) => this.keyOf(item) === key);
          if (index === -1) continue;
          this.queue.splice(index, 1);
          this.running.set(key, job);
          progressed = true;
          this.worker(job)
            .catch((error) => {
              console.error(`[batch-${this.stage}]`, error);
            })
            .finally(() => {
              this.running.delete(key);
              void this.drain();
            });
        }
      }
    }
  }
}

function buildDraftPrompt(page: BatchPageManifest, manifest: BatchManifest): string {
  const extras = [
    manifest.batch.options.stylePrompt,
    manifest.batch.options.draftPrompt,
  ].filter(Boolean).join("\n");
  return [
    `请为一页 PPT ${page.role || "内容页"}生成黑白灰素稿，页面比例 ${manifest.batch.options.aspectRatio}。`,
    `页面：第 ${page.pageNumber} 页，标题：${page.title}。`,
    "本阶段只确定版式结构、阅读动线、信息层级、图片占位、留白和页面节奏。",
    "必须是黑白灰或低饱和灰阶，不要彩色，不要最终质感，不要复杂光影。",
    "原稿图只用于理解内容，不能照搬原稿旧背景、旧装饰和旧版式。",
    "文字、数字、logo、已有图片素材必须来自原稿，不得新增、删减、改写或替换。",
    page.sourceText ? `原稿文字摘要：${page.sourceText}` : "原稿文字未自动解析，请严格依据原稿图片中的文字和素材。",
    extras,
  ].filter(Boolean).join("\n");
}

function buildColorPrompt(page: BatchPageManifest, manifest: BatchManifest): string {
  const extras = [
    manifest.batch.options.stylePrompt,
    manifest.batch.options.colorPrompt,
  ].filter(Boolean).join("\n");
  return [
    `请为一页 PPT ${page.role || "内容页"}生成彩色成稿，页面比例 ${manifest.batch.options.aspectRatio}。`,
    `页面：第 ${page.pageNumber} 页，标题：${page.title}。`,
    "上色阶段必须沿用已确认的黑白灰素稿版式结构、层级、留白和阅读动线，只补充色彩体系、材质、背景和最终视觉完成度。",
    "原稿页面是唯一内容来源。文字、数字、logo、已有图片素材必须完全保留，不得新增、删减、改写或替换。",
    "参考图只能作为风格参考，只能学习色彩、光感、材质、构图和氛围，严禁复制参考图中的文字、logo、元素、人物、产品和素材主体。",
    page.sourceText ? `原稿文字摘要：${page.sourceText}` : "原稿文字未自动解析，请严格依据原稿图片中的文字和素材。",
    extras,
  ].filter(Boolean).join("\n");
}

function buildRequest(manifest: BatchManifest, prompt: string, referenceImages: string[]): GenerateRequest {
  return {
    prompt,
    size: manifest.batch.options.aspectRatio,
    apiKey: manifest.batch.generation.apiKey,
    baseUrl: manifest.batch.generation.baseUrl,
    model: manifest.batch.generation.model,
    imageSize: manifest.batch.generation.imageSize,
    referenceImages,
  };
}

async function saveGeneratedFile(batchId: string, pageNumber: number, stage: BatchJobStage, generated: { imageUrl?: string; imageBuffer?: Buffer; error?: string }) {
  if (generated.error) {
    throw new Error(generated.error);
  }
  if (generated.imageBuffer) {
    return saveBinaryFile(generated.imageBuffer, `batch_${batchId}_${stage}_${String(pageNumber).padStart(3, "0")}.png`, "image/png");
  }
  if (generated.imageUrl) {
    const saved = await saveRemoteImageToLocal(generated.imageUrl, `batch_${batchId}_${stage}_${String(pageNumber).padStart(3, "0")}`);
    if (saved) return saved;
    return { key: null, url: generated.imageUrl } as { key: string | null; url: string };
  }
  throw new Error("没有返回可用图片");
}

function getPageOrThrow(manifest: BatchManifest, pageNumber: number): BatchPageManifest {
  const page = manifest.pages.find((item) => item.pageNumber === pageNumber);
  if (!page) throw new Error(`第 ${pageNumber} 页不存在`);
  return page;
}

async function settleBatch(batchId: string) {
  await updateManifest(batchId, (manifest) => {
    finalizeBatchStatus(manifest);
    if (manifest.batch.status === "completed" || manifest.batch.status === "partially_failed" || manifest.batch.status === "failed") {
      addLog(manifest, {
        at: new Date().toISOString(),
        level: manifest.batch.status === "completed" ? "info" : "warn",
        stage: "rendering",
        status: manifest.batch.status,
        message: `批量任务已结束，状态：${manifest.batch.status}。`,
      });
    }
  });
}

async function handleJobFailure(job: QueueJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const manifest = await updateManifest(job.batchId, (current) => {
    const page = getPageOrThrow(current, job.pageNumber);
    const attempts = job.stage === "draft_generation" ? page.draftAttempts : page.colorAttempts;
    const retryLimit = current.batch.options.retryLimit;
    const shouldRetry = attempts <= retryLimit;
    page.updatedAt = new Date().toISOString();
    page.error = shouldRetry ? `${message}，准备自动重试 ${attempts}/${retryLimit}` : message;
    if (job.stage === "draft_generation") {
      page.status = shouldRetry ? "draft_queued" : "draft_failed";
    } else {
      page.status = shouldRetry ? "color_queued" : "color_failed";
    }
    addLog(current, {
      at: new Date().toISOString(),
      level: shouldRetry ? "warn" : "error",
      stage: job.stage,
      page: job.pageNumber,
      status: shouldRetry ? "retrying" : "failed",
      error: message,
      message: `第 ${job.pageNumber} 页${job.stage === "draft_generation" ? "素稿" : "上色"}失败：${page.error}`,
    });
  });

  const page = getPageOrThrow(manifest, job.pageNumber);
  if (page.status === "draft_queued") {
    draftQueue.enqueue(job);
  } else if (page.status === "color_queued") {
    colorQueue.enqueue(job);
  } else {
    await settleBatch(job.batchId);
  }
}

async function runDraftJob(job: QueueJob) {
  const startedAt = Date.now();
  const manifest = await updateManifest(job.batchId, (current) => {
    const page = getPageOrThrow(current, job.pageNumber);
    page.status = "draft_generating";
    page.draftAttempts += 1;
    page.error = undefined;
    page.updatedAt = new Date().toISOString();
    current.batch.status = "running";
    addLog(current, {
      at: new Date().toISOString(),
      level: "info",
      stage: "draft_generation",
      page: job.pageNumber,
      status: "started",
      message: `第 ${job.pageNumber} 页开始生成黑白灰素稿。`,
    });
  });

  try {
    const page = getPageOrThrow(manifest, job.pageNumber);
    const prompt = buildDraftPrompt(page, manifest);
    const generated = await callGenerateApi(buildRequest(manifest, prompt, [page.originalUrl]), prompt, manifest.batch.options.aspectRatio, [page.originalUrl]);
    const saved = await saveGeneratedFile(job.batchId, job.pageNumber, "draft_generation", generated);
    await updateManifest(job.batchId, (current) => {
      const currentPage = getPageOrThrow(current, job.pageNumber);
      currentPage.status = current.batch.options.generateColored ? "color_queued" : "draft_succeeded";
      currentPage.draftImageUrl = saved.url;
      currentPage.draftImageKey = saved.key || undefined;
      currentPage.timings.draftMs = Date.now() - startedAt;
      currentPage.updatedAt = new Date().toISOString();
      currentPage.completedAt = current.batch.options.generateColored ? undefined : new Date().toISOString();
      addLog(current, {
        at: new Date().toISOString(),
        level: "info",
        stage: "draft_generation",
        page: job.pageNumber,
        status: "succeeded",
        message: `第 ${job.pageNumber} 页黑白灰素稿生成完成。`,
      });
    });

    const current = await readManifest(job.batchId);
    if (current.batch.options.generateColored) {
      colorQueue.enqueue({ batchId: job.batchId, pageNumber: job.pageNumber, stage: "colorization" });
    } else {
      await settleBatch(job.batchId);
    }
  } catch (error) {
    await handleJobFailure(job, error);
  }
}

async function runColorJob(job: QueueJob) {
  const startedAt = Date.now();
  const manifest = await updateManifest(job.batchId, (current) => {
    const page = getPageOrThrow(current, job.pageNumber);
    page.status = "color_generating";
    page.colorAttempts += 1;
    page.error = undefined;
    page.updatedAt = new Date().toISOString();
    current.batch.status = "running";
    addLog(current, {
      at: new Date().toISOString(),
      level: "info",
      stage: "colorization",
      page: job.pageNumber,
      status: "started",
      message: `第 ${job.pageNumber} 页开始生成彩色成稿。`,
    });
  });

  try {
    const page = getPageOrThrow(manifest, job.pageNumber);
    const prompt = buildColorPrompt(page, manifest);
    const refs = [page.draftImageUrl || page.originalUrl, page.originalUrl, manifest.batch.referenceImageUrl].filter(Boolean) as string[];
    const generated = await callGenerateApi(buildRequest(manifest, prompt, refs), prompt, manifest.batch.options.aspectRatio, refs);
    const saved = await saveGeneratedFile(job.batchId, job.pageNumber, "colorization", generated);
    await updateManifest(job.batchId, (current) => {
      const currentPage = getPageOrThrow(current, job.pageNumber);
      currentPage.status = "color_succeeded";
      currentPage.coloredImageUrl = saved.url;
      currentPage.coloredImageKey = saved.key || undefined;
      currentPage.timings.colorMs = Date.now() - startedAt;
      currentPage.updatedAt = new Date().toISOString();
      currentPage.completedAt = new Date().toISOString();
      addLog(current, {
        at: new Date().toISOString(),
        level: "info",
        stage: "colorization",
        page: job.pageNumber,
        status: "succeeded",
        message: `第 ${job.pageNumber} 页彩色成稿生成完成。`,
      });
    });
    await settleBatch(job.batchId);
  } catch (error) {
    await handleJobFailure(job, error);
  }
}

const draftQueue = new StageQueue(
  "draft_generation",
  (manifest) => Math.max(1, manifest.batch.options.draftConcurrency),
  runDraftJob,
);
const colorQueue = new StageQueue(
  "colorization",
  (manifest) => Math.max(1, manifest.batch.options.colorConcurrency),
  runColorJob,
);

function enqueuePendingJobs(manifest: BatchManifest) {
  for (const page of manifest.pages) {
    if (!manifest.batch.options.selectedPages.includes(page.pageNumber)) continue;
    if (page.status === "draft_queued") {
      draftQueue.enqueue({ batchId: manifest.batch.id, pageNumber: page.pageNumber, stage: "draft_generation" });
    }
    if (page.status === "color_queued") {
      colorQueue.enqueue({ batchId: manifest.batch.id, pageNumber: page.pageNumber, stage: "colorization" });
    }
  }
}

async function ensureQueuesBootstrapped(): Promise<void> {
  if (!bootstrapOncePromise) {
    bootstrapOncePromise = bootstrapUnfinishedBatches().catch((error) => {
      console.error("[batch-bootstrap]", error);
    });
  }
  await bootstrapOncePromise;
}

async function readOwnedManifest(batchId: string, userId: string | null): Promise<BatchManifest> {
  const manifest = await readManifest(batchId);
  if (manifest.batch.userId !== userId) {
    throw new Error("BATCH_ACCESS_DENIED");
  }
  return manifest;
}

export async function listBatchSnapshots(userId: string | null): Promise<BatchSnapshot[]> {
  await ensureQueuesBootstrapped();
  const manifests = await listManifests(userId);
  return manifests.map((manifest) => toBatchSnapshot(manifest));
}

export async function createBatch(input: CreateBatchInput): Promise<BatchSnapshot> {
  if (!input.generation.apiKey && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(input.generation.baseUrl || "")) {
    throw new Error("请先配置图片模型 API Key");
  }
  const manifest = await createManifest(input);
  enqueuePendingJobs(manifest);
  return toBatchSnapshot(manifest);
}

export async function getBatchSnapshot(batchId: string): Promise<BatchSnapshot> {
  await ensureQueuesBootstrapped();
  return toBatchSnapshot(await readManifest(batchId));
}

export async function getBatchSnapshotForUser(batchId: string, userId: string | null): Promise<BatchSnapshot> {
  await ensureQueuesBootstrapped();
  return toBatchSnapshot(await readOwnedManifest(batchId, userId));
}

export async function pauseBatch(batchId: string): Promise<BatchSnapshot> {
  const manifest = await updateManifest(batchId, (current) => {
    if (current.batch.status !== "cancelled") {
      current.batch.status = "paused";
      addLog(current, {
        at: new Date().toISOString(),
        level: "warn",
        stage: "rendering",
        status: "paused",
        message: "批量任务已暂停，正在运行的页面会执行完，但不会继续启动新任务。",
      });
    }
  });
  return toBatchSnapshot(manifest);
}

export async function pauseBatchForUser(batchId: string, userId: string | null): Promise<BatchSnapshot> {
  await readOwnedManifest(batchId, userId);
  return pauseBatch(batchId);
}

export async function resumeBatch(batchId: string): Promise<BatchSnapshot> {
  const manifest = await updateManifest(batchId, (current) => {
    if (current.batch.status === "cancelled") return;
    current.batch.status = "running";
    current.batch.completedAt = undefined;
    current.batch.error = undefined;
    for (const page of current.pages) {
      if (page.status === "draft_generating") page.status = "draft_queued";
      if (page.status === "color_generating") page.status = "color_queued";
    }
    addLog(current, {
      at: new Date().toISOString(),
      level: "info",
      stage: "rendering",
      status: "running",
      message: "批量任务已继续。",
    });
  });
  enqueuePendingJobs(manifest);
  return toBatchSnapshot(manifest);
}

export async function resumeBatchForUser(batchId: string, userId: string | null): Promise<BatchSnapshot> {
  await readOwnedManifest(batchId, userId);
  return resumeBatch(batchId);
}

export async function cancelBatch(batchId: string): Promise<BatchSnapshot> {
  draftQueue.removeBatch(batchId);
  colorQueue.removeBatch(batchId);
  const manifest = await updateManifest(batchId, (current) => {
    current.batch.status = "cancelled";
    current.batch.completedAt = new Date().toISOString();
    addLog(current, {
      at: new Date().toISOString(),
      level: "warn",
      stage: "rendering",
      status: "cancelled",
      message: "批量任务已停止，未启动的队列已清空。",
    });
  });
  return toBatchSnapshot(manifest);
}

export async function cancelBatchForUser(batchId: string, userId: string | null): Promise<BatchSnapshot> {
  await readOwnedManifest(batchId, userId);
  return cancelBatch(batchId);
}

export async function retryFailedPages(batchId: string): Promise<BatchSnapshot> {
  const manifest = await updateManifest(batchId, (current) => {
    current.batch.status = "running";
    current.batch.completedAt = undefined;
    current.batch.error = undefined;
    for (const page of current.pages) {
      if (page.status === "draft_failed") {
        page.status = "draft_queued";
        page.error = undefined;
      }
      if (page.status === "color_failed") {
        page.status = page.draftImageUrl ? "color_queued" : "draft_queued";
        page.error = undefined;
      }
    }
    addLog(current, {
      at: new Date().toISOString(),
      level: "info",
      stage: "rendering",
      message: "已把失败页面重新加入队列。",
    });
  });
  enqueuePendingJobs(manifest);
  return toBatchSnapshot(manifest);
}

export async function retryFailedPagesForUser(batchId: string, userId: string | null): Promise<BatchSnapshot> {
  await readOwnedManifest(batchId, userId);
  return retryFailedPages(batchId);
}

export async function retryPage(batchId: string, pageNumber: number, stage: BatchJobStage): Promise<BatchSnapshot> {
  const manifest = await updateManifest(batchId, (current) => {
    current.batch.status = "running";
    current.batch.completedAt = undefined;
    const page = getPageOrThrow(current, pageNumber);
    page.error = undefined;
    page.updatedAt = new Date().toISOString();
    if (stage === "draft_generation") {
      page.status = "draft_queued";
      page.draftAttempts = 0;
      page.colorAttempts = 0;
      page.draftImageUrl = undefined;
      page.draftImageKey = undefined;
      page.coloredImageUrl = undefined;
      page.coloredImageKey = undefined;
      page.timings = {};
    } else {
      if (!page.draftImageUrl && !page.originalUrl) {
        throw new Error("该页面没有可用于上色的素稿");
      }
      page.status = "color_queued";
      page.colorAttempts = 0;
      page.coloredImageUrl = undefined;
      page.coloredImageKey = undefined;
      page.timings.colorMs = undefined;
    }
    addLog(current, {
      at: new Date().toISOString(),
      level: "info",
      stage,
      page: pageNumber,
      status: "queued",
      message: `第 ${pageNumber} 页已加入${stage === "draft_generation" ? "素稿" : "上色"}重试队列。`,
    });
  });
  if (stage === "draft_generation") {
    draftQueue.enqueue({ batchId, pageNumber, stage });
  } else {
    colorQueue.enqueue({ batchId, pageNumber, stage });
  }
  return toBatchSnapshot(manifest);
}

export async function retryPageForUser(batchId: string, userId: string | null, pageNumber: number, stage: BatchJobStage): Promise<BatchSnapshot> {
  await readOwnedManifest(batchId, userId);
  return retryPage(batchId, pageNumber, stage);
}

export async function bootstrapUnfinishedBatches() {
  const manifests = await listManifests(undefined).catch(() => []);
  for (const manifest of manifests) {
    if (manifest.batch.status !== "running" && manifest.batch.status !== "paused") continue;

    const recovered = await updateManifest(manifest.batch.id, (current) => {
      let recoveredPages = 0;
      for (const page of current.pages) {
        if (page.status === "draft_generating") {
          page.status = "draft_queued";
          page.updatedAt = new Date().toISOString();
          recoveredPages += 1;
        } else if (page.status === "color_generating") {
          page.status = "color_queued";
          page.updatedAt = new Date().toISOString();
          recoveredPages += 1;
        }
      }

      if (recoveredPages > 0) {
        addLog(current, {
          at: new Date().toISOString(),
          level: "warn",
          stage: "rendering",
          status: "recovered",
          message: `检测到服务重启，已恢复 ${recoveredPages} 个处理中页面到队列。`,
        });
      }
    }).catch(() => manifest);

    enqueuePendingJobs(recovered);
  }
}
