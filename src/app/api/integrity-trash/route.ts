import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled, listDeletedProjects, listPrompts, restoreDeletedProject, restoreDeletedPrompt, permanentlyDeleteProject, permanentlyDeletePrompt } from '@/lib/local-backend';
export const dynamic = 'force-dynamic';
function owner(req: NextRequest) {
  const id = getCurrentUserId(req);
  if (!id) throw new Error('请先登录');
  if (!isLocalBackendEnabled()) throw new Error('此回收站目前支持本机模式');
  return id;
}
export async function GET(req: NextRequest) {
  try {
    const id = owner(req);
    return NextResponse.json({ projects: listDeletedProjects(id), prompts: listPrompts(id, undefined, true).filter(p => p.deleted_at) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
}
async function mutate(req: NextRequest, permanent: boolean) {
  try {
    const user = owner(req), body = await req.json();
    if (!['projects', 'prompts'].includes(body.kind) || typeof body.id !== 'string' || (permanent && body.confirm !== 'permanent-delete')) return NextResponse.json({ error: '操作参数不正确' }, { status: 400 });
    const ok = body.kind === 'projects'
      ? permanent ? permanentlyDeleteProject(body.id, user) : restoreDeletedProject(body.id, user)
      : permanent ? permanentlyDeletePrompt(body.id, user) : restoreDeletedPrompt(body.id, user);
    return NextResponse.json(ok ? { success: true } : { error: '条目不存在或已处理，请刷新回收站' }, { status: ok ? 200 : 404 });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
}
export async function PATCH(req: NextRequest) { return mutate(req, false); }
export async function DELETE(req: NextRequest) { return mutate(req, true); }
