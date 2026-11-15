import {
  createImageRecord,
  getImageRecordById,
  isLocalBackendEnabled,
  saveBinaryFile,
  saveRemoteImageToLocal,
  updateImageRecord,
} from "@/lib/local-backend";
import { getReferenceImageLimitForModel } from "@/lib/image-edit/reference-constants";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { prepareReferenceImagesForModel } from "@/lib/image-edit/reference-prep";
import { VIP_PIXEL_SIZES } from "@/lib/types";
import type { LlmGenerationRequestPreview } from "@/lib/llm-preview";

export interface GenerateRequest {
  signal?: AbortSignal;
  prompt: string;
  size?: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  imageSize?: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  moderation?: string;
  projectId?: string;
  userId?: string;
  referenceImages?: string[];
  canvasBlockId?: string;
  blockOrder?: number;
  canvas_x?: number;
  canvas_y?: number;
  canvas_width?: number;
  canvas_height?: number;
  expandComposite?: ExpandComposite;
}

export interface ExpandComposite {
  originalImageUrl: string;
  expandLeft: number;
  expandTop: number;
  expandRight: number;
  expandBottom: number;
  imageOffsetX: number;
  imageOffsetY: number;
  originalCanvasWidth: number;
  originalCanvasHeight: number;
}

export interface GenerateResult {
  success: boolean;
  record?: {
    id: string;
    image_url: string;
    prompt: string;
    model: string;
    size: string;
    status: string;
    canvas_x: number;
    canvas_y: number;
    canvas_width: number;
    canvas_height: number;
    project_id: string | null;
    is_favorite: boolean;
    created_at: string;
    updated_at: string | null;
  };
  requestPreview?: LlmGenerationRequestPreview;
  error?: string;
}

interface GrsaiResponse {
  id: string;
  status: string;
  results?: { url: string }[];
  progress?: number;
  error?: string;
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

interface CodiaImageResponse {
  code?: number;
  message?: string;
  data?: {
    image_urls?: string[];
    images?: Array<{ url?: string } | string>;
    url?: string;
  };
}

function dataUrlToFile(value: string, fallbackName: string): File | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
  const buffer = Buffer.from(match[2], "base64");
  return new File([new Uint8Array(buffer)], `${fallbackName}.${ext}`, { type: mime });
}

async function referenceToFile(value: string, index: number): Promise<File> {
  const fromDataUrl = dataUrlToFile(value, `reference-${index + 1}`);
  if (fromDataUrl) return fromDataUrl;

  const res = await fetch(value);
  if (!res.ok) throw new Error(`参考图下载失败 (${res.status})`);
  const contentType = res.headers.get("content-type") || "image/png";
  const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new File([bytes], `reference-${index + 1}.${ext}`, { type: contentType });
}

async function buildOpenAiImageEditFormData(input: {
  model?: string;
  prompt: string;
  size: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  moderation?: string;
  references: string[];
}) {
  const form = new FormData();
  form.append("model", input.model || "gpt-image-1");
  form.append("prompt", input.prompt);
  form.append("size", input.size);
  if (input.quality) form.append("quality", input.quality);
  if (input.background && input.background !== "auto") form.append("background", input.background);
  if (input.outputFormat) form.append("output_format", input.outputFormat);
  if (input.moderation && input.moderation !== "auto") form.append("moderation", input.moderation);
  form.append("response_format", "b64_json");
  form.append("n", "1");
  const files = await Promise.all(input.references.map((ref, index) => referenceToFile(ref, index)));
  files.forEach((file) => form.append("image", file));
  return form;
}

const GENERATE_POLL_INTERVALS_MS = [
  800, 1000, 1200, 1500, 1800, 2200, 2500, 3000,
  3500, 4000, 4500, 5000, 5500, 6000, 7000, 8000,
];
const GENERATE_POLL_TIMEOUT_MS = 6 * 60_000;
const GENERATE_RETRY_DELAYS_MS = [3_000, 8_000, 15_000];

const GRS_SUCCESS_STATUSES = new Set(["succeeded", "completed", "success"]);
const GRS_PENDING_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "processing",
  "submitted",
  "in_progress",
  "in-progress",
  "starting",
  "created",
]);
const GRS_FAILURE_STATUSES = new Set([
  "failed",
  "violation",
  "rejected",
  "error",
  "cancelled",
  "canceled",
]);

