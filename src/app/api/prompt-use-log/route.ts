import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled } from "@/lib/local-backend";

// POST /api/prompt-use-log - 记录使用日志 + 递增use_count
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { prompt_type, prompt_id, project_id } = body;
    if (!prompt_type || !prompt_id) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // 写入使用日志
    await supabase.from("prompt_use_log").insert({
      prompt_type,
      prompt_id,
      project_id: project_id || null,
    });

    // 递增对应表的 use_count
    const tableMap: Record<string, string> = {
      atom: "prompt_atom",
      package: "prompt_package",
      template: "prompt_template",
    };
    const tableName = tableMap[prompt_type];
    if (tableName) {
      const { data: current } = await supabase
        .from(tableName)
        .select("use_count")
        .eq("id", prompt_id)
        .single();

      if (current) {
        await supabase
          .from(tableName)
          .update({ use_count: (current.use_count || 0) + 1 })
          .eq("id", prompt_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET /api/prompt-use-log - 获取使用统计
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (isLocalBackendEnabled()) {
      return NextResponse.json({
        data: {
          atom: { total: 0, items: {} },
          package: { total: 0, items: {} },
          template: { total: 0, items: {} },
        },
      });
    }
    const supabase = getSupabaseClient();

    // 按类型统计
    let query = supabase
      .from("prompt_use_log")
      .select("prompt_type, prompt_id, created_at")
      .order("created_at", { ascending: false });

    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query.limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // 汇总统计
    const stats: Record<string, { total: number; items: Record<string, number> }> = {
      atom: { total: 0, items: {} },
      package: { total: 0, items: {} },
      template: { total: 0, items: {} },
    };

    (data || []).forEach((log: { prompt_type: string; prompt_id: number }) => {
      const t = log.prompt_type;
      if (stats[t]) {
        stats[t].total++;
        stats[t].items[log.prompt_id] = (stats[t].items[log.prompt_id] || 0) + 1;
      }
    });

    return NextResponse.json({ data: stats });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
