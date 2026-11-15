import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getBoardPins, pickLargestPinImage } from "@/lib/pinterest";
import { getPinterestConnection } from "@/lib/pinterest-connection";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const connection = await getPinterestConnection(userId);
    if (!connection) {
      return NextResponse.json({ error: "未连接 Pinterest" }, { status: 401 });
    }

    const { boardId } = await params;
    const { searchParams } = new URL(request.url);
    const bookmark = searchParams.get("bookmark") || null;

    const page = await getBoardPins(connection.accessToken, boardId, bookmark);

    const pins = page.items.map((pin) => {
      const image = pickLargestPinImage(pin);
      return {
        id: pin.id,
        title: pin.title || pin.alt_text || "",
        description: pin.description || "",
        link: pin.link || null,
        imageUrl: image?.url ?? null,
        width: image?.width ?? 0,
        height: image?.height ?? 0,
        createdAt: pin.created_at ?? null,
      };
    });

    return NextResponse.json({ pins, bookmark: page.bookmark });
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取画板图片失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