const SUPPORTED_RATIOS = [
  { label: "1:1", w: 1, h: 1 },
  { label: "16:9", w: 16, h: 9 },
  { label: "9:16", w: 9, h: 16 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:4", w: 3, h: 4 },
  { label: "3:2", w: 3, h: 2 },
  { label: "2:3", w: 2, h: 3 },
  { label: "5:4", w: 5, h: 4 },
  { label: "4:5", w: 4, h: 5 },
  { label: "21:9", w: 21, h: 9 },
  { label: "9:21", w: 9, h: 21 },
  { label: "2:1", w: 2, h: 1 },
  { label: "1:2", w: 1, h: 2 },
  { label: "3:1", w: 3, h: 1 },
  { label: "1:3", w: 1, h: 3 },
  { label: "1:4", w: 1, h: 4 },
  { label: "4:1", w: 4, h: 1 },
  { label: "1:8", w: 1, h: 8 },
  { label: "8:1", w: 8, h: 1 },
];

function toRatioSize(size?: string): string {
  if (!size) return "1:1";
  const trimmed = size.trim();
  if (/^\d+\s*[xX]\s*\d+$/.test(trimmed) || trimmed === "auto") return trimmed;
  if (!trimmed.includes(":")) return "1:1";
  const [w, h] = trimmed.split(":").map((n) => parseInt(n, 10));
  if (!w || !h) return "1:1";
  const base = 1024;
  if (w === h) return "1024x1024";
  if (w > h) {
    const nh = Math.round((base * h) / w / 64) * 64;
    return `${base}x${Math.max(256, nh)}`;
  }
  const nw = Math.round((base * w) / h / 64) * 64;
  return `${Math.max(256, nw)}x${base}`;
}

/**
 * Resolve a valid `size` for OpenAI-compatible image endpoints
 * (/v1/images/generations and /v1/images/edits). Pixel values (e.g. 1536x1024)
 * pass through unchanged; aspect ratios are mapped to the closest size the
 * target model actually accepts, so upstream no longer silently falls back to
 * "auto" (which can produce a wrong aspect ratio).
 */
const GRSAI_STD_RATIO_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1672x941",
  "9:16": "941x1672",
  "4:3": "1443x1090",
  "3:4": "1090x1443",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "5:4": "1408x1120",
  "4:5": "1120x1408",
  "21:9": "1920x832",
  "9:21": "832x1920",
  "2:1": "1792x896",
  "1:2": "896x1792",
};
const VIP_1K_BY_RATIO: Record<string, string> = {};
for (const item of VIP_PIXEL_SIZES) {
  if (!item.label.startsWith("1K")) continue;
  const m = item.label.match(/·\s*(\d+:\d+)/);
  if (m) VIP_1K_BY_RATIO[m[1]] = item.value;
}
function ratioToExactPixel(ratio?: string): string | null {
  const raw = (ratio || "").trim().toLowerCase();
  if (/^\d+\s*[xX]\s*\d+$/.test(raw)) return raw;
  if (VIP_1K_BY_RATIO[raw]) return VIP_1K_BY_RATIO[raw];
  const m = raw.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
  if (!w || !h) return null;
  let pw = 1024, ph = 1024;
  if (w >= h) {
    ph = Math.max(16, Math.round((1024 * h) / w / 16) * 16);
    pw = Math.max(16, Math.round((ph * w) / h / 16) * 16);
  } else {
    pw = Math.max(16, Math.round((1024 * w) / h / 16) * 16);
    ph = Math.max(16, Math.round((pw * h) / w / 16) * 16);
  }
  pw = Math.min(3840, pw); ph = Math.min(3840, ph);
  return `${pw}x${ph}`;
}
function grsRatioToPixel(model?: string, size?: string): string | null {
  const raw = (size || "").trim().toLowerCase();
  if (/^\d+\s*[xX]\s*\d+$/.test(raw)) return raw;
  const mid = (model || "").toLowerCase();
  if (/(vip|4k|flare|sunburst)/.test(mid)) return ratioToExactPixel(raw);
  if (/(gpt-image|gpt_image)/.test(mid)) {
    return GRSAI_STD_RATIO_MAP[raw] || ratioToExactPixel(raw);
  }
  return ratioToExactPixel(raw);
}
function toOpenAiImageSize(model: string | undefined, size?: string): string {
  const raw = (size || "").trim();
  if (!raw) return "1024x1024";
  if (/^\d+\s*[xX]\s*\d+$/.test(raw) || raw === "auto") return raw;
  if (!raw.includes(":")) return "1024x1024";
  const [wRaw, hRaw] = raw.split(":").map((n) => parseInt(n, 10));
  if (!wRaw || !hRaw) return "1024x1024";

  const mid = (model || "").toLowerCase();
  if (/(dall-e-3|dalle-3|dall_e_3)/.test(mid)) {
    if (wRaw === hRaw) return "1024x1024";
    return wRaw > hRaw ? "1792x1024" : "1024x1792";
  }
  if (/(dall-e-2|dalle-2|dall_e_2)/.test(mid)) return "1024x1024";
  // gpt-image family and generic image models: map ratio to an exact-ratio pixel size
  if (wRaw === hRaw) return "1024x1024";
  return ratioToExactPixel(raw) || (wRaw > hRaw ? "1536x1024" : "1024x1536");
}

