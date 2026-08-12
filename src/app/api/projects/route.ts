import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { createProject, isLocalBackendEnabled, listProjects } from "@/lib/local-backend";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);

    if (isLocalBackendEnabled()) {
      const projects = listProjects(userId);
      return NextResponse.json({ projects });
    }

    const supabase = getSupabaseClient();

    let query = supabase
      .from("projects")
      .select("*")
      .order("is_pinned", { ascending: false })
      .order("sort_order", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // 如果已登录，只返回该用户的项目；未登录则返回无 user_id 的旧项目
    if (userId) {
      query = query.eq("user_id", userId);
    } else {
      query = query.is("user_id", null);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ projects: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch projects";
    console.error("GET /api/projects error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const name = body.name || "未命名项目";
    const folder_id = body.folder_id || null;

    if (isLocalBackendEnabled()) {
      const project = createProject(userId, name, folder_id);
      return NextResponse.json({ project });
    }

    const supabase = getSupabaseClient();

    const { data: topSortRows, error: topSortError } = await supabase
      .from("projects")
      .select("sort_order")
      .eq("user_id", userId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (topSortError) throw topSortError;
    const nextSortOrder = Number(topSortRows?.[0]?.sort_order ?? 0) + 1;

    const { data, error } = await supabase
      .from("projects")
      .insert({ name, user_id: userId, folder_id, sort_order: nextSortOrder })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ project: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create project";
    console.error("POST /api/projects error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
