import { isLocalBackendEnabled, getPlatformConnection, upsertPlatformConnection, deletePlatformConnection } from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export const PINTEREST_PROVIDER = "pinterest";

export interface PinterestConnectionData {
  accessToken: string;
  providerUserId: string | null;
  providerUsername: string | null;
  scopes: string | null;
}

/**
 * 读取当前用户的 Pinterest 连接。双模式：
 * - 本地模式：JSON 数据库
 * - Supabase 模式：platform_connections 表
 */
export async function getPinterestConnection(userId: string | null): Promise<PinterestConnectionData | null> {
  // 开发令牌回退：在开发者后台「生成访问令牌」获取的临时令牌，可用于 Trial 审核期间联调。
  // 正式环境请使用 OAuth（配置 PINTEREST_CLIENT_SECRET 后自动优先走 OAuth 存储的连接）。
  const devToken = process.env.PINTEREST_DEV_ACCESS_TOKEN?.trim();

  if (isLocalBackendEnabled()) {
    const conn = getPlatformConnection(userId, PINTEREST_PROVIDER);
    if (conn?.access_token) {
      return {
        accessToken: conn.access_token,
        providerUserId: conn.provider_user_id,
        providerUsername: conn.provider_username,
        scopes: conn.scopes,
      };
    }
    if (devToken) {
      return {
        accessToken: devToken,
        providerUserId: null,
        providerUsername: "开发令牌",
        scopes: "pins:read,boards:read,user_accounts:read",
      };
    }
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("platform_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", PINTEREST_PROVIDER)
    .maybeSingle();

  if (error) {
    throw new Error(`读取 Pinterest 连接失败：${error.message}`);
  }
  if (data?.access_token) {
    return {
      accessToken: data.access_token as string,
      providerUserId: (data.provider_user_id as string | null) ?? null,
      providerUsername: (data.provider_username as string | null) ?? null,
      scopes: (data.scopes as string | null) ?? null,
    };
  }
  if (devToken) {
    return {
      accessToken: devToken,
      providerUserId: null,
      providerUsername: "开发令牌",
      scopes: "pins:read,boards:read,user_accounts:read",
    };
  }
  return null;
}

export async function savePinterestConnection(
  userId: string | null,
  data: PinterestConnectionData,
): Promise<void> {
  if (isLocalBackendEnabled()) {
    upsertPlatformConnection(userId, PINTEREST_PROVIDER, {
      provider_user_id: data.providerUserId,
      provider_username: data.providerUsername,
      access_token: data.accessToken,
      scopes: data.scopes,
    });
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("platform_connections").upsert(
    {
      user_id: userId,
      provider: PINTEREST_PROVIDER,
      provider_user_id: data.providerUserId,
      provider_username: data.providerUsername,
      access_token: data.accessToken,
      scopes: data.scopes,
    },
    { onConflict: "user_id,provider" }
  );
  if (error) {
    throw new Error(`保存 Pinterest 连接失败：${error.message}（请确认 Supabase 已创建 platform_connections 表）`);
  }
}

export async function removePinterestConnection(userId: string | null): Promise<void> {
  if (isLocalBackendEnabled()) {
    deletePlatformConnection(userId, PINTEREST_PROVIDER);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("platform_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", PINTEREST_PROVIDER);
  if (error) {
    throw new Error(`断开 Pinterest 连接失败：${error.message}`);
  }
}
