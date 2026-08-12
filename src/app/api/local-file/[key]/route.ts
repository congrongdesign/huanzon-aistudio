import fs from "fs";
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { resolveLocalFilePath } from "@/lib/local-backend";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || "application/octet-stream";
}

// ─── Thumbnail pipeline (gallery perf) ───────────────────────────────────────
// Gallery cards request `?w=<width>`; we resize the local image once with sharp
// and cache the result in-memory (LRU) so scrolling the gallery never decodes
// full-size originals. Only raster formats we can safely re-encode are cached.
const THUMB_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const THUMB_CACHE_MAX = 300;
const thumbCache = new Map<string, { buffer: Buffer; contentType: string }>();

function isThumbnailable(filePath: string): boolean {
  return THUMB_IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

async function readWithThumbnail(filePath: string, width: number): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cacheKey = `${filePath}::${width}`;
  const cached = thumbCache.get(cacheKey);
  if (cached) return cached;
  try {
    const buffer = await sharp(fs.readFileSync(filePath), { failOn: "none" })
      .rotate() // honor EXIF orientation
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const entry = { buffer, contentType: "image/webp" };
    if (thumbCache.size >= THUMB_CACHE_MAX) {
      const oldest = thumbCache.keys().next().value;
      if (oldest !== undefined) thumbCache.delete(oldest);
    }
    thumbCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null; // fall back to serving the original
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;
    const safeKey = decodeURIComponent(key || "").replace(/[/\\]/g, "");
    if (!safeKey) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const filePath = resolveLocalFilePath(safeKey);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const wParam = Number(request.nextUrl.searchParams.get("w"));
    const wantThumb = Number.isFinite(wParam) && wParam > 0;
    if (wantThumb && isThumbnailable(filePath)) {
      const width = Math.min(1600, Math.max(32, Math.round(wParam)));
      const thumb = await readWithThumbnail(filePath, width);
      if (thumb) {
        return new NextResponse(new Uint8Array(thumb.buffer), {
          status: 200,
          headers: {
            "Content-Type": thumb.contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      // sharp failed on this file -> fall through and serve the original
    }
    const buffer = fs.readFileSync(filePath);
    const shouldDownload = request.nextUrl.searchParams.get("download") === "1";
    const filename = request.nextUrl.searchParams.get("filename") || safeKey;
    const headers: Record<string, string> = {
      "Content-Type": guessContentType(filePath),
      "Cache-Control": shouldDownload ? "no-store" : "public, max-age=31536000, immutable",
    };
    if (shouldDownload) {
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }
    return new NextResponse(buffer, {
      status: 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取文件失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
