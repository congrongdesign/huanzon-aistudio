import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { createPrompt, deletePrompt, isLocalBackendEnabled, listPrompts, updatePrompt } from "@/lib/local-backend";

function toLocalAtom(item: ReturnType<typeof listPrompts>[number]) {
  return {
    id: item.id,
    name: item.name || item.content?.slice(0, 32) || item.text.slice(0, 32),
    content: item.content || item.text,
    category_id: item.category_id ?? 0,
    project_id: item.project_id,
    library_id: item.library_id ?? null,
    tags: item.tags || "",
    source: item.source || "",
    use_count: item.use_count ?? 0,
    is_hot: item.is_hot ?? 0,
    created_at: item.created_at,
    updated_at: item.updated_at || item.created_at,
  };
}

// GET /api/prompt-atoms - 获取原子词列表
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const subCategoryId = searchParams.get("subCategoryId");
    const keyword = searchParams.get("keyword");
    const libraryId = searchParams.get("libraryId");
    if (isLocalBackendEnabled()) {
      let data = listPrompts(userId).filter((item) => (item.kind || "atom") === "atom" || item.kind === "general");
      if (categoryId) data = data.filter((item) => (item.category_id ?? 0) === parseInt(categoryId));
      if (keyword) data = data.filter((item) => `${item.name || ""} ${item.content || item.text}`.toLowerCase().includes(keyword.toLowerCase()));
      if (libraryId) data = data.filter((item) => Number(item.library_id || 0) === parseInt(libraryId));
      return NextResponse.json({ data: data.map(toLocalAtom) });
    }
    const supabase = getSupabaseClient();

    let query = supabase
      .from("prompt_atom")
      .select("*")
      .order("use_count", { ascending: false })
      .order("created_at", { ascending: false });

    // If subCategoryId is specified, filter by that specific sub-category
    // Otherwise if categoryId is specified, filter by that category
    if (subCategoryId) {
      query = query.eq("category_id", parseInt(subCategoryId));
    } else if (categoryId) {
      query = query.eq("category_id", parseInt(categoryId));
    }
    if (keyword) query = query.ilike("content", `%${keyword}%`);
    if (libraryId) query = query.eq("library_id", parseInt(libraryId));

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data || [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/prompt-atoms - 创建原子词
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { name, content, category_id, project_id, source, library_id, tags } = body;
    if (!content) return NextResponse.json({ error: "提示词内容不能为空" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = createPrompt(userId, {
        project_id: project_id || null,
        text: content,
        name: name || content.slice(0, 32),
        content,
        category_id: category_id || 0,
        library_id: library_id || null,
        source: source || "",
        tags: tags || "",
        kind: "atom",
      });
      return NextResponse.json({ data: toLocalAtom(data) });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("prompt_atom")
      .insert({
        name: name || content.slice(0, 32),
        content,
        category_id: category_id || 0,
        project_id: project_id || null,
        library_id: library_id || null,
        source: source || '',
        tags: tags || '',
        use_count: 0,
        is_hot: 0,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/prompt-atoms - 更新原子词
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, content, category_id, is_hot, tags } = body;
    if (!id) return NextResponse.json({ error: "缺少原子词ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = updatePrompt(String(id), userId, {
        ...(name !== undefined ? { name } : {}),
        ...(content !== undefined ? { text: content, content } : {}),
        ...(category_id !== undefined ? { category_id } : {}),
        ...(is_hot !== undefined ? { is_hot } : {}),
        ...(tags !== undefined ? { tags } : {}),
      });
      if (!data) return NextResponse.json({ error: "原子词不存在" }, { status: 404 });
      return NextResponse.json({ data: toLocalAtom(data) });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (content !== undefined) updates.content = content;
    if (category_id !== undefined) updates.category_id = category_id;
    if (is_hot !== undefined) updates.is_hot = is_hot;
    if (tags !== undefined) updates.tags = tags;

    const { data, error } = await supabase
      .from("prompt_atom")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/prompt-atoms - 删除原子词
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少原子词ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: deletePrompt(id, userId) });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("prompt_atom").delete().eq("id", parseInt(id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
