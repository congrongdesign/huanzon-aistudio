import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createDesignAsset,
  createDesignOperation,
  createImageRecord,
  createAssetVersion,
  deleteAssetVersion,
  getDesignAssetById,
  isLocalBackendEnabled,
  listAssetVersions,
  updateDesignOperation,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get("assetId");
    const parentAssetId = searchParams.get("parentAssetId");
    const operationId = searchParams.get("operationId");

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ versions: listAssetVersions(userId, { assetId, parentAssetId, operationId }) });
    }

    const supabase = getSupabaseClient();
    let query = supabase.from("asset_versions").select("*").eq("user_id", userId).order("version_index", { ascending: false });
    if (assetId) query = query.eq("asset_id", assetId);
    if (parentAssetId) query = query.eq("parent_asset_id", parentAssetId);
    if (operationId) query = query.eq("operation_id", operationId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ versions: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取资产版本失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const { assetId, parentAssetId, operationId, versionIndex, label, url, key, metadata } = body;
    if (!assetId || !url) {
      return NextResponse.json({ error: "assetId and url are required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const version = createAssetVersion(userId, {
        asset_id: assetId,
        parent_asset_id: parentAssetId || null,
        operation_id: operationId || null,
        version_index: Number.isFinite(Number(versionIndex)) ? Number(versionIndex) : undefined,
        label: label || "",
        url,
        key: key || null,
        metadata: parseMetadata(metadata),
      });
      return NextResponse.json({ version });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("asset_versions")
      .insert({
        asset_id: assetId,
        parent_asset_id: parentAssetId || null,
        operation_id: operationId || null,
        user_id: userId,
        version_index: Number.isFinite(Number(versionIndex)) ? Number(versionIndex) : undefined,
        label: label || "版本",
        url,
        key: key || null,
        metadata: parseMetadata(metadata),
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ version: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建资产版本失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const { versionId, id, projectId, canvasX, canvasY, canvasWidth, canvasHeight } = body;
    const targetVersionId = versionId || id;
    if (!targetVersionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const version = listAssetVersions(userId).find((item) => item.id === targetVersionId);
      if (!version) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
      const sourceAsset = getDesignAssetById(version.asset_id, userId);
      const resolvedProjectId = projectId || sourceAsset?.project_id || null;
      const restoredRecord = createImageRecord({
        project_id: resolvedProjectId,
        user_id: userId,
        prompt: `[恢复版本] ${version.label || `v${version.version_index}`}`,
        image_url: version.url,
        image_key: version.key,
        reference_images: JSON.stringify([version.asset_id]),
        canvas_x: parseNumber(canvasX, 80),
        canvas_y: parseNumber(canvasY, 80),
        canvas_width: parseNumber(canvasWidth, sourceAsset?.width || 320),
        canvas_height: parseNumber(canvasHeight, sourceAsset?.height || 320),
        size: sourceAsset?.width && sourceAsset?.height ? `${sourceAsset.width}x${sourceAsset.height}` : "restored",
        model: "restore-version",
        status: "completed",
        is_favorite: false,
      });
      const operation = createDesignOperation(userId, {
        project_id: resolvedProjectId,
        input_asset_ids: [version.asset_id],
        output_asset_ids: [],
        kind: "restore_version",
        prompt: `恢复版本：${version.label || `v${version.version_index}`}`,
        provider: "local/history",
        model: "restore-version",
        params: {
          versionId: version.id,
          sourceAssetId: version.asset_id,
          parentAssetId: version.parent_asset_id,
        },
        status: "completed",
      });
      const outputAsset = createDesignAsset(userId, {
        project_id: resolvedProjectId,
        kind: "image",
        url: version.url,
        key: version.key,
        width: sourceAsset?.width || parseNumber(canvasWidth, 320),
        height: sourceAsset?.height || parseNumber(canvasHeight, 320),
        mime_type: sourceAsset?.mime_type || "image/png",
        metadata: {
          source: "restore_version",
          imageRecordId: restoredRecord.id,
          restoredFromVersionId: version.id,
          restoredFromAssetId: version.asset_id,
          operationId: operation.id,
        },
      });
      updateDesignOperation(operation.id, userId, { output_asset_ids: [outputAsset.id] });
      createAssetVersion(userId, {
        asset_id: outputAsset.id,
        parent_asset_id: version.asset_id,
        operation_id: operation.id,
        label: `恢复自 ${version.label || `v${version.version_index}`}`,
        url: version.url,
        key: version.key,
        metadata: {
          source: "restore_version",
          imageRecordId: restoredRecord.id,
          restoredFromVersionId: version.id,
        },
      });
      return NextResponse.json({
        success: true,
        record: restoredRecord,
        operation: { ...operation, output_asset_ids: [outputAsset.id] },
        outputAsset,
      });
    }

    const supabase = getSupabaseClient();
    const { data: version, error: versionError } = await supabase
      .from("asset_versions")
      .select("*")
      .eq("id", targetVersionId)
      .eq("user_id", userId)
      .single();
    if (versionError || !version) return NextResponse.json({ error: "版本不存在" }, { status: 404 });

    const { data: sourceAsset } = await supabase
      .from("design_assets")
      .select("*")
      .eq("id", version.asset_id)
      .eq("user_id", userId)
      .single();
    const resolvedProjectId = projectId || sourceAsset?.project_id || null;
    const width = parseNumber(canvasWidth, Number(sourceAsset?.width) || 320);
    const height = parseNumber(canvasHeight, Number(sourceAsset?.height) || 320);

    const { data: restoredRecord, error: recordError } = await supabase
      .from("image_records")
      .insert({
        project_id: resolvedProjectId,
        user_id: userId,
        prompt: `[恢复版本] ${version.label || `v${version.version_index}`}`,
        image_url: version.url,
        image_key: version.key,
        reference_images: JSON.stringify([version.asset_id]),
        canvas_x: parseNumber(canvasX, 80),
        canvas_y: parseNumber(canvasY, 80),
        canvas_width: width,
        canvas_height: height,
        size: Number(sourceAsset?.width) && Number(sourceAsset?.height) ? `${sourceAsset.width}x${sourceAsset.height}` : "restored",
        model: "restore-version",
        status: "completed",
        is_favorite: false,
      })
      .select()
      .single();
    if (recordError) throw recordError;

    const { data: operation, error: operationError } = await supabase
      .from("design_operations")
      .insert({
        project_id: resolvedProjectId,
        user_id: userId,
        input_asset_ids: [version.asset_id],
        output_asset_ids: [],
        kind: "restore_version",
        prompt: `恢复版本：${version.label || `v${version.version_index}`}`,
        provider: "history",
        model: "restore-version",
        params: {
          versionId: version.id,
          sourceAssetId: version.asset_id,
          parentAssetId: version.parent_asset_id,
        },
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (operationError) throw operationError;

    const { data: outputAsset, error: assetError } = await supabase
      .from("design_assets")
      .insert({
        project_id: resolvedProjectId,
        user_id: userId,
        kind: "image",
        url: version.url,
        key: version.key,
        width,
        height,
        mime_type: sourceAsset?.mime_type || "image/png",
        metadata: {
          source: "restore_version",
          imageRecordId: restoredRecord.id,
          restoredFromVersionId: version.id,
          restoredFromAssetId: version.asset_id,
          operationId: operation.id,
        },
      })
      .select()
      .single();
    if (assetError) throw assetError;

    await supabase.from("design_operations").update({ output_asset_ids: [outputAsset.id] }).eq("id", operation.id).eq("user_id", userId);
    await supabase.from("asset_versions").insert({
      asset_id: outputAsset.id,
      parent_asset_id: version.asset_id,
      operation_id: operation.id,
      user_id: userId,
      label: `恢复自 ${version.label || `v${version.version_index}`}`,
      url: version.url,
      key: version.key,
      metadata: {
        source: "restore_version",
        imageRecordId: restoredRecord.id,
        restoredFromVersionId: version.id,
      },
    });

    return NextResponse.json({
      success: true,
      record: restoredRecord,
      operation: { ...operation, output_asset_ids: [outputAsset.id] },
      outputAsset,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "恢复资产版本失败";
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
      const ok = deleteAssetVersion(id, userId);
      if (!ok) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("asset_versions").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除资产版本失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