function normalizeChatBase(baseUrl?: string): string {
  const clean = (baseUrl || "https://grsaiapi.com").replace(/\/+$/, "");
  if (clean.endsWith("/v1")) return clean.slice(0, -3);
  return clean;
}

function normalizeCodiaBase(baseUrl?: string): string {
  const clean = (baseUrl || "https://api.codia.ai").replace(/\/+$/, "");
  return clean
    .replace(/\/v1$/i, "")
    .replace(/\/v2\/open(?:\/.*)?$/i, "");
}

function isCodiaOpenApiEndpoint(url?: string): boolean {
  try {
    const parsed = new URL((url || "").trim());
    const host = parsed.hostname.toLowerCase();
    return host === "api.codia.ai" || host === "codia.ai" || host.endsWith(".codia.ai");
  } catch {
    return /(^|\/\/|\.)(api\.)?codia\.ai/i.test(url || "");
  }
}

const GRSAI_IMAGE2_MODEL_RE = /^gpt-image-2(?:\.5)?(?:-(?:vip|flare|sunburst))?$/;
const GRSAI_IMAGE_QUALITY_BY_MODEL: Record<string, string[]> = {
  "gpt-image-2": ["auto"],
  "gpt-image-2.5": ["auto"],
  "gpt-image-2-vip": ["medium"],
  "gpt-image-2.5-flare": ["low", "medium", "high"],
  "gpt-image-2.5-sunburst": ["low", "medium", "high", "xhigh", "max"],
};

function normalizeGrsaiModelId(model?: string): string {
  return (model || "").trim().toLowerCase();
}

function resolveGrsaiImageQuality(model?: string, requested?: string): string | undefined {
  const allowed = GRSAI_IMAGE_QUALITY_BY_MODEL[normalizeGrsaiModelId(model)];
  if (!allowed?.length) return undefined;
  const value = (requested || "").trim().toLowerCase();
  return allowed.includes(value) ? value : allowed[0];
}

function resolveGrsaiImageBackground(model?: string, requested?: string): "transparent" | undefined {
  const id = normalizeGrsaiModelId(model);
  const supportsTransparent =
    id === "gpt-image-2-vip" ||
    id === "gpt-image-2.5-flare" ||
    id === "gpt-image-2.5-sunburst";
  return supportsTransparent && (requested || "").trim().toLowerCase() === "transparent"
    ? "transparent"
    : undefined;
}

function isLocalEndpoint(url?: string): boolean {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function normalizeGrsStatus(status?: string): string {
  return (status || "").trim().toLowerCase();
}

function getGrsResultUrl(data?: GrsaiResponse): string | undefined {
  return data?.results?.find((item) => typeof item?.url === "string" && item.url.trim())?.url;
}

function isGrsFailureStatus(status?: string): boolean {
  return GRS_FAILURE_STATUSES.has(normalizeGrsStatus(status));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely read a JSON response body. If the body is empty or not valid JSON
 * (e.g. an upstream gateway returned 200 with no content), return a readable
 * error instead of throwing "Unexpected end of JSON input".
 */
async function readJsonResponse<T>(res: Response, context: string): Promise<{ data?: T; error?: string }> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) {
    return { error: `${context} 返回空响应 (HTTP ${res.status})` };
  }
  try {
    return { data: JSON.parse(text) as T };
  } catch {
    return { error: `${context} 返回非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}` };
  }
}

function normalizeCodiaModelId(model?: string | null): string {
  const raw = (model || "").trim();
  const normalized = raw.toLowerCase().replace(/-/g, "_");
  if (!normalized || normalized === "gpt_image_2" || normalized === "gpt_image_1" || normalized === "gpt_image") return "gpt_image";
  if (normalized === "nano_banana" || normalized === "nano_banana_2") return "nano_banana_2";
  if (normalized === "nano_banana_pro") return "nano_banana_pro";
  return normalized;
}

function extractCodiaImageUrl(payload: CodiaImageResponse): string | undefined {
  const urls = payload.data?.image_urls;
  if (Array.isArray(urls)) {
    const found = urls.find((item) => typeof item === "string" && item.trim());
    if (found) return found;
  }
  const images = payload.data?.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === "string" && image.trim()) return image;
      if (image && typeof image === "object" && typeof image.url === "string" && image.url.trim()) return image.url;
    }
  }
  if (typeof payload.data?.url === "string" && payload.data.url.trim()) return payload.data.url;
  return undefined;
}

