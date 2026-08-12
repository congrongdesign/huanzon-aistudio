import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { createPrompt, deletePrompt, isLocalBackendEnabled, listPrompts, updatePrompt } from "@/lib/local-backend";

function toLocalPackage(item: ReturnType<typeof listPrompts>[number]) {
  return {
    id: item.id,
    name: item.name || item.content?.slice(0, 32) || item.text.slice(0, 32),
    content: item.content || item.text,
    atom_ids: item.atom_ids || "",
    category_id: item.category_id ?? 0,
    project_id: item.project_id,
    library_id: item.library_id ?? null,
    tags: item.tags || "",
    use_count: item.use_count ?? 0,
    created_at: item.created_at,
    updated_at: item.updated_at || item.created_at,
  };
}

// GET /api/prompt-packages - 获取组合包列表
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
      let data = listPrompts(userId).filter((item) => item.kind === "package");
      if (subCategoryId) data = data.filter((item) => (item.category_id ?? 0) === parseInt(subCategoryId));
      else if (categoryId) data = data.filter((item) => (item.category_id ?? 0) === parseInt(categoryId));
      if (keyword) data = data.filter((item) => `${item.name || ""} ${item.content || item.text}`.toLowerCase().includes(keyword.toLowerCase()));
      if (libraryId) data = data.filter((item) => Number(item.library_id || 0) === parseInt(libraryId));
      return NextResponse.json({ data: data.map(toLocalPackage) });
    }
    const supabase = getSupabaseClient();

    let query = supabase
      .from("prompt_package")
      .select("*")
      .order("use_count", { ascending: false })
      .order("created_at", { ascending: false });

    if (subCategoryId) {
      query = query.eq("category_id", parseInt(subCategoryId));
    } else if (categoryId) {
      query = query.eq("category_id", parseInt(categoryId));
    }
    if (keyword) query = query.ilike("name", `%${keyword}%`);
    if (libraryId) query = query.eq("library_id", parseInt(libraryId));

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data || [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/prompt-packages - 创建组合包
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { name, content, atom_ids, category_id, project_id, library_id, tags } = body;
    if (!name) return NextResponse.json({ error: "组合包名称不能为空" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = createPrompt(userId, {
        project_id: project_id || null,
        text: content || name,
        name,
        content: content || "",
        atom_ids: atom_ids || "",
        category_id: category_id || 0,
        library_id: library_id || null,
        tags: tags || "",
        kind: "package",
      });
      return NextResponse.json({ data: toLocalPackage(data) });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("prompt_package")
      .insert({
        name,
        content: content || "",
        atom_ids: atom_ids || "",
        category_id: category_id || 0,
        project_id: project_id || null,
        library_id: library_id || null,
        tags: tags || '',
        use_count: 0,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/prompt-packages - 更新组合包
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, content, atom_ids, category_id, tags } = body;
    if (!id) return NextResponse.json({ error: "缺少组合包ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = updatePrompt(String(id), userId, {
        ...(name !== undefined ? { name } : {}),
        ...(content !== undefined ? { text: content, content } : {}),
        ...(atom_ids !== undefined ? { atom_ids } : {}),
        ...(category_id !== undefined ? { category_id } : {}),
        ...(tags !== undefined ? { tags } : {}),
      });
      if (!data) return NextResponse.json({ error: "组合包不存在" }, { status: 404 });
      return NextResponse.json({ data: toLocalPackage(data) });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (content !== undefined) updates.content = content;
    if (atom_ids !== undefined) updates.atom_ids = atom_ids;
    if (category_id !== undefined) updates.category_id = category_id;
    if (tags !== undefined) updates.tags = tags;

    const { data, error } = await supabase
      .from("prompt_package")
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

// DELETE /api/prompt-packages - 删除组合包
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少组合包ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: deletePrompt(id, userId) });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("prompt_package").delete().eq("id", parseInt(id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
