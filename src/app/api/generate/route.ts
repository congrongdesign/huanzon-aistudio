import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { executeGeneration } from "@/lib/generate-core";
import { createGenerationLlmRequestPreview } from "@/lib/llm-preview";
import { createTrackedOperation, updateTrackedOperation } from "@/lib/design-operation-tracker";
import { normalizeOperationError, toOperationErrorLog, toOperationErrorPayload } from "@/lib/operation-error";

function isLocalEndpoint(url?: string): boolean {
  try {
    const parsed = new URL((url || "").trim());
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

type TrackedOperation = { id: string };

export async function POST(request: NextRequest) {
  let operationForFailure: { id: string; userId: string } | null = null;
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const body = await request.json();
    const {
      prompt,
      size,
      apiKey,
      baseUrl,
      model,
      imageSize,
      projectId,
      referenceImages,
      canvas_x,
      canvas_y,
      canvas_width,
      canvas_height,
      expandComposite,
    } = body;

    if (!prompt || typeof prompt !== "string") {
      const normalized = normalizeOperationError({ message: "prompt is required", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    if (!apiKey && !isLocalEndpoint(baseUrl)) {
      const normalized = normalizeOperationError({ message: "请先在顶部配置 API Key", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const operation = await createTrackedOperation(userId, {
      projectId: projectId || null,
      kind: expandComposite ? "outpaint" : "generate",
      prompt,
      provider: (baseUrl || "").trim() || "grsai",
      model: (model || "gpt-image-2").trim(),
      status: "running",
      params: {
        size: size || null,
        imageSize: imageSize || null,
        hasReferenceImages: Array.isArray(referenceImages) && referenceImages.length > 0,
        referenceCount: Array.isArray(referenceImages) ? referenceImages.length : 0,
        hasExpandComposite: Boolean(expandComposite),
      },
    });
    operationForFailure = { id: operation.id, userId };

    const result = await executeGeneration({
      prompt,
      size,
      apiKey,
      baseUrl,
      model,
      imageSize,
      projectId,
      userId,
      referenceImages,
      canvas_x,
      canvas_y,
      canvas_width,
      canvas_height,
      expandComposite,
    });

    if (!result.success) {
      const normalized = normalizeOperationError({
        message: result.error || "生成失败",
        status: 400,
      });
      await updateTrackedOperation(userId, operation.id, {
        status: "failed",
        error: toOperationErrorLog(normalized),
      }).catch(() => {});
      return NextResponse.json({
        ...toOperationErrorPayload(normalized),
        requestPreview: result.requestPreview
          ? createGenerationLlmRequestPreview({ generation: result.requestPreview })
          : undefined,
      }, { status: normalized.status });
    }

    await updateTrackedOperation(userId, operation.id, {
      status: "completed",
      params: {
        imageRecordId: result.record?.id || null,
        imageUrl: result.record?.image_url || null,
        projectId: result.record?.project_id || projectId || null,
      },
    }).catch(() => {});

    return NextResponse.json({
      ...result.record,
      operationId: operation.id,
      requestPreview: result.requestPreview
        ? createGenerationLlmRequestPreview({ generation: result.requestPreview })
        : undefined,
    });
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "Unknown error",
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
