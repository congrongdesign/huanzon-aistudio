import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { recordConversionTaskSyncError, syncConversionTaskFromCodia } from "@/lib/conversion/codia-task";
import { listConversionTasks } from "@/lib/conversion/store";
import type { ConversionTaskRecord } from "@/lib/conversion/types";

async function trySync(task: ConversionTaskRecord, apiKey?: string | null, baseUrl?: string | null) {
  try {
    return await syncConversionTaskFromCodia(task, apiKey, baseUrl);
  } catch (error) {
    return recordConversionTaskSyncError(task, error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const projectId = request.nextUrl.searchParams.get("projectId");
    const codiaApiKey = getCodiaApiKeyFromHeaders(request.headers);
    const codiaBaseUrl = getCodiaBaseUrlFromHeaders(request.headers);
    const tasks = listConversionTasks(userId, projectId || null);
    const items = await Promise.all(tasks.map((task) => trySync(task, codiaApiKey, codiaBaseUrl)));
    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取转换任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}
