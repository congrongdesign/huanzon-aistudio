import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { stageImportContent, ImportError } from '@/lib/library-import-service';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const owner = getCurrentUserId(req); if (!owner) throw new ImportError('请先登录', 401);
    if (!isLocalBackendEnabled()) throw new ImportError('请使用本机模式', 501);
    if (!req.body) throw new ImportError('请选择图片');
    return NextResponse.json({ item: await stageImportContent(owner, (await context.params).id, req.body) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '接收图片失败' }, { status: e instanceof ImportError ? e.status : 500 }); }
}
