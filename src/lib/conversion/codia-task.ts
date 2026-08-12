import { getCodiaTask } from "@/lib/codia/client";
import { updateConversionTask } from "./store";
import type { ConversionTaskRecord, ConversionTaskStatus } from "./types";

type CodiaTaskData = {
  id?: string;
  task_id?: string;
  task_status?: string;
  state?: string;
  status?: string;
  progress?: number;
  output?: unknown;
  result?: Record<string, unknown>;
  error?: string;
  message?: string;
  credits_charged?: number;
  charged_credits?: number;
  credits?: number;
  [key: string]: unknown;
};

type SyncOptions = {
  force?: boolean;
};

export function mapCodiaTaskStatus(status: unknown): ConversionTaskStatus {
  const normalized = typeof status === "string" ? status.toLowerCase() : status;
  switch (normalized) {
    case "pending":
    case "queued":
      return "queued";
    case "processing":
    case "running":
      return "processing";
    case "succeeded":
    case "success":
    case "completed":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "processing";
  }
}

export function isConversionTaskActive(task: ConversionTaskRecord) {
  return ["queued", "processing", "uploading", "estimating"].includes(task.status) || (task.status === "succeeded" && !task.ppt_url);
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "同步 Codia 任务失败";
}

function normalizeTaskData(data: unknown): CodiaTaskData {
  if (!data || typeof data !== "object") return {};
  const obj = data as Record<string, unknown>;
  for (const key of ["task", "item", "record"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object") return nested as CodiaTaskData;
  }
  return obj as CodiaTaskData;
}

function rawCodiaStatus(data: CodiaTaskData) {
  const value = data.status ?? data.state ?? data.task_status;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProgress(value: unknown, fallback: number) {
  const parsed = toNumber(value, fallback);
  if (parsed > 0 && parsed <= 1) return Math.round(parsed * 100);
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function isLikelyPptUrl(value: string) {
  return /^https?:\/\//i.test(value) && (/\.(pptx?|zip)(\?|#|$)/i.test(value) || /pptx?|presentation|download/i.test(value));
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function extractPptUrl(result: unknown): string | null {
  if (!result) return null;

  if (typeof result === "string") {
    return isLikelyPptUrl(result) ? result : null;
  }

  if (Array.isArray(result)) {
    for (const item of result) {
      const found = extractPptUrl(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  const preferredKeys = [
    "ppt_url",
    "pptUrl",
    "pptx_url",
    "pptxUrl",
    "download_url",
    "downloadUrl",
    "output_url",
    "outputUrl",
    "file_url",
    "fileUrl",
    "url",
  ];

  for (const key of preferredKeys) {
    const value = obj[key];
    if (typeof value === "string" && isHttpUrl(value) && (key !== "url" || isLikelyPptUrl(value))) return value;
  }

  for (const value of Object.values(obj)) {
    const found = extractPptUrl(value);
    if (found) return found;
  }

  return null;
}

export async function syncConversionTaskFromCodia(
  task: ConversionTaskRecord,
  apiKey?: string | null,
  baseUrl?: string | null,
  options: SyncOptions = {},
) {
  if (!task.codia_task_id || (!options.force && !isConversionTaskActive(task))) return task;

  const response = await getCodiaTask(task.codia_task_id, apiKey, baseUrl);
  const data = normalizeTaskData(response.data || {});
  const codiaStatus = rawCodiaStatus(data);
  const status = codiaStatus ? mapCodiaTaskStatus(codiaStatus) : task.status;
  const progress = ["succeeded", "failed", "canceled"].includes(status)
    ? 100
    : Math.max(task.progress, normalizeProgress(data.progress, task.progress));
  const pptUrl = extractPptUrl(data.result) || extractPptUrl(data.output) || extractPptUrl(data) || task.ppt_url;
  const error = data.error || data.message || task.error_message;
  const chargedCredits = data.credits_charged ?? data.charged_credits ?? data.credits;

  return updateConversionTask(task.id, task.user_id, {
    status,
    progress,
    ppt_url: pptUrl,
    codia_status: codiaStatus,
    charged_credits: chargedCredits !== undefined ? toNumber(chargedCredits, task.charged_credits ?? 0) : task.charged_credits,
    error_message: status === "failed" || status === "canceled" ? String(error || "转换任务未完成") : null,
    sync_error: null,
    last_synced_at: nowIso(),
  }) || task;
}

export function recordConversionTaskSyncError(task: ConversionTaskRecord, error: unknown) {
  return updateConversionTask(task.id, task.user_id, {
    sync_error: errorMessage(error),
    last_synced_at: nowIso(),
  }) || task;
}
