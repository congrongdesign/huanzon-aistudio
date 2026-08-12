import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import {
  getDefaultKnowledgeHubConfig,
  KnowledgeHubConfigPatch,
  readKnowledgeHubConfig,
  writeKnowledgeHubConfig,
} from '@/lib/knowledge-hub-store';

function assertAuth(request: NextRequest): string | null {
  return getCurrentUserId(request);
}

export async function GET(request: NextRequest) {
  const userId = assertAuth(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const config = readKnowledgeHubConfig();
  return NextResponse.json({
    config,
    defaults: getDefaultKnowledgeHubConfig(),
  });
}

export async function POST(request: NextRequest) {
  const userId = assertAuth(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as KnowledgeHubConfigPatch;

    const config = writeKnowledgeHubConfig(body || {});
    return NextResponse.json({ success: true, config });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '保存配置失败' },
      { status: 400 },
    );
  }
}
