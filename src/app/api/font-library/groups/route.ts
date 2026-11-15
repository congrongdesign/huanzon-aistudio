import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { changeFontGroup, FontStoreError } from '@/lib/font-library-store';
async function handle(request: NextRequest, action: string) {
  try { const owner = getCurrentUserId(request); if (!owner) throw new FontStoreError('未登录', 401); if (!isLocalBackendEnabled()) throw new FontStoreError('请使用本机模式', 501); const body = await request.json(); return NextResponse.json({ groups: await changeFontGroup(owner, action, body.id, body.name) }); }
  catch (e) { return NextResponse.json({ error: e instanceof FontStoreError ? e.message : '分组保存失败' }, { status: e instanceof FontStoreError ? e.status : 500 }); }
}
export const POST = (r: NextRequest) => handle(r, 'create');
export const PATCH = (r: NextRequest) => handle(r, 'rename');
export const DELETE = (r: NextRequest) => handle(r, 'delete');
