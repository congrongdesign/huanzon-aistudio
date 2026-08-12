import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  getEditablePptPage,
  listEditablePptElementsByPage,
  updateEditablePptPage,
} from "@/lib/editable-ppt/store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { pageId } = await params;
    const page = getEditablePptPage(pageId, userId);
    if (!page) {
      return NextResponse.json({ error: "页面不存在" }, { status: 404 });
    }
    const elements = listEditablePptElementsByPage(pageId, userId);
    return NextResponse.json({ page, elements });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取页面失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { pageId } = await params;
    const body = await request.json();
    const page = updateEditablePptPage(pageId, userId, {
      title: typeof body.title === "string" ? body.title : undefined,
      role: typeof body.role === "string" ? body.role : undefined,
      manual_notes: typeof body.manual_notes === "string" ? body.manual_notes : undefined,
    });
    if (!page) {
      return NextResponse.json({ error: "页面不存在" }, { status: 404 });
    }
    return NextResponse.json({ page });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新页面失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
