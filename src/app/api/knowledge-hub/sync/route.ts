import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { readKnowledgeHubConfig } from '@/lib/knowledge-hub-store';
import { syncKnowledgeHub } from '@/lib/knowledge-hub-sync';

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const config = readKnowledgeHubConfig();
  const result = await syncKnowledgeHub(config);

  return NextResponse.json(result);
}
