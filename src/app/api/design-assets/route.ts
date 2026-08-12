import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createDesignAsset,
  deleteDesignAsset,
  getDesignAssetById,
  isLocalBackendEnabled,
  listDesignAssets,
  updateDesignAsset,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const projectId = searchParams.get("projectId");
    const kind = searchParams.get("kind");
    const imageRecordId = searchParams.get("imageRecordId");

    if (isLocalBackendEnabled()) {
      if (id) {
        const asset = getDesignAssetById(id, userId);
        if (!asset) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
        return NextResponse.json({ asset });
      }
      let assets = listDesignAssets(userId, { projectId, kind });
      if (imageRecordId) {
        assets = assets.filter((asset) => {
          const metadata = parseMetadata(asset.metadata);
          return metadata.imageRecordId === imageRecordId || metadata.originalImageId === imageRecordId;
        });
      }
      return NextResponse.json({ assets });
    }

    const supabase = getSupabaseClient();
    if (id) {
      const { data, error } = await supabase.from("design_assets").select("*").eq("id", id).eq("user_id", userId).single();
      if (error) return NextResponse.json({ error: error.message }, { status: 404 });
      return NextResponse.json({ asset: data });
    }

    let query = supabase.from("design_assets").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) throw error;
    let assets = data || [];
    if (imageRecordId) {
      assets = assets.filter((asset: Record<string, unknown>) => {
        const metadata = parseMetadata(asset.metadata);
        return metadata.imageRecordId === imageRecordId || metadata.originalImageId === imageRecordId;
      });
    }
    return NextResponse.json({ assets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取设计资产失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const { projectId, kind, url, key, width, height, mimeType, metadata } = body;
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const asset = createDesignAsset(userId, {
        project_id: projectId || null,
        kind: kind || "image",
        url,
        key: key || null,
        width: parseNumber(width),
        height: parseNumber(height),
        mime_type: mimeType || "image/png",
        metadata: parseMetadata(metadata),
      });
      return NextResponse.json({ asset });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("design_assets")
      .insert({
        project_id: projectId || null,
        user_id: userId,
        kind: kind || "image",
        url,
        key: key || null,
        width: parseNumber(width),
        height: parseNumber(height),
        mime_type: mimeType || "image/png",
        metadata: parseMetadata(metadata),
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ asset: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建设计资产失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const { id, projectId, kind, url, key, width, height, mimeType, metadata } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const asset = updateDesignAsset(id, userId, {
        project_id: projectId,
        kind,
        url,
        key,
        width,
        height,
        mime_type: mimeType,
        metadata,
      });
      if (!asset) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
      return NextResponse.json({ asset });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (projectId !== undefined) updates.project_id = projectId || null;
    if (kind !== undefined) updates.kind = kind;
    if (url !== undefined) updates.url = url;
    if (key !== undefined) updates.key = key || null;
    if (width !== undefined) updates.width = parseNumber(width);
    if (height !== undefined) updates.height = parseNumber(height);
    if (mimeType !== undefined) updates.mime_type = mimeType;
    if (metadata !== undefined) updates.metadata = parseMetadata(metadata);

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from("design_assets").update(updates).eq("id", id).eq("user_id", userId).select().single();
    if (error) throw error;
    return NextResponse.json({ asset: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新设计资产失败";
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
      const ok = deleteDesignAsset(id, userId);
      if (!ok) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("design_assets").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除设计资产失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
