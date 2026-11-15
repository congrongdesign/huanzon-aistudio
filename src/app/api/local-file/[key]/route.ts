import fs from 'node:fs';
import { stat, mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { getLocalDataDirectory, resolveLocalFilePath } from '@/lib/local-backend';
import { previewCacheLimitBytes } from '@/lib/media-storage';

const TYPES: Record<string, string> = { '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif' };
const raster = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const inflight = new Map<string, Promise<Buffer>>();
let active = 0;
const waiters: Array<() => void> = [];
let lastCleanup = 0;
function scheduleCacheCleanup(cache: string) {
  if (Date.now() - lastCleanup < 10 * 60 * 1000) return;
  lastCleanup = Date.now();
  void (async () => {
    const names = (await readdir(cache)).filter(name => name.endsWith('.webp'));
    const files = await Promise.all(names.map(async name => {
      const file = path.join(cache, name);
      const info = await stat(file).catch(() => null);
      return { file, size: info?.size || 0, time: info?.mtimeMs || 0 };
    }));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total <= previewCacheLimitBytes()) break;
      await unlink(file.file).catch(() => {});
      total -= file.size;
    }
  })().catch(error => console.error('Preview cache cleanup failed', error));
}
async function preview(file: string, width: number, version: string) {
  const key = createHash('sha256').update(`${file}:${width}:${version}`).digest('hex');
  const existing = inflight.get(key);
  if (existing) return existing;
  const task = (async () => {
    const cache = path.join(getLocalDataDirectory(), 'preview-cache');
    const target = path.join(cache, `${key}.webp`);
    try { return await readFile(target); } catch { /* cache miss */ }
    if (active >= 2) await new Promise<void>(resolve => waiters.push(resolve));
    else active++;
    try {
      const buffer = await sharp(file, { failOn: 'none' }).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      await mkdir(cache, { recursive: true });
      await writeFile(`${target}.tmp`, buffer);
      await rename(`${target}.tmp`, target);
      scheduleCacheCleanup(cache);
      return buffer;
    } finally { const next = waiters.shift(); if (next) next(); else active--; }
  })();
  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const safeKey = decodeURIComponent(key || '').replace(/[/\\]/g, '');
    if (!safeKey) return NextResponse.json({ error: 'key is required' }, { status: 400 });
    const file = resolveLocalFilePath(safeKey);
    let info;
    try { info = await stat(file); } catch { return NextResponse.json({ error: '文件不存在' }, { status: 404 }); }
    const download = request.nextUrl.searchParams.get('download') === '1';
    const wanted = Number(request.nextUrl.searchParams.get('w'));
    if (!download && wanted > 0 && Number.isFinite(wanted) && raster.has(path.extname(file).toLowerCase())) {
      const width = [128, 256, 512, 1024, 1600].find(size => size >= wanted) || 1600;
      const buffer = await preview(file, width, `${info.size}:${info.mtimeMs}`);
      return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' } });
    }
    const headers: Record<string, string> = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': String(info.size), 'Cache-Control': download ? 'no-store' : 'public, max-age=86400' };
    if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(request.nextUrl.searchParams.get('filename') || safeKey)}`;
    return new NextResponse(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取图片失败' }, { status: 500 });
  }
}
