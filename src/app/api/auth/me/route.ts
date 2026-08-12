import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUserId } from '@/lib/auth';
import { DESKTOP_GUEST_USER, isDesktopGuestMode } from '@/lib/guest';
import { isLocalBackendEnabled } from '@/lib/local-backend';

export async function GET(request: NextRequest) {
  try {
    if (isDesktopGuestMode() || isLocalBackendEnabled()) {
      return NextResponse.json({ user: DESKTOP_GUEST_USER });
    }

    const userId = getCurrentUserId(request);

    if (!userId) {
      return NextResponse.json(
        { error: '未登录', user: null },
        { status: 401 }
      );
    }

    const supabase = getSupabaseClient();

    // 获取用户信息
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, username, name, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return NextResponse.json(
        { error: '用户不存在', user: null },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('COZE_SUPABASE_URL is not set') || message.includes('COZE_SUPABASE_ANON_KEY is not set')) {
      return NextResponse.json(
        { error: '缺少数据库配置，请联系管理员配置环境变量', user: null },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: '服务器错误', user: null },
      { status: 500 }
    );
  }
}
