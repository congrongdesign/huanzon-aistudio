import fs from 'fs';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getKnowledgeHubItemById } from '@/lib/knowledge-hub-store';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id') || '';
  const item = getKnowledgeHubItemById(id);
  if (!item || (item.source !== 'nas' && item.source !== 'local') || item.kind !== 'image') {
    return NextResponse.json({ error: '图片不存在' }, { status: 404 });
  }

  try {
    const thumb = request.nextUrl.searchParams.get('size') === 'thumb';
    const ext = item.externalId.split('.').pop()?.toLowerCase() || 'png';
    if (thumb && ext !== 'gif' && ext !== 'svg') {
      const buffer = await sharp(item.externalId, { limitInputPixels: false })
        .rotate()
        .resize({ width: 520, height: 520, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'content-type': 'image/webp',
          'cache-control': 'private, max-age=3600',
        },
      });
    }

    const buffer = fs.readFileSync(item.externalId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'content-type': MIME_BY_EXT[ext] || 'application/octet-stream',
        'cache-control': 'private, max-age=600',
      },
    });
  } catch {
    return NextResponse.json({ error: '图片读取失败' }, { status: 404 });
  }
}
