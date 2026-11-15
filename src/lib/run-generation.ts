import { getImageQualityOptions, preferredImageQuality } from './image-generation-defaults';
import { runFontGeneration } from './run-font-generation';
import type { GenerationDestination } from './font-creation-types';
import { saveGenerationRecipe } from '@/lib/font-library-store';
import { executeGeneration } from "@/lib/generate-core";
import { createGenerationLlmRequestPreview } from "@/lib/llm-preview";
import { createTrackedOperation, updateTrackedOperation } from "@/lib/design-operation-tracker";
import { normalizeOperationError, toOperationErrorLog, toOperationErrorPayload } from "@/lib/operation-error";
import { isLocalBackendEnabled, listChatMessages, updateChatMessageImageUrl } from './local-backend';

export type GenerationBody = Omit<Parameters<typeof executeGeneration>[0], "userId" | "signal"> & { destination?: GenerationDestination; fontRunId?: string; assistantMessageId?: string; sourceFontCardId?: string; userPrompt?: string; referenceLabels?: string[] };
function isLocalEndpoint(url?: string) { try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(url || "").hostname); } catch { return false; } }
function response(payload: Record<string, unknown>, init?: { status: number }) { return { payload, status: init?.status ?? 200 }; }
export async function runGeneration(userId: string, body: GenerationBody, signal?: AbortSignal) {
  if (body.destination?.kind === 'font') return runFontGeneration(userId, body, signal);
  let operationForFailure: { id: string; userId: string } | null = null;
  try {
    const {
      prompt,
      size,
      apiKey,
      baseUrl,
      model,
      imageSize,
      quality: _requestedQuality,
      background,
      outputFormat,
      moderation,
      projectId,
      referenceImages,
      canvas_x,
      canvas_y,
      canvas_width,
      canvas_height,
      expandComposite,
    } = body;

    const quality = /(?:nano-banana|dall[-_]?e[-_]?2)/i.test(model || '') ? undefined : (_requestedQuality !== undefined || /(?:gpt[-_]?image|dall[-_]?e[-_]?3)/i.test(model || 'gpt-image-2')) ? preferredImageQuality(getImageQualityOptions(model || 'gpt-image-2')) : undefined;

    if (!prompt || typeof prompt !== "string") {
      const normalized = normalizeOperationError({ message: "prompt is required", status: 400 });
      return response(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    if (!apiKey && !isLocalEndpoint(baseUrl)) {
      const normalized = normalizeOperationError({ message: "请先在顶部配置 API Key", status: 400 });
      return response(toOperationErrorPayload(normalized), { status: normalized.status });
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
        quality: quality || null,
        background: background || null,
        outputFormat: outputFormat || null,
        moderation: moderation || null,
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
      quality,
      background,
      outputFormat,
      moderation,
      projectId,
      userId,
      referenceImages,
      canvas_x,
      canvas_y,
      canvas_width,
      canvas_height,
      expandComposite,
      canvasBlockId: body.canvasBlockId,
      blockOrder: body.blockOrder,
      signal,
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
      return response({
        ...toOperationErrorPayload(normalized),
        requestPreview: result.requestPreview
          ? createGenerationLlmRequestPreview({ generation: result.requestPreview })
          : undefined,
      }, { status: normalized.status });
    }

    if (result.record?.id && isLocalBackendEnabled()) {
      await saveGenerationRecipe(userId, result.record.id, {
        schemaVersion: 1, prompt, userPrompt: body.userPrompt, referenceImages: referenceImages || [], referenceLabels: body.referenceLabels,
        parameters: { model, size, imageSize, quality, background, outputFormat, moderation },
        sourceFontCardId: body.sourceFontCardId, assistantMessageId: body.assistantMessageId, operationId: operation.id, createdAt: new Date().toISOString(),
      }).catch(error => console.error('Generation recipe could not be saved', error instanceof Error ? error.message : 'unknown'));
    }
    await updateTrackedOperation(userId, operation.id, {
      status: "completed",
      params: {
        size, imageSize, quality, background, outputFormat, moderation,
        imageRecordId: result.record?.id || null,
        imageUrl: result.record?.image_url || null,
        projectId: result.record?.project_id || projectId || null,
      },
    }).catch(() => {});

    if (result.record?.image_url && body.assistantMessageId && projectId && isLocalBackendEnabled()) {
      const owned = listChatMessages(projectId, userId).some(message => message.id === body.assistantMessageId && message.role === 'assistant');
      if (owned) updateChatMessageImageUrl(body.assistantMessageId, result.record.image_url);
    }
    return response({
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
    return response(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
