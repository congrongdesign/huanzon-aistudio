import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getBoards } from "@/lib/pinterest";
import { getPinterestConnection } from "@/lib/pinterest-connection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const connection = await getPinterestConnection(userId);
    if (!connection) {
      return NextResponse.json({ error: "未连接 Pinterest" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const bookmark = searchParams.get("bookmark") || null;
    const page = await getBoards(connection.accessToken, bookmark);

    const boards = page.items.map((board) => ({
      id: board.id,
      name: board.name,
      description: board.description,
      privacy: board.privacy,
      pinCount: board.media?.pin_count ?? 0,
      coverUrl: board.media?.image_cover_url ?? null,
    }));

    return NextResponse.json({ boards, bookmark: page.bookmark });
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取画板失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
