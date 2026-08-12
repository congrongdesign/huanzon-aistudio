import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { cancelCodiaTask, CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { getConversionTask, updateConversionTask } from "@/lib/conversion/store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const task = getConversionTask(id, userId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (task.codia_task_id) {
      await cancelCodiaTask(task.codia_task_id, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    }

    const updated = updateConversionTask(id, userId, {
      status: "canceled",
      progress: 100,
      error_message: "用户已取消任务",
    });
    return NextResponse.json({ task: updated });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "取消转换任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}
