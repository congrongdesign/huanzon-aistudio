import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  deleteCanvasBlock,
  getCanvasBlockById,
  isLocalBackendEnabled,
  updateCanvasBlock,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const body = await request.json();

    if (isLocalBackendEnabled()) {
      const block = updateCanvasBlock(id, userId, {
        name: body.name,
        color: body.color,
        canvas_x: body.canvas_x,
        canvas_y: body.canvas_y,
        canvas_width: body.canvas_width,
        canvas_height: body.canvas_height,
        image_scale: body.image_scale,
        sort_mode: body.sort_mode,
        padding: body.padding,
        locked: body.locked,
      });
      if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
      return NextResponse.json({ success: true, block });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = String(body.name || "").trim() || "画板";
    if (body.color !== undefined) updates.color = String(body.color || "#3b82f6");
    if (body.canvas_x !== undefined) updates.canvas_x = Math.round(Number(body.canvas_x));
    if (body.canvas_y !== undefined) updates.canvas_y = Math.round(Number(body.canvas_y));
    if (body.canvas_width !== undefined) updates.canvas_width = Math.max(320, Math.round(Number(body.canvas_width)));
    if (body.canvas_height !== undefined) updates.canvas_height = Math.max(220, Math.round(Number(body.canvas_height)));
    if (body.image_scale !== undefined) {
      updates.image_scale = Math.max(0.4, Math.min(2.2, Number(body.image_scale) || 1));
    }
    if (body.sort_mode !== undefined) updates.sort_mode = String(body.sort_mode || "compact");
    if (body.padding !== undefined) updates.padding = Math.max(8, Math.round(Number(body.padding)));
    if (body.locked !== undefined) updates.locked = Boolean(body.locked);

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("canvas_blocks")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    return NextResponse.json({ success: true, block: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const block = getCanvasBlockById(id, userId);
      if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
      const ok = deleteCanvasBlock(id, userId);
      if (!ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error: clearError } = await supabase
      .from("image_records")
      .update({ canvas_block_id: null, block_order: 0, updated_at: new Date().toISOString() })
      .eq("canvas_block_id", id)
      .eq("user_id", userId);
    if (clearError) throw clearError;

    const { error } = await supabase
      .from("canvas_blocks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
