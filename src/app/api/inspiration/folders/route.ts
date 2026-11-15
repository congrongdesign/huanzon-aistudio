import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  createInspirationFolder,
  deleteInspirationFolderCascade,
  isLocalBackendEnabled,
  listInspirationFolders,
  updateInspirationFolder,
} from "@/lib/local-backend";

export async function GET(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");

  if (isLocalBackendEnabled()) {
    return NextResponse.json({ folders: listInspirationFolders(userId, projectId) });
  }

  const supabase = getSupabaseClient();
  let query = supabase.from("inspiration_folders").select("*").eq("user_id", userId).order("sort_order", { ascending: true });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ folders: data });
}

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  const { name, parent_id, project_id, color } = body;
  const projectId = project_id || null;

  if (isLocalBackendEnabled()) {
    const folders = listInspirationFolders(userId, projectId);
    const lastOrder = folders.reduce((max, folder) => Math.max(max, folder.sort_order || 0), 0);
    const folder = createInspirationFolder(userId, {
      name: name || "新建文件夹",
      parent_id: parent_id || null,
      project_id: projectId,
      sort_order: lastOrder + 1,
      color: color || "#6366f1",
    });
    return NextResponse.json({ folder });
  }

  const supabase = getSupabaseClient();
  const { data: existing } = await supabase
    .from("inspiration_folders")
    .select("sort_order")
    .eq("user_id", userId)
    .eq("project_id", projectId || "")
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order || 0) + 1;

  const { data, error } = await supabase
    .from("inspiration_folders")
    .insert({
      name: name || "新建文件夹",
      parent_id: parent_id || null,
      project_id: projectId,
      user_id: userId,
      sort_order: nextOrder,
      color: color || "#6366f1",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ folder: data });
}

export async function PATCH(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  const { id, name, color, sort_order, parent_id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const folder = updateInspirationFolder(id, userId, { name, color, sort_order, parent_id });
    if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    return NextResponse.json({ folder });
  }

  const supabase = getSupabaseClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (parent_id !== undefined) updates.parent_id = parent_id;

  const { data, error } = await supabase
    .from("inspiration_folders")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ folder: data });
}

export async function DELETE(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id") || (await req.json().catch(() => ({}))).id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const result = deleteInspirationFolderCascade(id, userId);
    if (!result.deleted) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  const supabase = getSupabaseClient();
  const { data: folder } = await supabase
    .from("inspiration_folders")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!folder || folder.user_id !== userId) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  await supabase.from("inspiration_items").delete().eq("folder_id", id);

  const { data: children } = await supabase
    .from("inspiration_folders")
    .select("id")
    .eq("parent_id", id);

  if (children && children.length > 0) {
    for (const child of children) {
      await supabase.from("inspiration_items").delete().eq("folder_id", child.id);
      await supabase.from("inspiration_folders").delete().eq("id", child.id);
    }
  }

  const { error } = await supabase.from("inspiration_folders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
