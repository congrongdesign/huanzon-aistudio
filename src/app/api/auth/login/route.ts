import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { comparePassword, signToken } from '@/lib/auth';
import { DESKTOP_GUEST_USER } from '@/lib/guest';
import { isLocalBackendEnabled } from '@/lib/local-backend';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (isLocalBackendEnabled()) {
      const token = signToken({ userId: DESKTOP_GUEST_USER.id, email: DESKTOP_GUEST_USER.email || 'guest@local' });
      const response = NextResponse.json({ token, user: DESKTOP_GUEST_USER });
      response.cookies.set('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      });
      return response;
    }

    if (!email || !password) {
      return NextResponse.json({ error: '邮箱和密码是必填项' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, password_hash, username, name, avatar_url, created_at')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
    }

    const isValid = await comparePassword(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
    }

    const token = signToken({ userId: user.id, email: user.email });

    const response = NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
      },
    });

    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('Login error:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('COZE_SUPABASE_URL is not set') || message.includes('COZE_SUPABASE_ANON_KEY is not set')) {
      return NextResponse.json({ error: '缺少数据库配置，请联系管理员配置环境变量' }, { status: 500 });
    }
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
