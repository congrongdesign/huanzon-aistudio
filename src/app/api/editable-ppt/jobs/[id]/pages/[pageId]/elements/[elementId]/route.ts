import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { updateEditablePptElement } from "@/lib/editable-ppt/store";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string; elementId: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { elementId } = await params;
    const body = await request.json();
    const element = updateEditablePptElement(elementId, userId, {
      bbox_x: Number.isFinite(body.bbox_x) ? Number(body.bbox_x) : undefined,
      bbox_y: Number.isFinite(body.bbox_y) ? Number(body.bbox_y) : undefined,
      bbox_w: Number.isFinite(body.bbox_w) ? Number(body.bbox_w) : undefined,
      bbox_h: Number.isFinite(body.bbox_h) ? Number(body.bbox_h) : undefined,
      text_content: typeof body.text_content === "string" ? body.text_content : undefined,
      hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
      locked: typeof body.locked === "boolean" ? body.locked : undefined,
      style_json: body.style ? JSON.stringify(body.style) : undefined,
    });
    if (!element) {
      return NextResponse.json({ error: "元素不存在" }, { status: 404 });
    }
    return NextResponse.json({ element });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新元素失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
