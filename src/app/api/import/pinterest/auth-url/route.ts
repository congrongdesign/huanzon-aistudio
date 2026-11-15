import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { buildAuthorizeUrl, getPinterestConfig, newOAuthState, PINTEREST_STATE_COOKIE } from "@/lib/pinterest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const config = getPinterestConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Pinterest 未配置，请在环境变量中设置 PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET / PINTEREST_REDIRECT_URI" },
        { status: 503 }
      );
    }

    const state = newOAuthState();
    const url = buildAuthorizeUrl(config, state);

    const response = NextResponse.json({ url });
    response.cookies.set(PINTEREST_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 10 * 60,
      path: "/",
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成授权链接失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
