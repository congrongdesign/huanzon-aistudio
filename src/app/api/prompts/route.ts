import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  createPrompt,
  deletePrompt,
  getProjectById,
  isLocalBackendEnabled,
  listPrompts,
} from "@/lib/local-backend";

export async function GET(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("projectId");

    if (isLocalBackendEnabled()) {
      const prompts = listPrompts(userId, projectId || undefined);
      return NextResponse.json({ prompts });
    }

    const supabase = getSupabaseClient();

    // Query via project ownership
    let query = supabase
      .from("prompt_library")
      .select("*, projects!inner(user_id)")
      .eq("projects.user_id", userId)
      .order("created_at", { ascending: false });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Remove joined data
    const prompts = (data || []).map((item: Record<string, unknown>) => {
      delete item.projects;
      return item;
    });

    return NextResponse.json({ prompts });
  } catch (err) {
    console.error("Get prompts error:", err);
    return NextResponse.json({ error: "获取提示词失败" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const { text, category, projectId, imageUrl } = body;

    if (!text || !projectId) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const project = getProjectById(projectId, userId);
      if (!project) {
        return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
      }
      const prompt = createPrompt(userId, {
        project_id: projectId,
        text,
        category: category || "general",
        image_url: imageUrl || null,
      });
      return NextResponse.json({ prompt });
    }

    const supabase = getSupabaseClient();

    // Verify project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (!project) {
      return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("prompt_library")
      .insert({
        project_id: projectId,
        text,
        category: category || "general",
        image_url: imageUrl || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ prompt: data });
  } catch (err) {
    console.error("Create prompt error:", err);
    return NextResponse.json({ error: "保存提示词失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少ID" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const ok = deletePrompt(id, userId);
      if (!ok) {
        return NextResponse.json({ error: "无权限删除" }, { status: 403 });
      }
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // Verify ownership via project
    const { data: prompt } = await supabase
      .from("prompt_library")
      .select("id, projects!inner(user_id)")
      .eq("id", id)
      .single();

    if (!prompt || (prompt.projects as unknown as { user_id: string }[])[0]?.user_id !== userId) {
      return NextResponse.json({ error: "无权限删除" }, { status: 403 });
    }

    const { error } = await supabase
      .from("prompt_library")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete prompt error:", err);
    return NextResponse.json({ error: "删除提示词失败" }, { status: 500 });
  }
}
