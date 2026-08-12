import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled } from "@/lib/local-backend";

// GET /api/prompt-test - Get test records
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const limit = parseInt(searchParams.get("limit") || "50");
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: [] });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("prompt_test_records")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error("Get prompt test records error:", error);
    return NextResponse.json({ error: "获取测试记录失败" }, { status: 500 });
  }
}

// POST /api/prompt-test - Create test record
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { project_id, reference_image_url, prompt, generated_image_url, score, notes, model, aspect_ratio } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "提示词不能为空" }, { status: 400 });
    }
    if (isLocalBackendEnabled()) {
      return NextResponse.json({
        data: {
          id: Date.now(),
          project_id,
          reference_image_url,
          prompt,
          generated_image_url,
          score: score || 0,
          notes,
          model,
          aspect_ratio,
          created_at: new Date().toISOString(),
        },
      });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("prompt_test_records")
      .insert({
        project_id,
        reference_image_url,
        prompt,
        generated_image_url,
        score: score || 0,
        notes,
        model,
        aspect_ratio,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Create prompt test record error:", error);
    return NextResponse.json({ error: "创建测试记录失败" }, { status: 500 });
  }
}

// PATCH /api/prompt-test - Update test record (score)
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, score, notes, generated_image_url } = body;

    if (!id) {
      return NextResponse.json({ error: "缺少记录ID" }, { status: 400 });
    }
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: { id, score, notes, generated_image_url } });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = {};
    if (score !== undefined) updates.score = score;
    if (notes !== undefined) updates.notes = notes;
    if (generated_image_url !== undefined) updates.generated_image_url = generated_image_url;

    const { data, error } = await supabase
      .from("prompt_test_records")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Update prompt test record error:", error);
    return NextResponse.json({ error: "更新测试记录失败" }, { status: 500 });
  }
}

// DELETE /api/prompt-test - Delete test record
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少记录ID" }, { status: 400 });
    }
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("prompt_test_records")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete prompt test record error:", error);
    return NextResponse.json({ error: "删除测试记录失败" }, { status: 500 });
  }
}
