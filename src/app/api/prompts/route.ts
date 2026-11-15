import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  createPrompt,
  deletePrompt,
  getProjectById,
  isLocalBackendEnabled,
  listPrompts,
  updatePrompt,
} from "@/lib/local-backend";
import { listLocalLibraries } from "@/lib/prompt-library-store";

function readMetadata(body: Record<string, unknown>) {
  const patch: { name?: string; tags?: string; source?: string } = {};
  for (const key of ['name', 'tags', 'source'] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string' || body[key].length > (key === 'name' ? 160 : 12000)) throw new Error('提示词标题、标签或来源格式不正确');
    patch[key] = body[key].trim();
  }
  return patch;
}

async function resolveGroup(userId: string, groupId: unknown) {
  if (groupId === undefined || groupId === null || groupId === "") return { category: "general", library_id: null };
  if (typeof groupId !== "number" || !Number.isSafeInteger(groupId) || groupId < 1) return null;
  if (isLocalBackendEnabled()) {
    if (!listLocalLibraries(userId).some(group => group.id === groupId && group.is_default !== 1)) return null;
  } else {
    const { data } = await getSupabaseClient().from("prompt_libraries").select("id").eq("id", groupId).single();
    if (!data) return null;
  }
  return { category: `group:${groupId}`, library_id: groupId };
}

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

    if (typeof text !== "string" || !text.trim() || !projectId) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }
    if (text.length > 30000) return NextResponse.json({ error: "提示词最多 30000 个字符" }, { status: 400 });
    const group = await resolveGroup(userId, body.groupId);
    if (!group) return NextResponse.json({ error: "提示词分组不存在" }, { status: 400 });
    const targetCategory = body.groupId !== undefined ? group.category : category || "general";

    if (isLocalBackendEnabled()) {
      const project = getProjectById(projectId, userId);
      if (!project) {
        return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
      }
      const prompt = createPrompt(userId, {
        project_id: projectId,
        text: text.trim(),
        category: targetCategory,
        library_id: group.library_id,
        image_url: imageUrl || null,
        ...readMetadata(body),
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
        text: text.trim(),
        category: targetCategory,
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

export async function PATCH(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await req.json();
    const { id, groupId, text } = body;
    if (typeof id !== "string" || !id || (groupId === undefined && text === undefined && body.name === undefined && body.tags === undefined && body.source === undefined && body.imageUrl === undefined)) return NextResponse.json({ error: "缺少要更新的提示词" }, { status: 400 });
    if (text !== undefined && (typeof text !== "string" || !text.trim() || text.length > 30000)) return NextResponse.json({ error: "提示词须为 1–30000 个字符" }, { status: 400 });
    const group = groupId === undefined ? undefined : await resolveGroup(userId, groupId);
    if (group === null) return NextResponse.json({ error: "提示词分组不存在" }, { status: 400 });
    if (body.imageUrl !== undefined && body.imageUrl !== null && (typeof body.imageUrl !== 'string' || body.imageUrl.length > 4000 || !/^(https?:\/\/|\/(?:prompt-previews\/|api\/local-file\/))/.test(body.imageUrl))) return NextResponse.json({ error: "预览图地址无效" }, { status: 400 });
    const patch = { ...(body.imageUrl === undefined ? {} : { image_url: body.imageUrl }), ...group, ...(text === undefined ? {} : { text: text.trim() }) };
    if (isLocalBackendEnabled()) {
      const prompt = updatePrompt(id, userId, { ...patch, ...readMetadata(body) });
      if (!prompt) return NextResponse.json({ error: "提示词不存在或无权限" }, { status: 404 });
      return NextResponse.json({ prompt });
    }
    const supabase = getSupabaseClient();
    const { data: owned } = await supabase.from("prompt_library").select("id, projects!inner(user_id)").eq("id", id).eq("projects.user_id", userId).single();
    if (!owned) return NextResponse.json({ error: "提示词不存在或无权限" }, { status: 404 });
    const { data, error } = await supabase.from("prompt_library").update({ ...(group ? { category: group.category } : {}), ...(text === undefined ? {} : { text: text.trim() }) }).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ prompt: data });
  } catch (err) {
    console.error("Update prompt error:", err);
    return NextResponse.json({ error: "更新提示词失败" }, { status: 500 });
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
