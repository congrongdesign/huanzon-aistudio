import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { createImageRecord, isLocalBackendEnabled, saveBinaryFile } from "@/lib/local-backend";
import { prepareReferenceImagesForModel } from "@/lib/image-edit/reference-prep";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import type { DesignOperationKind } from "@/lib/types";
import { createTrackedOperation, updateTrackedOperation } from "@/lib/design-operation-tracker";
import { normalizeOperationError, toOperationErrorLog, toOperationErrorPayload } from "@/lib/operation-error";
import sharp from "sharp";

type ProcessConfig = { prompt: string; size: string; useReference: boolean; model?: string };
type GenerateStatus = {
  id?: string;
  status?: string;
  output?: string[];
  results?: { url?: string }[];
  error?: string;
};

const SUPPORTED_ASPECT_RATIOS = [
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

function parseAspectRatioInput(value: unknown): { w: number; h: number } | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const ratioMatch = text.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratioMatch) {
    const w = Number(ratioMatch[1]);
    const h = Number(ratioMatch[2]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { w, h };
    }
    return null;
  }
  const sizeMatch = text.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (sizeMatch) {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { w, h };
    }
  }
  return null;
}

function findClosestSupportedAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "1:1";
  const target = width / height;
  let best = SUPPORTED_ASPECT_RATIOS[0];
  let minDelta = Number.POSITIVE_INFINITY;
  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    const delta = Math.abs(ratio.w / ratio.h - target);
    if (delta < minDelta) {
      minDelta = delta;
      best = ratio;
    }
  }
  return best.label;
}

function normalizeAspectRatio(value: unknown): string | null {
  const parsed = parseAspectRatioInput(value);
  if (!parsed) return null;
  return findClosestSupportedAspectRatio(parsed.w, parsed.h);
}

async function detectAspectRatioFromImageBuffer(imageBuffer: Buffer): Promise<string | null> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) return null;
    return findClosestSupportedAspectRatio(metadata.width, metadata.height);
  } catch {
    return null;
  }
}

async function detectAspectRatioFromImageUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return detectAspectRatioFromImageBuffer(buffer);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/v1") ? clean.slice(0, -3) : clean;
}

function extractOutputUrl(data: GenerateStatus): string | null {
  return data.output?.[0] || data.results?.[0]?.url || null;
}

function isCompletedStatus(status?: string): boolean {
  return status === "completed" || status === "succeeded";
}

function isFailedStatus(status?: string): boolean {
  return status === "failed" || status === "violation";
}

function mapProcessActionToKind(action: string): DesignOperationKind {
  if (action === "remove-bg") return "remove_bg";
  if (action === "hd-upscale") return "upscale";
  return "edit_instruction";
}

async function persistProcessedImage(input: {
  outputUrl: string;
  action: string;
  projectId: string;
  userId: string;
  prompt: string;
  size?: string;
  model: string;
  referenceImages: string[];
}) {
  const imgRes = await fetch(input.outputUrl);
  if (!imgRes.ok) throw new Error("Failed to download processed image");
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const normalizedRequestedSize = normalizeAspectRatio(input.size);
  const inferredSize = await detectAspectRatioFromImageBuffer(imgBuffer);
  const effectiveSize = normalizedRequestedSize || inferredSize || "1:1";
  const fileName = `${input.action}-${Date.now()}.png`;

  if (isLocalBackendEnabled()) {
    const saved = saveBinaryFile(imgBuffer, fileName, "image/png");
    return createImageRecord({
      project_id: input.projectId || null,
      user_id: input.userId,
      prompt: input.prompt,
      image_url: saved.url,
      image_key: saved.key,
      size: effectiveSize,
      model: input.model,
      status: "completed",
      reference_images: JSON.stringify(input.referenceImages),
    });
  }

  const supabase = getSupabaseClient();
  const s3 = new S3Storage(new S3Config());
  const objectKey = await s3.uploadFile({ fileContent: imgBuffer, fileName, contentType: "image/png" });
  const presignedUrl = await s3.generatePresignedUrl({ key: objectKey });
  const { data: record, error: dbError } = await supabase
    .from("image_records")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      prompt: input.prompt,
      image_url: presignedUrl,
      image_key: objectKey,
      size: effectiveSize,
      model: input.model,
      status: "completed",
      reference_images: JSON.stringify(input.referenceImages),
    })
    .select()
    .single();

  if (dbError) throw new Error(dbError.message);
  return record;
}

