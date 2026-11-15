import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { runGeneration } from "@/lib/run-generation";

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await request.json();
  if (body.destination?.kind === "font") return NextResponse.json({ error: "请从字体创作提交任务" }, { status: 400 });
  const result = await runGeneration(userId, body, request.signal);
  return NextResponse.json(result.payload, { status: result.status });
}
