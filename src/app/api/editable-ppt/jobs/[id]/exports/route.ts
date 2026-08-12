import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { listEditablePptExports } from "@/lib/editable-ppt/store";

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
    const items = listEditablePptExports(id, userId);
    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取导出记录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
