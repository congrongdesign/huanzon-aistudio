import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getSkillRun, listSkillRuns, refreshSkillRunResults } from '@/lib/skill-run-store';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (id === 'list') {
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
    return NextResponse.json({ runs: listSkillRuns(projectId, userId) });
  }

  const run = refreshSkillRunResults(id) || getSkillRun(id);
  if (!run || run.userId !== userId) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  return NextResponse.json({ run });
}
