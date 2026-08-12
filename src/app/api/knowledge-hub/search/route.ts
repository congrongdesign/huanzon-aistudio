import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getProjectAssetPackById, KnowledgeHubItem, readKnowledgeHubIndex } from '@/lib/knowledge-hub-store';
import { getProjectById, isLocalBackendEnabled } from '@/lib/local-backend';

function scoreItem(item: KnowledgeHubItem, keywords: string[], source?: string): number {
  if (source && item.source !== source) return -1;

  const haystack = `${item.title} ${item.location} ${item.textSnippet || ''} ${item.contentPreview || ''}`.toLowerCase();
  let score = 0;

  for (const keyword of keywords) {
    if (!keyword) continue;
    if (item.title.toLowerCase().includes(keyword)) score += 5;
    if ((item.textSnippet || '').toLowerCase().includes(keyword)) score += 3;
    if ((item.contentPreview || '').toLowerCase().includes(keyword)) score += 2;
    if (haystack.includes(keyword)) score += 1;
  }

  if (keywords.length === 0) score += 1;
  if (item.kind === 'image') score += 0.5;
  if (item.source === 'nas') score += 0.2;

  return score;
}

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get('q') || '').trim();
  const source = (request.nextUrl.searchParams.get('source') || '').trim();
  const packId = (request.nextUrl.searchParams.get('packId') || '').trim();
  const limit = Math.max(1, Math.min(5000, Number(request.nextUrl.searchParams.get('limit') || 1000)));
  const pack = packId ? getProjectAssetPackById(packId) : null;
  if (packId && !pack) {
    return NextResponse.json({ error: '素材包不存在', items: [], total: 0 }, { status: 404 });
  }
  if (pack && isLocalBackendEnabled() && !getProjectById(pack.projectId, userId)) {
    return NextResponse.json({ error: '项目不存在或无权限', items: [], total: 0 }, { status: 403 });
  }

  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const index = readKnowledgeHubIndex();

  const scored = index.items
    .filter((item) => {
      if (!pack) return true;
      if (pack.source === 'feishu') {
        if (item.source !== 'feishu') return false;
        const spaces = new Set((pack.feishuSpaceIds || []).filter(Boolean));
        if (spaces.size === 0) return true;
        const spaceId = typeof item.metadata?.spaceId === 'string' ? item.metadata.spaceId : item.externalId.split(':')[0];
        return spaces.has(spaceId);
      }
      if (item.source !== pack.source && !(pack.source === 'nas' && item.source === 'nas')) return false;
      if (!pack.rootPath || typeof item.externalId !== 'string') return true;
      return item.externalId.startsWith(pack.rootPath);
    })
    .map((item) => ({ item, score: scoreItem(item, keywords, source || undefined) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);

  return NextResponse.json({
    query,
    total: scored.length,
    updatedAt: index.updatedAt,
    items: scored,
  });
}
