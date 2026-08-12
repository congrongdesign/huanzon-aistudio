import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { listEditablePptJobs } from "@/lib/editable-ppt/store";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const projectId = request.nextUrl.searchParams.get("projectId");
    const jobs = listEditablePptJobs(userId, projectId || null);
    return NextResponse.json({ items: jobs, total: jobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取任务失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