export async function POST(request: NextRequest) {
  let operationForFailure: { id: string; userId: string } | null = null;
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const { action, imageUrl, apiKey, baseUrl, projectId, prompt, model, sourceAspectRatio } = await request.json();

    if (!action || !imageUrl || !apiKey || !baseUrl) {
      const normalized = normalizeOperationError({ message: "Missing required parameters", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    // Action-specific prompt templates optimized for each task
    const actionConfigs: Record<string, ProcessConfig> = {
      "remove-bg": {
        prompt: "Remove the background from this image completely. Keep only the main subject with clean edges. Output on a transparent/white background. Do not modify the subject itself.",
        size: "1:1",
        useReference: true,
      },
      "hd-upscale": {
        prompt: "Enhance this image to ultra high definition quality. Improve detail, sharpness, and clarity while maintaining the exact same composition, colors, and style. Do not change any content, only improve resolution and quality.",
        size: "1:1",
        useReference: true,
      },
      "cutout": {
        prompt: "Precisely cut out the main subject from this image. Remove all background. Place the subject on a clean pure white background. Preserve all fine details like hair strands and soft edges.",
        size: "1:1",
        useReference: true,
      },
      "style-transfer": {
        prompt: prompt || "Transform this image while keeping the same composition and subject",
        size: "1:1",
        useReference: true,
      },
      "ai-edit": {
        prompt: prompt || "Edit this image according to the user instruction while preserving the original subject and composition.",
        size: "1:1",
        useReference: true,
      },
    };

    const config = actionConfigs[action];
    if (!config) {
      const normalized = normalizeOperationError({ message: `Unknown action: ${action}`, status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    const requestAspectRatio = normalizeAspectRatio(sourceAspectRatio);
    let effectiveSize = config.size;
    if (action === "hd-upscale") {
      effectiveSize = requestAspectRatio || (await detectAspectRatioFromImageUrl(imageUrl)) || config.size;
    }

    const effectivePrompt = action === "style-transfer" ? config.prompt : config.prompt;
    const operation = await createTrackedOperation(userId, {
      projectId: projectId || null,
      kind: mapProcessActionToKind(action),
      prompt: effectivePrompt,
      provider: (baseUrl || "").trim() || "grsai",
      model: (config.model || model || "gpt-image-2").trim(),
      status: "running",
      params: {
        action,
        imageUrl,
        useReference: config.useReference,
        requestedSize: effectiveSize,
        sourceAspectRatio: requestAspectRatio || null,
      },
    });
    operationForFailure = { id: operation.id, userId };

    // Call grsai API
    const base = normalizeBaseUrl(baseUrl);
    const preparedReferences = config.useReference ? await prepareReferenceImagesForModel([imageUrl]) : { references: [] };

    const grsaiRes = await fetch(`${base}/v1/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: effectivePrompt,
        aspectRatio: effectiveSize,
        replyType: "json",
        ...(config.useReference ? { images: preparedReferences.references, reference_images: preparedReferences.references } : {}),
        model: config.model || model || "gpt-image-2",
      }),
    });

    if (!grsaiRes.ok) {
      const errorText = await grsaiRes.text();
      console.error(`Image process API error for ${action}:`, errorText);
      const normalized = normalizeOperationError({
        message: errorText || `API error: ${grsaiRes.status}`,
        upstreamStatus: grsaiRes.status,
        status: grsaiRes.status === 429 ? 429 : 502,
      });
      await updateTrackedOperation(userId, operation.id, {
        status: "failed",
        error: toOperationErrorLog(normalized),
      }).catch(() => {});
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const grsaiData = await grsaiRes.json() as GenerateStatus;

    // If running, return the ID for polling
    if (grsaiData.status === "running" && grsaiData.id) {
      return NextResponse.json({
        status: "running",
        id: grsaiData.id,
        action,
        projectId,
        size: effectiveSize,
        operationId: operation.id,
      });
    }

    // If completed directly
    const directOutput = extractOutputUrl(grsaiData);
    if (isCompletedStatus(grsaiData.status) && directOutput) {
      const record = await persistProcessedImage({
        outputUrl: directOutput,
        action,
        projectId,
        userId,
        prompt: effectivePrompt,
        size: effectiveSize,
        model: config.model || model || "gpt-image-2",
        referenceImages: preparedReferences.references,
      });
      await updateTrackedOperation(userId, operation.id, {
        status: "completed",
        params: {
          action,
          imageRecordId: record?.id || null,
          imageUrl: record?.image_url || null,
          requestedSize: effectiveSize,
          directResult: true,
        },
      }).catch(() => {});
      return NextResponse.json({
        status: "completed",
        ...record,
        operationId: operation.id,
      });
    }

    await updateTrackedOperation(userId, operation.id, {
      status: "failed",
      error: toOperationErrorLog(normalizeOperationError({ message: "Unexpected API response", status: 500 })),
    }).catch(() => {});
    const normalized = normalizeOperationError({ message: "Unexpected API response", status: 500 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  } catch (error) {
    console.error("Image process error:", error);
    const normalized = normalizeOperationError({
      message: error instanceof Error ? error.message : "Processing failed",
      status: 500,
    });
    if (operationForFailure) {
      await updateTrackedOperation(operationForFailure.userId, operationForFailure.id, {
        status: "failed",
        error: toOperationErrorLog(normalized),
      }).catch(() => {});
    }
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}

// Poll for running tasks
export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    const normalized = normalizeOperationError({ message: "未登录", status: 401 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const apiKey = searchParams.get("apiKey");
  const baseUrl = searchParams.get("baseUrl");
  const action = searchParams.get("action") || "";
  const projectId = searchParams.get("projectId") || "";
  const operationId = searchParams.get("operationId");
  const model = searchParams.get("model") || "gpt-image-2";
  const requestedSize = normalizeAspectRatio(searchParams.get("size"));

  if (!taskId || !apiKey || !baseUrl) {
    const normalized = normalizeOperationError({ message: "Missing parameters", status: 400 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }

  try {
    const base = normalizeBaseUrl(baseUrl);
    const grsaiRes = await fetch(`${base}/v1/api/generate/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const grsaiData = await grsaiRes.json() as GenerateStatus;

    if (grsaiData.status === "running") {
      return NextResponse.json({ status: "running" });
    }

    const outputUrl = extractOutputUrl(grsaiData);
    if (isCompletedStatus(grsaiData.status) && outputUrl) {
      const record = await persistProcessedImage({
        outputUrl,
        action,
        projectId,
        userId,
        prompt: `Image processing: ${action}`,
        size: requestedSize || undefined,
        model,
        referenceImages: [],
      });
      if (operationId) {
        await updateTrackedOperation(userId, operationId, {
          status: "completed",
          params: {
            action,
            imageRecordId: record?.id || null,
            imageUrl: record?.image_url || null,
            taskId,
          },
        }).catch(() => {});
      }
      return NextResponse.json({
        status: "completed",
        ...record,
        operationId: operationId || null,
      });
    }

    if (operationId) {
      const normalized = normalizeOperationError({
        message: grsaiData.error || (isFailedStatus(grsaiData.status) ? "Generation failed" : "Generation failed"),
        status: 500,
      });
      await updateTrackedOperation(userId, operationId, {
        status: "failed",
        error: toOperationErrorLog(normalized),
        params: { action, taskId },
      }).catch(() => {});
      return NextResponse.json({
        status: "failed",
        ...toOperationErrorPayload(normalized),
        operationId: operationId || null,
      }, { status: normalized.status });
    }
    const normalized = normalizeOperationError({
      message: grsaiData.error || (isFailedStatus(grsaiData.status) ? "Generation failed" : "Generation failed"),
      status: 500,
    });
    return NextResponse.json({
      status: "failed",
      ...toOperationErrorPayload(normalized),
      operationId: operationId || null,
    }, { status: normalized.status });
  } catch (error) {
    const normalized = normalizeOperationError({
      message: error instanceof Error ? error.message : "Poll failed",
      status: 500,
    });
    if (operationId) {
      await updateTrackedOperation(userId, operationId, {
        status: "failed",
        error: toOperationErrorLog(normalized),
        params: { action, taskId },
      }).catch(() => {});
    }
    return NextResponse.json({
      ...toOperationErrorPayload(normalized),
      operationId: operationId || null,
    }, { status: normalized.status });
  }
}
