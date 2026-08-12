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
import type { LlmGenerationRequestPreview } from "@/lib/llm-preview";

export interface GenerateRequest {
  prompt: string;
  size?: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  imageSize?: string;
  projectId?: string;
  userId?: string;
  referenceImages?: string[];
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
  references: string[];
}) {
  const form = new FormData();
  form.append("model", input.model || "gpt-image-1");
  form.append("prompt", input.prompt);
  form.append("size", input.size);
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
const GENERATE_RETRY_DELAYS_MS = [900, 1800];

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
  if (!size || !size.includes(":")) return "1:1";
  const [w, h] = size.split(":").map((n) => parseInt(n, 10));
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
    /轮询请求失败|生成超时|无法连接|请求过于频繁|限流|上游负载|系统负载/.test(error || "") ||
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
  const { apiKey, baseUrl, model, imageSize } = req;
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

  const requestBody: Record<string, unknown> = {
    model: model || "gpt-image-2",
    prompt: effectivePrompt,
    images: preparedReferences.references,
    replyType: "json",
    aspectRatio: effectiveSize,
  };

  if ((model || "").startsWith("nano-banana")) {
    requestBody.imageSize = imageSize || "1K";
  }

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
    if (codiaModel === "gpt_image" && imageSize && ["low", "medium", "high", "auto"].includes(imageSize)) {
      codiaBody.quality = imageSize;
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
    });
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { requestPreview, error: `无法连接生图 API（${base}）: ${detail}` };
  }

  if (grsResp.ok) {
    const grsData = (await grsResp.json()) as GrsaiResponse;
    const initialStatus = normalizeGrsStatus(grsData.status);
    const initialImageUrl = getGrsResultUrl(grsData);

    if (initialImageUrl && !isGrsFailureStatus(initialStatus)) {
      return { imageUrl: initialImageUrl, requestPreview };
    }

    if (shouldPollGrsTask(grsData)) {
      let lastPollError = "";
      for (let i = 0; i < GENERATE_POLL_INTERVALS_MS.length; i++) {
        await new Promise((r) => setTimeout(r, GENERATE_POLL_INTERVALS_MS[i]));
        let pollRes: Response;
        try {
          pollRes = await fetch(`${base}/v1/api/generate/${grsData.id}`, {
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
        const pollData = (await pollRes.json()) as GrsaiResponse;
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
    size: toRatioSize(effectiveSize),
    response_format: "b64_json",
    n: 1,
  };

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
        size: toRatioSize(effectiveSize),
        references: preparedReferences.references,
      });
      openaiRes = await fetch(openAiEndpoint, {
        method: "POST",
        headers: cleanApiKey ? { Authorization: `Bearer ${cleanApiKey}` } : undefined,
        body: form,
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

  const openaiData = (await openaiRes.json()) as OpenAIImageResponse;
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
      if (!generated.error || isLocalEndpoint(baseUrl) || !isRetryableGenerateError(generated.error)) break;
      retryCount = attempt + 1;
      await sleep(GENERATE_RETRY_DELAYS_MS[attempt]);
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
