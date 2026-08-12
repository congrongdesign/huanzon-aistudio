import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createCanvasBlock,
  isLocalBackendEnabled,
  listCanvasBlocks,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ blocks: listCanvasBlocks(userId, projectId) });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("canvas_blocks")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ blocks: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const projectId = typeof body.projectId === "string" ? body.projectId : null;
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const block = createCanvasBlock({
        user_id: userId,
        project_id: projectId,
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
      return NextResponse.json({ success: true, block });
    }

    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("canvas_blocks")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: typeof body.name === "string" ? body.name.trim() || "画板" : "画板",
        color: typeof body.color === "string" ? body.color : "#3b82f6",
        canvas_x: Math.round(Number(body.canvas_x ?? 80)),
        canvas_y: Math.round(Number(body.canvas_y ?? 80)),
        canvas_width: Math.max(320, Math.round(Number(body.canvas_width ?? 960))),
        canvas_height: Math.max(220, Math.round(Number(body.canvas_height ?? 600))),
        image_scale: Math.max(0.4, Math.min(2.2, Number(body.image_scale ?? 1) || 1)),
        sort_mode: typeof body.sort_mode === "string" ? body.sort_mode : "compact",
        padding: Math.max(8, Math.round(Number(body.padding ?? 20))),
        locked: Boolean(body.locked),
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, block: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
