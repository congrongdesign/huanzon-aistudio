import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getPinterestConfig } from "@/lib/pinterest";
import { getPinterestConnection, removePinterestConnection } from "@/lib/pinterest-connection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const configured = Boolean(getPinterestConfig());
    const connection = await getPinterestConnection(userId);

    return NextResponse.json({
      connected: Boolean(connection),
      configured,
      providerUsername: connection?.providerUsername ?? null,
      scopes: connection?.scopes ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询连接失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await removePinterestConnection(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "断开连接失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
