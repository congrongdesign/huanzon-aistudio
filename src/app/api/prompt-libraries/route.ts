import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled, ungroupPrompts } from "@/lib/local-backend";
import { listLocalLibraries, createLocalLibrary, updateLocalLibrary, deleteLocalLibrary } from "@/lib/prompt-library-store";

// GET /api/prompt-libraries - List libraries
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: listLocalLibraries(userId, projectId) });
    }

    const supabase = getSupabaseClient();
    // Always include global libraries (no project_id) + project-specific ones
    let query = supabase.from("prompt_libraries").select("*").order("is_default", { ascending: false }).order("created_at", { ascending: true });

    if (projectId) {
      query = query.or(`project_id.is.null,project_id.eq.${projectId}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // If no libraries exist for this project, check if there's a global default
    if (!data || data.length === 0) {
      const { data: globalDefault } = await supabase
        .from("prompt_libraries")
        .select("*")
        .eq("is_default", 1)
        .limit(1);

      if (globalDefault && globalDefault.length > 0) {
        // Return the global default library
        return NextResponse.json({ data: globalDefault });
      }

      // No default exists at all, create one without project_id
      const { data: newLib } = await supabase
        .from("prompt_libraries")
        .insert({ project_id: null, name: "默认提示词库", description: "", is_default: 1 })
        .select()
        .single();
      return NextResponse.json({ data: newLib ? [newLib] : [] });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error("Get libraries error:", error);
    return NextResponse.json({ error: "获取提示词库列表失败" }, { status: 500 });
  }
}

// POST /api/prompt-libraries - Create library
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const projectId = body.project_id ?? body.projectId ?? null;
    const { name, description } = body;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 50) return NextResponse.json({ error: "分组名称须为 1–50 个字符" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = createLocalLibrary(userId, { projectId, name, description });
      return NextResponse.json({ data, id: data.id });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("prompt_libraries")
      .insert({ project_id: projectId, name: name.trim(), description: description || "", is_default: 0 })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Create library error:", error);
    return NextResponse.json({ error: "创建提示词库失败" }, { status: 500 });
  }
}

// PATCH /api/prompt-libraries - Update library
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id, name, description } = await request.json();
    if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 50)) return NextResponse.json({ error: "分组名称须为 1–50 个字符" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = updateLocalLibrary(userId, Number(id), { name: name?.trim(), description });
      if (!data) return NextResponse.json({ error: "提示词库不存在" }, { status: 404 });
      return NextResponse.json({ data });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabase.from("prompt_libraries").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Update library error:", error);
    return NextResponse.json({ error: "更新提示词库失败" }, { status: 500 });
  }
}

// DELETE /api/prompt-libraries - Delete library
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const group = listLocalLibraries(userId).find(item => item.id === Number(id));
      if (!group || group.is_default === 1) return NextResponse.json({ error: "无法删除此分组" }, { status: 400 });
      // Deleting a group must never delete the prompts it contains.
      ungroupPrompts(userId, Number(id));
      const result = deleteLocalLibrary(userId, Number(id));
      if (!result.ok) return NextResponse.json({ error: result.error || "删除失败" }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // Check if default
    const { data: lib } = await supabase.from("prompt_libraries").select("is_default").eq("id", id).single();
    if (lib?.is_default === 1) return NextResponse.json({ error: "不能删除默认提示词库" }, { status: 400 });

    // Move prompts out of the deleted group while retaining their content.
    for (const table of ["prompt_atom", "prompt_package", "prompt_template"]) {
      const { error } = await supabase.from(table).update({ library_id: null }).eq("library_id", id);
      if (error) throw error;
    }
    const { error: moveError } = await supabase.from("prompt_library").update({ category: "general" }).eq("category", `group:${id}`);
    if (moveError) throw moveError;
    await supabase.from("prompt_versions").delete().eq("library_id", id);
    await supabase.from("prompt_libraries").delete().eq("id", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete library error:", error);
    return NextResponse.json({ error: "删除提示词库失败" }, { status: 500 });
  }
}
