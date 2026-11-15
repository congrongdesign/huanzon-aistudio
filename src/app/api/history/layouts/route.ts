import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled, updateImageLayouts } from '@/lib/local-backend';

export async function PATCH(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isLocalBackendEnabled()) return NextResponse.json({ error: '请使用单条布局保存' }, { status: 409 });
  const { layouts } = await request.json();
  if (!Array.isArray(layouts) || layouts.length > 500 || layouts.some(item => !item || typeof item.id !== 'string')) return NextResponse.json({ error: '无效布局' }, { status: 400 });
  return NextResponse.json({ updated: updateImageLayouts(userId, layouts) });
}
