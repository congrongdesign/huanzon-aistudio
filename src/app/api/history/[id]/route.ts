import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  getImageRecordById,
  isLocalBackendEnabled,
  updateImageRecord,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const record = updateImageRecord(id, userId, {
        is_favorite: body.is_favorite,
        project_id: body.project_id,
        canvas_block_id: body.canvas_block_id,
        block_order: body.block_order,
        canvas_x: body.canvas_x,
        canvas_y: body.canvas_y,
        canvas_width: body.canvas_width,
        canvas_height: body.canvas_height,
      });

      if (!record) {
        return NextResponse.json({ error: "Record not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, record });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.is_favorite !== undefined) updates.is_favorite = body.is_favorite;
    if (body.project_id !== undefined) updates.project_id = body.project_id;
    if (body.canvas_block_id !== undefined) updates.canvas_block_id = body.canvas_block_id;
    if (body.block_order !== undefined) updates.block_order = Math.round(body.block_order);
    if (body.canvas_x !== undefined) updates.canvas_x = body.canvas_x;
    if (body.canvas_y !== undefined) updates.canvas_y = body.canvas_y;
    if (body.canvas_width !== undefined) updates.canvas_width = body.canvas_width;
    if (body.canvas_height !== undefined) updates.canvas_height = body.canvas_height;

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("image_records")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();

    if (error) throw new Error(`Update failed: ${error.message}`);
    if (!data) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, record: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const record = getImageRecordById(id, userId);
      return NextResponse.json({ record, messages: [] });
    }

    const supabase = getSupabaseClient();
    const { data: record, error: recordError } = await supabase
      .from("image_records")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (recordError) throw new Error(`Query failed: ${recordError.message}`);

    const { data: messages, error: msgError } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("record_id", id)
      .order("created_at", { ascending: true });

    if (msgError) throw new Error(`Query messages failed: ${msgError.message}`);

    return NextResponse.json({ record, messages: messages || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
