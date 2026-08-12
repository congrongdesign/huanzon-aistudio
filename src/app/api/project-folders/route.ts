import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  createProjectFolder,
  deleteProjectFolder,
  isLocalBackendEnabled,
  listProjectFolders,
  updateProjectFolder,
} from "@/lib/local-backend";

// GET: List all project folders
export async function GET(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    if (isLocalBackendEnabled()) {
      const folders = listProjectFolders(userId);
      return NextResponse.json({ folders });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("project_folders")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ folders: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: Create a new folder
export async function POST(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    const { name, color, parent_id } = await req.json();

    if (isLocalBackendEnabled()) {
      const folder = createProjectFolder(userId, { name, color, parent_id });
      return NextResponse.json({ folder });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("project_folders")
      .insert({ name: name || "新建文件夹", color: color || "#6366f1", parent_id: parent_id || null })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ folder: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH: Update a folder (rename, color, collapse, move)
export async function PATCH(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    const { id, name, color, is_collapsed, sort_order, parent_id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const folder = updateProjectFolder(id, userId, { name, color, is_collapsed, sort_order, parent_id });
      if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      return NextResponse.json({ folder });
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (is_collapsed !== undefined) updates.is_collapsed = is_collapsed;
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("project_folders")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ folder: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: Delete a folder (projects moved to root)
export async function DELETE(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    const urlId = req.nextUrl.searchParams.get("id");
    let id = urlId;
    if (!id) {
      try { const body = await req.json(); id = body.id; } catch {}
    }
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const ok = deleteProjectFolder(id, userId);
      if (!ok) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    // Move projects in this folder to root
    await supabase.from("projects").update({ folder_id: null }).eq("folder_id", id);
    // Delete the folder
    const { error } = await supabase.from("project_folders").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
