import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { recordConversionTaskSyncError, syncConversionTaskFromCodia } from "@/lib/conversion/codia-task";
import { deleteConversionTask, getConversionTask } from "@/lib/conversion/store";

export async function GET(
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
    try {
      return NextResponse.json({ task: await syncConversionTaskFromCodia(task, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers), { force: true }) });
    } catch (error) {
      return NextResponse.json({ task: recordConversionTaskSyncError(task, error) });
    }
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取转换任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { id } = await params;
    const ok = deleteConversionTask(id, userId);
    if (!ok) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除转换任务失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