function isRetryableGenerateError(error?: string): boolean {
  const text = (error || "").toLowerCase();
  if (!text) return false;
  if (
    /policy|violation|safety|image upload failed|unknown parameter|invalid_request|unauthorized|forbidden/.test(text)
  ) {
    return false;
  }
  return (
    /fetch failed|network|socket hang up|econn|enotfound|etimedout|timeout/.test(text) ||
    /excessive system load|upstream load|load is saturated|saturated|overload|too many requests|rate limit|429/.test(text) ||
    /generate failed|task failed|status.?failed|生成失败|任务失败|模型.*维护|维护中|服务繁忙|busy|overloaded/.test(text) ||
    /轮询请求失败|生成超时|无法连接|请求过于频繁|限流|上游负载|系统负载|空响应/.test(error || "") ||
    /生图接口错误 \(5\d\d\)/.test(error || "")
  );
}

function buildFailedRecordPrompt(prompt: string, error: string): string {
  const cleanPrompt = prompt.trim() || "生成任务";
  const cleanError = error.trim();
  if (!cleanError || cleanPrompt.includes(cleanError)) return cleanPrompt;
  return `${cleanPrompt}\n${cleanError}`;
}

function shouldPollGrsTask(data: GrsaiResponse): boolean {
  if (!data.id || isGrsFailureStatus(data.status)) return false;
  const status = normalizeGrsStatus(data.status);
  const imageUrl = getGrsResultUrl(data);
  if (imageUrl) return false;
  if (!status) return true;
  return GRS_PENDING_STATUSES.has(status) || GRS_SUCCESS_STATUSES.has(status) || !GRS_FAILURE_STATUSES.has(status);
}

function findClosestSupportedRatio(targetW: number, targetH: number): { label: string; ratio: number; coverScale: number } {
  const targetRatio = targetW / targetH;
  const covering: { label: string; ratio: number; wasteRatio: number; coverScale: number }[] = [];

  for (const r of SUPPORTED_RATIOS) {
    const ratio = r.w / r.h;
    let scaledW: number;
    let scaledH: number;
    if (ratio >= targetRatio) {
      scaledH = targetH;
      scaledW = ratio * targetH;
    } else {
      scaledW = targetW;
      scaledH = targetW / ratio;
    }
    if (scaledW >= targetW - 1 && scaledH >= targetH - 1) {
      const wasteRatio = (scaledW * scaledH) / (targetW * targetH);
      covering.push({ label: r.label, ratio, wasteRatio, coverScale: scaledW / targetW });
    }
  }

  if (covering.length === 0) {
    let best = SUPPORTED_RATIOS[0];
    let bestDiff = Infinity;
    for (const r of SUPPORTED_RATIOS) {
      const diff = Math.abs(r.w / r.h - targetRatio);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = r;
      }
    }
    return { label: best.label, ratio: best.w / best.h, coverScale: 1 };
  }

  covering.sort((a, b) => a.wasteRatio - b.wasteRatio);
  return { label: covering[0].label, ratio: covering[0].ratio, coverScale: covering[0].coverScale };
}

