import { createDesignOperation, isLocalBackendEnabled, updateDesignOperation } from "@/lib/local-backend";
import type { DesignOperationKind, DesignOperationStatus } from "@/lib/types";
import { getSupabaseClient } from "@/storage/database/supabase-client";

type CreateTrackedOperationInput = {
  documentId?: string | null;
  projectId: string | null;
  inputAssetIds?: string[];
  outputAssetIds?: string[];
  kind: DesignOperationKind;
  prompt: string;
  maskAssetId?: string | null;
  provider: string;
  model: string;
  params?: Record<string, unknown>;
  status?: DesignOperationStatus;
  error?: string | null;
};

type UpdateTrackedOperationInput = {
  documentId?: string | null;
  projectId?: string | null;
  inputAssetIds?: string[];
  outputAssetIds?: string[];
  kind?: DesignOperationKind;
  prompt?: string;
  maskAssetId?: string | null;
  provider?: string;
  model?: string;
  params?: Record<string, unknown>;
  status?: DesignOperationStatus;
  error?: string | null;
  completedAt?: string | null;
};

type TrackedOperation = { id: string };

function isTerminalStatus(status?: DesignOperationStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function createTrackedOperation(userId: string, input: CreateTrackedOperationInput): Promise<TrackedOperation> {
  const status = input.status || "queued";
  const params = asObject(input.params);
  const inputAssetIds = asStringArray(input.inputAssetIds);
  const outputAssetIds = asStringArray(input.outputAssetIds);

  if (isLocalBackendEnabled()) {
    const operation = createDesignOperation(userId, {
      document_id: input.documentId ?? null,
      project_id: input.projectId,
      input_asset_ids: inputAssetIds,
      output_asset_ids: outputAssetIds,
      kind: input.kind,
      prompt: input.prompt,
      mask_asset_id: input.maskAssetId || null,
      provider: input.provider,
      model: input.model,
      params,
      status,
      error: input.error ?? null,
    });
    return { id: operation.id };
  }

  const now = new Date().toISOString();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("design_operations")
    .insert({
      document_id: input.documentId ?? null,
      project_id: input.projectId,
      user_id: userId,
      input_asset_ids: inputAssetIds,
      output_asset_ids: outputAssetIds,
      kind: input.kind,
      prompt: input.prompt,
      mask_asset_id: input.maskAssetId || null,
      provider: input.provider,
      model: input.model,
      params,
      status,
      error: input.error ?? null,
      completed_at: isTerminalStatus(status) ? now : null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || "创建设计操作失败");
  }
  return { id: String(data.id) };
}

export async function updateTrackedOperation(
  userId: string,
  operationId: string,
  updates: UpdateTrackedOperationInput,
): Promise<void> {
  if (isLocalBackendEnabled()) {
    updateDesignOperation(operationId, userId, {
      document_id: updates.documentId,
      project_id: updates.projectId,
      input_asset_ids: updates.inputAssetIds,
      output_asset_ids: updates.outputAssetIds,
      kind: updates.kind,
      prompt: updates.prompt,
      mask_asset_id: updates.maskAssetId,
      provider: updates.provider,
      model: updates.model,
      params: updates.params,
      status: updates.status,
      error: updates.error,
      completed_at: updates.completedAt,
    });
    return;
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (updates.documentId !== undefined) payload.document_id = updates.documentId || null;
  if (updates.projectId !== undefined) payload.project_id = updates.projectId || null;
  if (updates.inputAssetIds !== undefined) payload.input_asset_ids = asStringArray(updates.inputAssetIds);
  if (updates.outputAssetIds !== undefined) payload.output_asset_ids = asStringArray(updates.outputAssetIds);
  if (updates.kind !== undefined) payload.kind = updates.kind;
  if (updates.prompt !== undefined) payload.prompt = updates.prompt;
  if (updates.maskAssetId !== undefined) payload.mask_asset_id = updates.maskAssetId || null;
  if (updates.provider !== undefined) payload.provider = updates.provider;
  if (updates.model !== undefined) payload.model = updates.model;
  if (updates.params !== undefined) payload.params = asObject(updates.params);
  if (updates.error !== undefined) payload.error = updates.error || null;
  if (updates.status !== undefined) {
    payload.status = updates.status;
    if (updates.completedAt === undefined && isTerminalStatus(updates.status)) {
      payload.completed_at = new Date().toISOString();
    }
  }
  if (updates.completedAt !== undefined) payload.completed_at = updates.completedAt || null;

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("design_operations")
    .update(payload)
    .eq("id", operationId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}
