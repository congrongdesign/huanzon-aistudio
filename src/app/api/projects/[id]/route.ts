import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  deleteProjectCascade,
  getProjectById,
  isLocalBackendEnabled,
  updateProject,
} from "@/lib/local-backend";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getCurrentUserId(request);
    const { id } = await params;

    if (isLocalBackendEnabled()) {
      const project = getProjectById(id, userId);
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json({ project });
    }

    const supabase = getSupabaseClient();

    let query = supabase.from("projects").select("*").eq("id", id);
    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query.single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ project: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch project";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    if (isLocalBackendEnabled()) {
      const project = updateProject(id, userId, {
        name: body.name,
        is_pinned: body.is_pinned,
        sort_order: body.sort_order,
        folder_id: body.folder_id,
      });
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json({ project });
    }

    const supabase = getSupabaseClient();

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.is_pinned !== undefined) updateData.is_pinned = body.is_pinned;
    if (body.sort_order !== undefined) updateData.sort_order = body.sort_order;
    if (body.folder_id !== undefined) updateData.folder_id = body.folder_id;

    const { data, error } = await supabase
      .from("projects")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ project: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update project";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;

    if (isLocalBackendEnabled()) {
      const deleted = deleteProjectCascade(id, userId);
      if (!deleted) {
        return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
      }
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // 验证项目属于当前用户
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (!project) {
      return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
    }

    await supabase.from("chat_messages").delete().eq("project_id", id);
    await supabase.from("image_records").delete().eq("project_id", id);
    const { error } = await supabase.from("projects").delete().eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete project";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
