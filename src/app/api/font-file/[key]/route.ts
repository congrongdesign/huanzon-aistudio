import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { getCurrentUserId } from '@/lib/auth';
import { fontFilePath } from '@/lib/font-library-store';

export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  try {
    const owner = getCurrentUserId(request);
    if (!owner) return new NextResponse(null, { status: 401 });
    const { key } = await context.params;
    const width = Number(request.nextUrl.searchParams.get('w'));
    const preview = width > 0 && !request.nextUrl.searchParams.has('download');
    const original = fontFilePath(key, owner);
    const file = original + (preview ? `.${width <= 128 ? 128 : 512}.webp` : '');
    const etag = `"${key}-${preview ? width <= 128 ? 128 : 512 : 'original'}"`;
    const info = await stat(file).catch(async (error: NodeJS.ErrnoException) => {
      if (!preview || error.code !== 'ENOENT') throw error;
      // Cleared font previews remain available without keeping permanent copies.
      const rebuilt = await sharp(original).rotate().resize({
        width: width <= 128 ? 128 : 512, height: width <= 128 ? 128 : 512,
        fit: 'inside', withoutEnlargement: true,
      }).webp({ quality: 84 }).toBuffer();
      return { rebuilt, size: rebuilt.length };
    });
    if (request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304 });
    const body = 'rebuilt' in info ? new Uint8Array(info.rebuilt) : Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new NextResponse(body, { headers: {
      'Content-Type': preview || key.endsWith('.webp') ? 'image/webp' : key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Content-Length': String(info.size), 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag,
      ...(request.nextUrl.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="font-design.${key.split('.').pop()}"` } : {}),
    } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
