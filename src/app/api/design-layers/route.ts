import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createDesignLayer,
  deleteDesignLayer,
  isLocalBackendEnabled,
  listDesignLayers,
  updateDesignLayer,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

function parseProps(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const documentId = searchParams.get("documentId");
    const assetId = searchParams.get("assetId");

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ layers: listDesignLayers(userId, { projectId, documentId, assetId }) });
    }

    const supabase = getSupabaseClient();
    let query = supabase.from("design_layers").select("*").eq("user_id", userId).order("z_index", { ascending: true });
    if (projectId) query = query.eq("project_id", projectId);
    if (documentId) query = query.eq("document_id", documentId);
    if (assetId) query = query.eq("asset_id", assetId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ layers: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取图层失败";
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
      assetId,
      type,
      name,
      x,
      y,
      width,
      height,
      opacity,
      visible,
      locked,
      zIndex,
      props,
    } = body;

    if (isLocalBackendEnabled()) {
      const layer = createDesignLayer(userId, {
        document_id: documentId || null,
        project_id: projectId || null,
        asset_id: assetId || null,
        type: type || "image",
        name: name || "图层",
        x: num(x),
        y: num(y),
        width: num(width),
        height: num(height),
        opacity: Number.isFinite(Number(opacity)) ? Number(opacity) : 1,
        visible: visible !== false,
        locked: locked === true,
        z_index: num(zIndex),
        props: parseProps(props),
      });
      return NextResponse.json({ layer });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("design_layers")
      .insert({
        document_id: documentId || null,
        project_id: projectId || null,
        user_id: userId,
        asset_id: assetId || null,
        type: type || "image",
        name: name || "图层",
        x: num(x),
        y: num(y),
        width: num(width),
        height: num(height),
        opacity: Number.isFinite(Number(opacity)) ? Number(opacity) : 1,
        visible: visible !== false,
        locked: locked === true,
        z_index: num(zIndex),
        props: parseProps(props),
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ layer: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建图层失败";
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
      assetId,
      type,
      name,
      x,
      y,
      width,
      height,
      opacity,
      visible,
      locked,
      zIndex,
      props,
    } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const layer = updateDesignLayer(id, userId, {
        document_id: documentId,
        project_id: projectId,
        asset_id: assetId,
        type,
        name,
        x,
        y,
        width,
        height,
        opacity,
        visible,
        locked,
        z_index: zIndex,
        props,
      });
      if (!layer) return NextResponse.json({ error: "图层不存在" }, { status: 404 });
      return NextResponse.json({ layer });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (documentId !== undefined) updates.document_id = documentId || null;
    if (projectId !== undefined) updates.project_id = projectId || null;
    if (assetId !== undefined) updates.asset_id = assetId || null;
    if (type !== undefined) updates.type = type;
    if (name !== undefined) updates.name = name;
    if (x !== undefined) updates.x = num(x);
    if (y !== undefined) updates.y = num(y);
    if (width !== undefined) updates.width = num(width);
    if (height !== undefined) updates.height = num(height);
    if (opacity !== undefined) updates.opacity = Number(opacity);
    if (visible !== undefined) updates.visible = visible;
    if (locked !== undefined) updates.locked = locked;
    if (zIndex !== undefined) updates.z_index = num(zIndex);
    if (props !== undefined) updates.props = parseProps(props);

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from("design_layers").update(updates).eq("id", id).eq("user_id", userId).select().single();
    if (error) throw error;
    return NextResponse.json({ layer: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新图层失败";
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
      const ok = deleteDesignLayer(id, userId);
      if (!ok) return NextResponse.json({ error: "图层不存在" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("design_layers").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除图层失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
