import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  exchangeCodeForToken,
  getCurrentUser,
  getPinterestConfig,
  PINTEREST_STATE_COOKIE,
} from "@/lib/pinterest";
import { savePinterestConnection } from "@/lib/pinterest-connection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;

  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.redirect(`${origin}/?pinterest=error&reason=unauthorized`);
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(`${origin}/?pinterest=error&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return NextResponse.redirect(`${origin}/?pinterest=error&reason=missing_params`);
    }

    const expectedState = request.cookies.get(PINTEREST_STATE_COOKIE)?.value;
    if (!expectedState || expectedState !== state) {
      return NextResponse.redirect(`${origin}/?pinterest=error&reason=state_mismatch`);
    }

    const config = getPinterestConfig();
    if (!config) {
      return NextResponse.redirect(`${origin}/?pinterest=error&reason=not_configured`);
    }

    const token = await exchangeCodeForToken(config, code);
    if (!token.access_token) {
      return NextResponse.redirect(`${origin}/?pinterest=error&reason=no_token`);
    }

    let username: string | null = null;
    let userIdOnPlatform: string | null = null;
    try {
      const account = await getCurrentUser(token.access_token);
      username = account.username || null;
      userIdOnPlatform = account.username || null;
    } catch {
      // 拿不到用户信息不阻塞保存 token
    }

    await savePinterestConnection(userId, {
      accessToken: token.access_token,
      providerUserId: userIdOnPlatform,
      providerUsername: username,
      scopes: token.scope ?? null,
    });

    const response = NextResponse.redirect(`${origin}/?pinterest=connected`);
    response.cookies.delete(PINTEREST_STATE_COOKIE);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth 回调失败";
    return NextResponse.redirect(`${origin}/?pinterest=error&reason=${encodeURIComponent(message.slice(0, 200))}`);
  }
}