export async function callGenerateApi(
  req: GenerateRequest,
  effectivePrompt: string,
  effectiveSize: string,
  effectiveReferenceImages: string[],
): Promise<{ imageUrl?: string; imageBuffer?: Buffer; requestPreview?: LlmGenerationRequestPreview; error?: string }> {
  const { apiKey, baseUrl, model, imageSize, quality, background, outputFormat, moderation } = req;
  const cleanApiKey = apiKey.replace(/^Bearer\s+/i, "").trim();
  const base = normalizeChatBase(baseUrl);
  const preparedReferences = await prepareReferenceImagesForModel(effectiveReferenceImages, {
    maxCount: getReferenceImageLimitForModel(model),
  });
  const previewReferenceImages = preparedReferences.items.map((item) => {
    const value = item.value.startsWith("data:")
      ? `[${item.value.match(/^data:([^;]+);base64,/)?.[1] || "image"} data url omitted]`
      : item.value;
    return item.original === item.value ? value : `${item.original} -> ${value}`;
  });

  const aspectRatioValue = (model || "").startsWith("nano-banana") ? effectiveSize : grsRatioToPixel(model, effectiveSize) || effectiveSize;
  const requestBody: Record<string, unknown> = {
    model: model || "gpt-image-2",
    prompt: effectivePrompt,
    images: preparedReferences.references,
    // Async submission avoids upstream gateway timeouts for 2K/4K jobs and
    // lets us poll the documented /v1/api/result endpoint instead.
    replyType: "async",
    aspectRatio: aspectRatioValue,
  };

  if ((model || "").startsWith("nano-banana")) {
    requestBody.imageSize = imageSize || "1K";
  }
  if (GRSAI_IMAGE2_MODEL_RE.test(normalizeGrsaiModelId(model))) {
    const resolvedQuality = resolveGrsaiImageQuality(model, quality);
    const resolvedBackground = resolveGrsaiImageBackground(model, background);
    if (resolvedQuality) requestBody.quality = resolvedQuality;
    if (resolvedBackground) requestBody.background = resolvedBackground;
  }
  if (outputFormat) requestBody.output_format = outputFormat;
  if (moderation && moderation !== "auto") requestBody.moderation = moderation;

  let requestPreview: LlmGenerationRequestPreview = {
    index: 0,
    prompt: effectivePrompt,
    model: model || "gpt-image-2",
    baseUrl: base,
    apiKey: cleanApiKey,
    endpoint: `${base}/v1/api/generate`,
    size: effectiveSize,
    imageSize: (model || "").startsWith("nano-banana") ? imageSize || "1K" : undefined,
    referenceImages: previewReferenceImages,
    requestBody: {
      ...requestBody,
      images: previewReferenceImages,
    },
  };

  if (isCodiaOpenApiEndpoint(baseUrl)) {
    const codiaBase = normalizeCodiaBase(baseUrl);
    const codiaModel = normalizeCodiaModelId(model);
    const codiaBody: Record<string, unknown> = {
      prompt: effectivePrompt,
      n: 1,
      size: toRatioSize(effectiveSize),
      model: codiaModel,
    };
    if (preparedReferences.references.length > 0) codiaBody.reference_images = preparedReferences.references;
    if (codiaModel === "gpt_image") {
      codiaBody.quality = "high";
    }
    if (codiaModel === "gpt_image" && background && ["auto", "opaque", "transparent"].includes(background)) {
      codiaBody.background = background;
    }
    requestPreview = {
      ...requestPreview,
      model: codiaModel,
      baseUrl: codiaBase,
      endpoint: `${codiaBase}/v2/open/image/generate_image`,
      requestBody: {
        ...codiaBody,
        reference_images: previewReferenceImages,
      },
    };
    let codiaRes: Response;
    try {
      codiaRes = await fetch(`${codiaBase}/v2/open/image/generate_image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanApiKey}`,
        },
        body: JSON.stringify(codiaBody),
        signal: req.signal,
      });
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { requestPreview, error: `无法连接 Codia 生图 API（${codiaBase}）: ${detail}` };
    }
    const text = await codiaRes.text().catch(() => "");
    let payload: CodiaImageResponse | null = null;
    try {
      payload = text ? JSON.parse(text) as CodiaImageResponse : null;
    } catch {
      payload = null;
    }
    if (!codiaRes.ok) {
      const message = payload?.message || text.slice(0, 400) || `HTTP ${codiaRes.status}`;
      return { requestPreview, error: `Codia 生图接口错误 (${codiaRes.status}): ${message}` };
    }
    if (payload?.code !== undefined && payload.code !== 0) {
      return { requestPreview, error: payload.message || `Codia 生图失败 code=${payload.code}` };
    }
    const imageUrl = payload ? extractCodiaImageUrl(payload) : undefined;
    if (imageUrl) return { imageUrl, requestPreview };
    return { requestPreview, error: "Codia 生图接口未返回可用图片" };
  }

  let grsResp: Response;
  let grsErrorText = "";
  try {
    grsResp = await fetch(`${base}/v1/api/generate`, {
      method: "POST",
      headers: (() => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (cleanApiKey) headers.Authorization = `Bearer ${cleanApiKey}`;
        return headers;
      })(),
      body: JSON.stringify(requestBody),
        signal: req.signal,
    });
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { requestPreview, error: `无法连接生图 API（${base}）: ${detail}` };
  }

  if (grsResp.ok) {
    const parsedGrs = await readJsonResponse<GrsaiResponse>(grsResp, "生图接口");
    if (!parsedGrs.data) {
      return {
        requestPreview,
        error: `${parsedGrs.error || "生图接口返回空响应"}（模型可能正在维护或暂不可用，请稍后重试或更换模型）`,
      };
    }
    const grsData = parsedGrs.data;
    const initialStatus = normalizeGrsStatus(grsData.status);
    const initialImageUrl = getGrsResultUrl(grsData);

    if (initialImageUrl && !isGrsFailureStatus(initialStatus)) {
      return { imageUrl: initialImageUrl, requestPreview };
    }

    if (shouldPollGrsTask(grsData)) {
      let lastPollError = "";
      const pollStartedAt = Date.now();
      let pollIndex = 0;
      while (Date.now() - pollStartedAt < GENERATE_POLL_TIMEOUT_MS) {
        const interval = GENERATE_POLL_INTERVALS_MS[Math.min(pollIndex, GENERATE_POLL_INTERVALS_MS.length - 1)];
        req.signal?.throwIfAborted();
        await new Promise((r) => setTimeout(r, interval));
        req.signal?.throwIfAborted();
        pollIndex += 1;
        let pollRes: Response;
        try {
          pollRes = await fetch(`${base}/v1/api/result?id=${encodeURIComponent(grsData.id)}`, {
            signal: req.signal,
            headers: cleanApiKey ? { Authorization: `Bearer ${cleanApiKey}` } : undefined,
          });
        } catch (err) {
          const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          lastPollError = `轮询请求失败: ${detail}`;
          continue;
        }
        if (!pollRes.ok) {
          const pollErrText = await pollRes.text().catch(() => "");
          lastPollError = `轮询错误 (${pollRes.status})${pollErrText ? `: ${pollErrText.slice(0, 240)}` : ""}`;
          continue;
        }
        const parsedPoll = await readJsonResponse<GrsaiResponse>(pollRes, "轮询接口");
        if (!parsedPoll.data) {
          lastPollError = parsedPoll.error || "轮询响应为空";
          continue;
        }
        const pollData = parsedPoll.data;
        const pollStatus = normalizeGrsStatus(pollData.status);
        const pollImageUrl = getGrsResultUrl(pollData);
        if (pollImageUrl && !isGrsFailureStatus(pollStatus)) {
          return { imageUrl: pollImageUrl, requestPreview };
        }
        if (isGrsFailureStatus(pollStatus)) {
          return { requestPreview, error: pollData.error || "生成失败" };
        }
        if (pollStatus && !GRS_PENDING_STATUSES.has(pollStatus) && !GRS_SUCCESS_STATUSES.has(pollStatus)) {
          lastPollError = `任务返回未知状态: ${pollData.status}`;
        }
      }
      return { requestPreview, error: lastPollError ? `生成超时，且${lastPollError}` : "生成超时，请稍后重试或减少并发数量" };
    }

    if (isGrsFailureStatus(initialStatus)) {
      return { requestPreview, error: grsData.error || "生成失败" };
    }

    return {
      requestPreview,
      error: `生图接口未返回可用结果${grsData.status ? `（状态: ${grsData.status}）` : ""}`,
    };
  } else {
    grsErrorText = await grsResp.text().catch(() => "");
    let grsErrorPayload: Partial<GrsaiResponse> | null = null;
    try {
      grsErrorPayload = grsErrorText ? JSON.parse(grsErrorText) as Partial<GrsaiResponse> : null;
    } catch {
      grsErrorPayload = null;
    }
    const upstreamMessage = typeof grsErrorPayload?.error === "string" ? grsErrorPayload.error.trim() : "";
    if (upstreamMessage) {
      grsErrorText = upstreamMessage;
    }
    const allowOpenAiFallback =
      grsResp.status === 404 ||
      grsResp.status === 405 ||
      (model || "").startsWith("gpt-image-1") ||
      /not found|unknown|unsupported|cannot post/i.test(grsErrorText);

    if (!allowOpenAiFallback) {
      return { requestPreview, error: `生图接口错误 (${grsResp.status})${grsErrorText ? `: ${grsErrorText.slice(0, 400)}` : ""}` };
    }
  }

  const openaiBody: Record<string, unknown> = {
    model: model || "gpt-image-1",
    prompt: effectivePrompt,
    size: toOpenAiImageSize(model, effectiveSize),
    response_format: "b64_json",
    n: 1,
  };
  if (req.quality && ["auto", "low", "medium", "high", "standard", "hd"].includes(req.quality)) {
    openaiBody.quality = req.quality;
  }
  if (background && background !== "auto") openaiBody.background = background;
  if (outputFormat) openaiBody.output_format = outputFormat;
  if (moderation && moderation !== "auto") openaiBody.moderation = moderation;

  const hasOpenAiEditImage = preparedReferences.references.length > 0;
  const openAiEndpoint = hasOpenAiEditImage ? `${base}/v1/images/edits` : `${base}/v1/images/generations`;
  requestPreview = {
    ...requestPreview,
    endpoint: openAiEndpoint,
    requestBody: hasOpenAiEditImage
      ? { ...openaiBody, image: previewReferenceImages }
      : openaiBody,
  };

  let openaiRes: Response;
  try {
    if (hasOpenAiEditImage) {
      const form = await buildOpenAiImageEditFormData({
        model,
        prompt: effectivePrompt,
        size: toOpenAiImageSize(model, effectiveSize),
        quality: req.quality,
        background,
        outputFormat,
        moderation,
        references: preparedReferences.references,
      });
      openaiRes = await fetch(openAiEndpoint, {
        method: "POST",
        headers: cleanApiKey ? { Authorization: `Bearer ${cleanApiKey}` } : undefined,
        body: form,
        signal: req.signal,
      });
    } else {
      openaiRes = await fetch(openAiEndpoint, {
        method: "POST",
        headers: (() => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (cleanApiKey) headers.Authorization = `Bearer ${cleanApiKey}`;
          return headers;
        })(),
        body: JSON.stringify(openaiBody),
        signal: req.signal,
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { requestPreview, error: `无法连接图片接口（${base}）: ${detail}` };
  }

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    return { requestPreview, error: `API error (${openaiRes.status}): ${errText}` };
  }

  const parsedOpenAi = await readJsonResponse<OpenAIImageResponse>(openaiRes, "图片接口");
  if (!parsedOpenAi.data) {
    return { requestPreview, error: parsedOpenAi.error || "图片接口返回空响应" };
  }
  const openaiData = parsedOpenAi.data;
  const first = openaiData.data?.[0];
  if (!first) return { requestPreview, error: "图片接口未返回数据" };
  if (first.b64_json) {
    return { imageBuffer: Buffer.from(first.b64_json, "base64"), requestPreview };
  }
  if (first.url) return { imageUrl: first.url, requestPreview };
  return { requestPreview, error: "图片接口未返回可用图片" };
}

