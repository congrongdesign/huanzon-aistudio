import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { createPrompt, deletePrompt, isLocalBackendEnabled, listPrompts, updatePrompt } from "@/lib/local-backend";

function toLocalTemplate(item: ReturnType<typeof listPrompts>[number]) {
  return {
    id: item.id,
    name: item.name || item.content?.slice(0, 32) || item.text.slice(0, 32),
    content: item.content || item.text,
    category_id: item.category_id ?? 0,
    model: item.model || "",
    aspect_ratio: item.aspect_ratio || "",
    project_id: item.project_id,
    library_id: item.library_id ?? null,
    tags: item.tags || "",
    use_count: item.use_count ?? 0,
    vars: Array.isArray(item.vars) ? item.vars : [],
    created_at: item.created_at,
    updated_at: item.updated_at || item.created_at,
  };
}

// GET /api/prompt-templates - 获取业务模板列表
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const keyword = searchParams.get("keyword");
    const libraryId = searchParams.get("libraryId");
    if (isLocalBackendEnabled()) {
      let data = listPrompts(userId).filter((item) => item.kind === "template");
      if (categoryId) data = data.filter((item) => (item.category_id ?? 0) === parseInt(categoryId));
      if (keyword) data = data.filter((item) => `${item.name || ""} ${item.content || item.text}`.toLowerCase().includes(keyword.toLowerCase()));
      if (libraryId) data = data.filter((item) => Number(item.library_id || 0) === parseInt(libraryId));
      return NextResponse.json({ data: data.map(toLocalTemplate) });
    }
    const supabase = getSupabaseClient();

    let query = supabase
      .from("prompt_template")
      .select("*")
      .order("use_count", { ascending: false })
      .order("created_at", { ascending: false });

    if (categoryId) query = query.eq("category_id", parseInt(categoryId));
    if (keyword) query = query.ilike("name", `%${keyword}%`);
    if (libraryId) query = query.eq("library_id", parseInt(libraryId));

    const { data: templates, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // 获取关联变量
    if (templates && templates.length > 0) {
      const templateIds = templates.map((t: { id: number }) => t.id);
      const { data: vars } = await supabase
        .from("template_var")
        .select("*")
        .in("template_id", templateIds)
        .order("sort", { ascending: true });

      const varMap: Record<number, NonNullable<typeof vars>> = {};
      (vars || []).forEach((v: { template_id: number }) => {
        if (!varMap[v.template_id]) varMap[v.template_id] = [];
        varMap[v.template_id]!.push(v);
      });

      templates.forEach((t: { id: number; vars?: NonNullable<typeof vars> }) => {
        t.vars = varMap[t.id] || [];
      });
    }

    return NextResponse.json({ data: templates || [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/prompt-templates - 创建业务模板
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { name, content, category_id, model, aspect_ratio, vars, project_id, library_id, tags } = body;
    if (!name) return NextResponse.json({ error: "模板名称不能为空" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = createPrompt(userId, {
        project_id: project_id || null,
        text: content || name,
        name,
        content: content || "",
        category_id: category_id || 0,
        model: model || "",
        aspect_ratio: aspect_ratio || "",
        library_id: library_id || null,
        tags: tags || "",
        vars: vars || [],
        kind: "template",
      });
      return NextResponse.json({ data: toLocalTemplate(data) });
    }

    const supabase = getSupabaseClient();

    // 创建模板
    const { data: template, error: tErr } = await supabase
      .from("prompt_template")
      .insert({
        name,
        content: content || "",
        category_id: category_id || 0,
        model: model || "",
        aspect_ratio: aspect_ratio || "",
        project_id: project_id || null,
        library_id: library_id || null,
        tags: tags || '',
        use_count: 0,
      })
      .select()
      .single();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

    // 创建变量
    if (vars && vars.length > 0 && template) {
      const varRows = vars.map((v: { var_key: string; var_label: string; var_type: string; default_value: string; sub_category_id?: number | null; sort: number }, i: number) => ({
        template_id: template.id,
        var_key: v.var_key || `var_${i + 1}`,
        var_label: v.var_label || `变量${i + 1}`,
        var_type: v.var_type || "text",
        default_value: v.default_value || "",
        sub_category_id: v.sub_category_id || null,
        sort: v.sort ?? i,
      }));

      const { error: vErr } = await supabase.from("template_var").insert(varRows);
      if (vErr) console.error("Failed to insert template vars:", vErr);
    }

    return NextResponse.json({ data: template });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/prompt-templates - 更新业务模板
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, content, category_id, model, aspect_ratio, vars, tags } = body;
    if (!id) return NextResponse.json({ error: "缺少模板ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = updatePrompt(String(id), userId, {
        ...(name !== undefined ? { name } : {}),
        ...(content !== undefined ? { text: content, content } : {}),
        ...(category_id !== undefined ? { category_id } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(aspect_ratio !== undefined ? { aspect_ratio } : {}),
        ...(vars !== undefined ? { vars } : {}),
        ...(tags !== undefined ? { tags } : {}),
      });
      if (!data) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
      return NextResponse.json({ data: toLocalTemplate(data) });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (content !== undefined) updates.content = content;
    if (category_id !== undefined) updates.category_id = category_id;
    if (model !== undefined) updates.model = model;
    if (aspect_ratio !== undefined) updates.aspect_ratio = aspect_ratio;
    if (tags !== undefined) updates.tags = tags;

    const { data, error } = await supabase
      .from("prompt_template")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // 更新变量：先删后增
    if (vars !== undefined) {
      await supabase.from("template_var").delete().eq("template_id", id);
      if (vars.length > 0) {
        const varRows = vars.map((v: { var_key: string; var_label: string; var_type: string; default_value: string; sub_category_id?: number | null; sort: number }, i: number) => ({
          template_id: id,
          var_key: v.var_key || `var_${i + 1}`,
          var_label: v.var_label || `变量${i + 1}`,
          var_type: v.var_type || "text",
          default_value: v.default_value || "",
          sub_category_id: v.sub_category_id || null,
          sort: v.sort ?? i,
        }));
        await supabase.from("template_var").insert(varRows);
      }
    }

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/prompt-templates - 删除业务模板
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少模板ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: deletePrompt(id, userId) });
    }

    const supabase = getSupabaseClient();
    // 删除关联变量
    await supabase.from("template_var").delete().eq("template_id", parseInt(id));
    // 删除模板
    const { error } = await supabase.from("prompt_template").delete().eq("id", parseInt(id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
