import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { generationQueue } from '@/lib/generation-job-store';

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isLocalBackendEnabled()) return NextResponse.json({ error: '此队列用于本地桌面服务' }, { status: 409 });
  try {
    const { requestId, ...input } = await request.json();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 160 || typeof input.prompt !== 'string' || !input.prompt.trim()) return NextResponse.json({ error: '缺少任务编号或提示词' }, { status: 400 });
    if (input.destination?.kind === 'font') return NextResponse.json({ error: '请从字体创作提交任务' }, { status: 400 });
    const job = generationQueue().submit(userId, requestId, input.projectId || null, input);
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '提交任务失败' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isLocalBackendEnabled()) return NextResponse.json({ error: '此队列用于本地桌面服务' }, { status: 409 });
  const ids = (request.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 128);
  return NextResponse.json({ jobs: generationQueue().list(userId, ids) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isLocalBackendEnabled()) return NextResponse.json({ error: '此队列用于本地桌面服务' }, { status: 409 });
  const id = request.nextUrl.searchParams.get('id') || '';
  return NextResponse.json({ success: generationQueue().cancel(userId, id) });
}