export async function executeGeneration(req: GenerateRequest): Promise<GenerateResult> {
  const {
    prompt,
    size,
    apiKey,
    baseUrl,
    model,
    projectId,
    userId,
    referenceImages,
    canvas_x,
    canvas_y,
    canvas_width,
    canvas_height,
    expandComposite,
  } = req;

  if (!apiKey && !isLocalEndpoint(baseUrl)) {
    return { success: false, error: "请先配置 API Key" };
  }

  req.signal?.throwIfAborted();
  const effectiveReq: GenerateRequest = {
    ...req,
    apiKey: apiKey || "local-model",
  };

  const localMode = isLocalBackendEnabled();

  const now = new Date().toISOString();
  let recordId = "";
  let recordData: Record<string, unknown>;
  if (localMode) {
    const localRecord = createImageRecord({
      project_id: projectId || null,
      user_id: userId || null,
      prompt,
      model: model || "gpt-image-2",
      size: size || "1:1",
      status: "pending",
      reference_images: referenceImages ? JSON.stringify(referenceImages) : null,
      canvas_block_id: req.canvasBlockId,
      block_order: req.blockOrder,
      canvas_x,
      canvas_y,
      canvas_width,
      canvas_height,
    });
    recordId = localRecord.id;
    recordData = localRecord as unknown as Record<string, unknown>;
  } else {
    const supabase = getSupabaseClient();
    const supabaseRecord: PostgrestSingleResponse<Record<string, unknown>> = await supabase
      .from("image_records")
      .insert({
        project_id: projectId || null,
        user_id: userId || null,
        prompt,
        model: model || "gpt-image-2",
        size: size || "1:1",
        status: "pending",
        reference_images: referenceImages ? JSON.stringify(referenceImages) : null,
        canvas_x: canvas_x !== undefined ? Math.round(canvas_x) : undefined,
        canvas_y: canvas_y !== undefined ? Math.round(canvas_y) : undefined,
        canvas_width: canvas_width !== undefined ? Math.round(canvas_width) : undefined,
        canvas_height: canvas_height !== undefined ? Math.round(canvas_height) : undefined,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (supabaseRecord.error || !supabaseRecord.data) {
      return { success: false, error: supabaseRecord.error?.message || "创建记录失败" };
    }
    recordId = String(supabaseRecord.data.id);
    recordData = supabaseRecord.data;
  }

  try {
    let effectiveSize = size || "1:1";
    let effectivePrompt = prompt;
    let effectiveReferenceImages = referenceImages || [];

    if (expandComposite) {
      const totalW = expandComposite.expandLeft + expandComposite.originalCanvasWidth + expandComposite.expandRight;
      const totalH = expandComposite.expandTop + expandComposite.originalCanvasHeight + expandComposite.expandBottom;
      const closest = findClosestSupportedRatio(totalW, totalH);
      effectiveSize = closest.label;

      const directions: string[] = [];
      if (expandComposite.expandLeft > 5) directions.push("left");
      if (expandComposite.expandRight > 5) directions.push("right");
      if (expandComposite.expandTop > 5) directions.push("up");
      if (expandComposite.expandBottom > 5) directions.push("down");
      const dirText = directions.length > 0 ? directions.join(" and ") : "all sides";

      effectivePrompt = `Outpainting: Extend this image to the ${dirText}. Keep existing area unchanged. ${prompt}`;
      effectiveReferenceImages = [expandComposite.originalImageUrl, ...(referenceImages || [])];
    }

    let generated = await callGenerateApi(effectiveReq, effectivePrompt, effectiveSize, effectiveReferenceImages);
    let retryCount = 0;
    for (let attempt = 0; attempt < GENERATE_RETRY_DELAYS_MS.length; attempt++) {
      req.signal?.throwIfAborted();
      if (!generated.error || isLocalEndpoint(baseUrl) || !isRetryableGenerateError(generated.error)) break;
      retryCount = attempt + 1;
      await sleep(GENERATE_RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 1_500));
      generated = await callGenerateApi(effectiveReq, effectivePrompt, effectiveSize, effectiveReferenceImages);
    }
    if (generated.error) {
      const finalError = retryCount > 0 && isRetryableGenerateError(generated.error)
        ? `${generated.error}（已自动重试 ${retryCount} 次）`
        : generated.error;
      const failedPrompt = buildFailedRecordPrompt(prompt, finalError);
      if (localMode) {
        updateImageRecord(recordId, userId || null, { status: "failed", prompt: failedPrompt });
      } else {
        const supabase = getSupabaseClient();
        await supabase.from("image_records").update({ status: "failed", prompt: failedPrompt }).eq("id", recordId);
      }
      return { success: false, error: finalError, requestPreview: generated.requestPreview };
    }

    req.signal?.throwIfAborted();
    let finalUrl = "";
    let finalKey: string | null = null;

    if (localMode) {
      if (generated.imageBuffer) {
        const saved = saveBinaryFile(generated.imageBuffer, `generate_${recordId}.png`, "image/png");
        finalUrl = saved.url;
        finalKey = saved.key;
      } else if (generated.imageUrl) {
        const downloaded = await saveRemoteImageToLocal(generated.imageUrl, `generate_${recordId}`);
        if (downloaded) {
          finalUrl = downloaded.url;
          finalKey = downloaded.key;
        } else {
          finalUrl = generated.imageUrl;
          finalKey = null;
        }
      } else {
        throw new Error("未返回图片数据");
      }

      req.signal?.throwIfAborted();
      updateImageRecord(recordId, userId || null, {
        image_url: finalUrl,
        image_key: finalKey,
        status: "completed",
      });

      const updated = getImageRecordById(recordId, userId || null);
      return {
        success: true,
        record: (updated || (recordData as unknown as GenerateResult["record"])) as GenerateResult["record"],
        requestPreview: generated.requestPreview,
      };
    }

    const supabase = getSupabaseClient();
    if (generated.imageUrl) {
      await supabase
        .from("image_records")
        .update({ image_url: generated.imageUrl, status: "completed" })
        .eq("id", recordId);
    } else if (generated.imageBuffer) {
      const s3 = new S3Storage(new S3Config());
      const objectKey = await s3.uploadFile({
        fileContent: generated.imageBuffer,
        fileName: `generate_${recordId}.png`,
        contentType: "image/png",
      });
      const presignedUrl = await s3.generatePresignedUrl({ key: objectKey });
      await supabase
        .from("image_records")
        .update({ image_url: presignedUrl, image_key: objectKey, status: "completed" })
        .eq("id", recordId);
    }

    const updated = await supabase.from("image_records").select("*").eq("id", recordId).single();
    return {
      success: true,
      record: (updated.data || (recordData as unknown as GenerateResult["record"])) as GenerateResult["record"],
      requestPreview: generated.requestPreview,
    };
  } catch (err) {
    if(req.signal?.aborted){
      const updates={status:"cancelled",deleted_at:new Date().toISOString()};
      if(localMode)updateImageRecord(recordId,userId||null,updates);
      else await getSupabaseClient().from("image_records").update(updates).eq("id",recordId);
      return {success:false,error:"任务已取消"};
    }
    const message = err instanceof Error ? err.message : "Network error";
    const failedPrompt = buildFailedRecordPrompt(prompt, message);
    if (localMode) {
      updateImageRecord(recordId, userId || null, { status: "failed", prompt: failedPrompt });
    } else {
      const supabase = getSupabaseClient();
      await supabase.from("image_records").update({ status: "failed", prompt: failedPrompt }).eq("id", recordId);
    }
    return { success: false, error: message };
  }
}
