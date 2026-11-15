import { randomUUID } from "node:crypto";

/**
 * Pinterest API v5 客户端（OAuth 2.0 + 读取画板/pin）。
 * 仅服务端使用，避免把 access token 暴露给前端。
 */

export const PINTEREST_API_BASE = "https://api.pinterest.com/v5";
export const PINTEREST_AUTH_BASE = "https://www.pinterest.com/oauth/";

/** 基础读取 scope（trial 模式个人账号够用；私密画板需要 _secret 变体） */
export const PINTEREST_SCOPES = ["boards:read", "pins:read", "user_accounts:read"];

export const PINTEREST_STATE_COOKIE = "pinterest_oauth_state";
export const PINTEREST_CONNECTED_FLAG = "pinterest_connected";

export interface PinterestConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getPinterestConfig(): PinterestConfig | null {
  const clientId = process.env.PINTEREST_CLIENT_ID?.trim();
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET?.trim();
  const redirectUri = process.env.PINTEREST_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export interface PinterestTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
}

export interface PinterestUserAccount {
  username: string;
  website_url?: string | null;
  profile_image?: string | null;
  account_type?: string;
}

export interface PinterestBoard {
  id: string;
  name: string;
  description: string | null;
  owner?: { username?: string } | null;
  privacy?: string;
  media?: { pin_count?: number; image_cover_url?: string } | null;
  created_at?: string;
}

export interface PinterestPinImage {
  url: string;
  width: number;
  height: number;
}

export interface PinterestPin {
  id: string;
  created_at?: string;
  title?: string | null;
  description?: string | null;
  media?: {
    images?: Record<string, PinterestPinImage>;
  } | null;
  link?: string | null;
  alt_text?: string | null;
}

export interface PinterestPage<T> {
  items: T[];
  bookmark: string | null;
}

export function buildAuthorizeUrl(config: PinterestConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: PINTEREST_SCOPES.join(","),
    state,
  });
  return `${PINTEREST_AUTH_BASE}?${params.toString()}`;
}

export function newOAuthState(): string {
  return randomUUID();
}

/** 用授权码换 access token */
export async function exchangeCodeForToken(
  config: PinterestConfig,
  code: string
): Promise<PinterestTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });

  const res = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinterest token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return (await res.json()) as PinterestTokenResponse;
}

/** 通用 API GET，带分页 bookmark */
export async function pinterestGet<T>(
  accessToken: string,
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${PINTEREST_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    let text = "";
    try {
      const json = (await res.json()) as { message?: string };
      text = json.message || "";
    } catch {
      text = await res.text().catch(() => "");
    }
    throw new Error(`Pinterest API ${path} failed (${res.status}): ${(text || "").slice(0, 300)}`);
  }

  return (await res.json()) as T;
}

export function getCurrentUser(accessToken: string): Promise<PinterestUserAccount> {
  return pinterestGet<PinterestUserAccount>(accessToken, "/user_account");
}

export function getBoards(accessToken: string, bookmark?: string | null): Promise<PinterestPage<PinterestBoard>> {
  const params: Record<string, string> = { page_size: "100" };
  if (bookmark) params.bookmark = bookmark;
  return pinterestGet<PinterestPage<PinterestBoard>>(accessToken, "/boards", params);
}

export function getBoardPins(
  accessToken: string,
  boardId: string,
  bookmark?: string | null
): Promise<PinterestPage<PinterestPin>> {
  const params: Record<string, string> = { page_size: "100" };
  if (bookmark) params.bookmark = bookmark;
  return pinterestGet<PinterestPage<PinterestPin>>(accessToken, `/boards/${encodeURIComponent(boardId)}/pins`, params);
}

export function getPin(accessToken: string, pinId: string): Promise<PinterestPin> {
  return pinterestGet<PinterestPin>(accessToken, `/pins/${encodeURIComponent(pinId)}`);
}

/** 从 pin 的 media.images 中挑出最大的一张 */
export function pickLargestPinImage(pin: PinterestPin): PinterestPinImage | null {
  const images = pin.media?.images;
  if (!images) return null;
  let best: PinterestPinImage | null = null;
  for (const img of Object.values(images)) {
    if (!img?.url) continue;
    if (!best || img.width * img.height > best.width * best.height) {
      best = img;
    }
  }
  return best;
}
