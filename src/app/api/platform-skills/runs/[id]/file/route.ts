import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getSkillRun, refreshSkillRunResults } from '@/lib/skill-run-store';

const MIME: Record<string, string> = {
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const relativePath = (request.nextUrl.searchParams.get('path') || '').trim();
  const run = refreshSkillRunResults(id) || getSkillRun(id);
  if (!run || run.userId !== userId) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (!relativePath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  const full = path.resolve(run.outputDir, relativePath);
  const root = path.resolve(run.outputDir);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    return NextResponse.json({ error: '非法路径' }, { status: 400 });
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  const ext = path.extname(full).toLowerCase();
  const buffer = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`,
      'cache-control': 'private, max-age=60',
    },
  });
}
