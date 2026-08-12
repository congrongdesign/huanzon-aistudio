import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled } from "@/lib/local-backend";

// GET /api/prompt-categories - 获取分类列表
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // 1=属性分类 2=场景分类
    const parentId = searchParams.get("parentId");
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: [] });
    }
    const supabase = getSupabaseClient();

    let query = supabase
      .from("sys_category")
      .select("*")
      .eq("status", 1)
      .order("sort", { ascending: true });

    if (type) query = query.eq("type", parseInt(type));
    if (parentId !== null) query = query.eq("parent_id", parseInt(parentId || "0"));

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data || [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/prompt-categories - 创建分类
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { name, parent_id = 0, type = 1, sort = 0 } = body;
    if (!name) return NextResponse.json({ error: "分类名称不能为空" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: { id: Date.now(), name, parent_id, type, sort, status: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("sys_category")
      .insert({ name, parent_id, type, sort, status: 1 })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/prompt-categories - 更新分类
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, parent_id, sort, status } = body;
    if (!id) return NextResponse.json({ error: "缺少分类ID" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: { id, name, parent_id, sort, status, updated_at: new Date().toISOString() } });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    if (sort !== undefined) updates.sort = sort;
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabase
      .from("sys_category")
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

// DELETE /api/prompt-categories - 删除分类
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少分类ID" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    // 软删除：设为禁用
    const { error } = await supabase
      .from("sys_category")
      .update({ status: 0, updated_at: new Date().toISOString() })
      .eq("id", parseInt(id));

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
