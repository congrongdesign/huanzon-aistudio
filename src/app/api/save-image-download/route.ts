import { NextRequest, NextResponse } from "next/server";
import { getRuntimeBackendMode, getRuntimeDownloadDirectory, getRuntimeLanRole } from "@/lib/runtime-config";
import { saveRemoteImageToDownloadDirectory } from "@/lib/local-backend";
import { isCozeCloudRuntime } from "@/lib/deploy-mode";

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

export async function POST(request: NextRequest) {
  try {
    if (isCozeCloudRuntime()) {
      return NextResponse.json({ error: "扣子云端版不支持保存到服务器本机目录，请使用浏览器下载。" }, { status: 403 });
    }

    const body = await request.json();
    const rawUrl = typeof body.url === "string" ? body.url : "";
    const resolvedUrl = resolveImageUrl(request, rawUrl);
    if (!resolvedUrl) {
      return NextResponse.json({ error: "无效的图片地址" }, { status: 400 });
    }

    const mode = getRuntimeBackendMode() || "local";
    const lanRole = getRuntimeLanRole();
    const downloadDirectory = getRuntimeDownloadDirectory();
    if (!downloadDirectory) {
      return NextResponse.json({ error: "请先设置默认下载位置" }, { status: 400 });
    }

    const filename = sanitizeFilename(typeof body.filename === "string" ? body.filename : "");
    const saved = await saveRemoteImageToDownloadDirectory(resolvedUrl.toString(), filename, downloadDirectory);

    return NextResponse.json({
      success: true,
      filePath: saved.filePath,
      fileName: saved.fileName,
      size: saved.size,
      directory: saved.directory,
      mode,
      lanRole,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存下载文件失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
