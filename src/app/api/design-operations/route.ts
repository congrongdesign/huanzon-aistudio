import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createDesignOperation,
  deleteDesignOperation,
  getDesignOperationById,
  isLocalBackendEnabled,
  listDesignOperations,
  updateDesignOperation,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import type { DesignOperationKind, DesignOperationStatus } from "@/lib/types";

function parseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeStatus(value: unknown): DesignOperationStatus | undefined {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "cancelled") {
    return value;
  }
  return undefined;
}

function normalizeKind(value: unknown): DesignOperationKind | null {
  const allowed = new Set([
    "generate",
    "edit_mask",
    "edit_instruction",
    "outpaint",
    "remove_bg",
    "upscale",
    "relight",
    "text_render",
    "restore_version",
  ]);
  return typeof value === "string" && allowed.has(value) ? (value as DesignOperationKind) : null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const projectId = searchParams.get("projectId");
    const documentId = searchParams.get("documentId");
    const assetId = searchParams.get("assetId");
    const status = normalizeStatus(searchParams.get("status"));

    if (isLocalBackendEnabled()) {
      if (id) {
        const operation = getDesignOperationById(id, userId);
        if (!operation) return NextResponse.json({ error: "操作不存在" }, { status: 404 });
        return NextResponse.json({ operation });
      }
      return NextResponse.json({ operations: listDesignOperations(userId, { projectId, documentId, assetId, status }) });
    }

    const supabase = getSupabaseClient();
    if (id) {
      const { data, error } = await supabase.from("design_operations").select("*").eq("id", id).eq("user_id", userId).single();
      if (error) return NextResponse.json({ error: error.message }, { status: 404 });
      return NextResponse.json({ operation: data });
    }

    let query = supabase.from("design_operations").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    if (documentId) query = query.eq("document_id", documentId);
    if (status) query = query.eq("status", status);
    if (assetId) query = query.or(`mask_asset_id.eq.${assetId},input_asset_ids.cs.["${assetId}"],output_asset_ids.cs.["${assetId}"]`);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ operations: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取设计操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const {
      documentId,
      projectId,
      inputAssetIds,
      outputAssetIds,
      kind,
      prompt,
      maskAssetId,
      provider,
      model,
      params,
      status,
      error,
    } = body;

    const normalizedKind = normalizeKind(kind);
    if (!normalizedKind) return NextResponse.json({ error: "kind is required" }, { status: 400 });
    const normalizedStatus = normalizeStatus(status) || "queued";

    if (isLocalBackendEnabled()) {
      const operation = createDesignOperation(userId, {
        document_id: documentId || null,
        project_id: projectId || null,
        input_asset_ids: parseStringArray(inputAssetIds),
        output_asset_ids: parseStringArray(outputAssetIds),
        kind: normalizedKind,
        prompt: prompt || "",
        mask_asset_id: maskAssetId || null,
        provider: provider || "",
        model: model || "",
        params: parseObject(params),
        status: normalizedStatus,
        error: error || null,
      });
      return NextResponse.json({ operation });
    }

    const now = new Date().toISOString();
    const supabase = getSupabaseClient();
    const { data, error: insertError } = await supabase
      .from("design_operations")
      .insert({
        document_id: documentId || null,
        project_id: projectId || null,
        user_id: userId,
        input_asset_ids: parseStringArray(inputAssetIds),
        output_asset_ids: parseStringArray(outputAssetIds),
        kind: normalizedKind,
        prompt: prompt || "",
        mask_asset_id: maskAssetId || null,
        provider: provider || "",
        model: model || "",
        params: parseObject(params),
        status: normalizedStatus,
        error: error || null,
        completed_at: normalizedStatus === "completed" || normalizedStatus === "failed" || normalizedStatus === "cancelled" ? now : null,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return NextResponse.json({ operation: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建设计操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const {
      id,
      documentId,
      projectId,
      inputAssetIds,
      outputAssetIds,
      kind,
      prompt,
      maskAssetId,
      provider,
      model,
      params,
      status,
      error,
      completedAt,
    } = body;

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const normalizedKind = kind !== undefined ? normalizeKind(kind) : undefined;
    if (kind !== undefined && !normalizedKind) return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    const normalizedStatus = status !== undefined ? normalizeStatus(status) : undefined;
    if (status !== undefined && !normalizedStatus) return NextResponse.json({ error: "invalid status" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const operation = updateDesignOperation(id, userId, {
        document_id: documentId,
        project_id: projectId,
        input_asset_ids: inputAssetIds !== undefined ? parseStringArray(inputAssetIds) : undefined,
        output_asset_ids: outputAssetIds !== undefined ? parseStringArray(outputAssetIds) : undefined,
        kind: normalizedKind || undefined,
        prompt,
        mask_asset_id: maskAssetId,
        provider,
        model,
        params,
        status: normalizedStatus,
        error,
        completed_at: completedAt,
      });
      if (!operation) return NextResponse.json({ error: "操作不存在" }, { status: 404 });
      return NextResponse.json({ operation });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (documentId !== undefined) updates.document_id = documentId || null;
    if (projectId !== undefined) updates.project_id = projectId || null;
    if (inputAssetIds !== undefined) updates.input_asset_ids = parseStringArray(inputAssetIds);
    if (outputAssetIds !== undefined) updates.output_asset_ids = parseStringArray(outputAssetIds);
    if (normalizedKind !== undefined) updates.kind = normalizedKind;
    if (prompt !== undefined) updates.prompt = prompt;
    if (maskAssetId !== undefined) updates.mask_asset_id = maskAssetId || null;
    if (provider !== undefined) updates.provider = provider;
    if (model !== undefined) updates.model = model;
    if (params !== undefined) updates.params = parseObject(params);
    if (normalizedStatus !== undefined) {
      updates.status = normalizedStatus;
      if (normalizedStatus === "completed" || normalizedStatus === "failed" || normalizedStatus === "cancelled") {
        updates.completed_at = new Date().toISOString();
      }
    }
    if (error !== undefined) updates.error = error || null;
    if (completedAt !== undefined) updates.completed_at = completedAt || null;

    const supabase = getSupabaseClient();
    const { data, error: updateError } = await supabase.from("design_operations").update(updates).eq("id", id).eq("user_id", userId).select().single();
    if (updateError) throw updateError;
    return NextResponse.json({ operation: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新设计操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const id = request.nextUrl.searchParams.get("id") || (await request.json().catch(() => ({}))).id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const ok = deleteDesignOperation(id, userId);
      if (!ok) return NextResponse.json({ error: "操作不存在" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("design_operations").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除设计操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
