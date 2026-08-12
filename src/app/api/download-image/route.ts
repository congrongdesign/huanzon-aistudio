import { NextRequest, NextResponse } from "next/server";

function sanitizeFilename(value: string): string {
  const clean = value.replace(/[\r\n"]/g, "").trim();
  return clean || `image-${Date.now()}.png`;
}

function resolveImageUrl(request: NextRequest, value: string): URL | null {
  try {
    const url = new URL(value, request.nextUrl.origin);
    const host = url.hostname.toLowerCase();
    const isRelative = value.startsWith("/");
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);
    if (isRelative) return new URL(`${url.pathname}${url.search}`, request.nextUrl.origin);
    if (url.protocol === "http:" && isLocalHost) {
      return new URL(`${url.pathname}${url.search}`, request.nextUrl.origin);
    }
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = resolveImageUrl(request, request.nextUrl.searchParams.get("url") || "");
  if (!url) {
    return NextResponse.json({ error: "无效的图片地址" }, { status: 400 });
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json({ error: `图片下载失败 (${response.status})` }, { status: 502 });
    }

    const filename = sanitizeFilename(request.nextUrl.searchParams.get("filename") || "");
    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片下载失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
