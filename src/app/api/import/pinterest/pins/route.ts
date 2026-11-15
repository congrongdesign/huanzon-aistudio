import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getPin, pickLargestPinImage } from "@/lib/pinterest";
import { getPinterestConnection } from "@/lib/pinterest-connection";
import {
  createReferenceImage,
  isLocalBackendEnabled,
  saveBinaryFile,
  upsertImageRecord,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ImportPin = {
  id: string;
  title?: string | null;
  imageUrl?: string | null;
  width?: number;
  height?: number;
};

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function ratioLabel(width: number, height: number): string {
  if (!width || !height) return "1:1";
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

function displaySize(width: number, height: number): { w: number; h: number } {
  const MAX_W = 640;
  if (!width || !height) return { w: 320, h: 320 };
  if (width <= MAX_W) return { w: Math.max(60, Math.round(width)), h: Math.max(60, Math.round(height)) };
  const scale = MAX_W / width;
  return { w: MAX_W, h: Math.max(60, Math.round(height * scale)) };
}

function extFromContentType(contentType?: string | null): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("avif")) return "avif";
  return "jpg";
}

function sanitizeName(input: string): string {
  return (input || "pinterest").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 60) || "pinterest";
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const connection = await getPinterestConnection(userId);
    if (!connection) {
      return NextResponse.json({ error: "未连接 Pinterest" }, { status: 401 });
    }

    const body = await request.json();
    const pins: ImportPin[] = Array.isArray(body?.pins) ? body.pins : [];
    const target: string = body?.target || "gallery";
    const projectId: string | null = body?.projectId || null;
    const baseX = Math.round(body?.canvasX ?? 40);
    const baseY = Math.round(body?.canvasY ?? 40);

    if (pins.length === 0) {
      return NextResponse.json({ error: "请至少选择一张图片" }, { status: 400 });
    }
    if (target !== "gallery" && target !== "canvas" && target !== "reference") {
      return NextResponse.json({ error: "未知导入目标" }, { status: 400 });
    }
    if ((target === "gallery" || target === "canvas") && !projectId) {
      return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const imported: Array<{
      id: string;
      title: string;
      sourceUrl: string | null;
      imageUrl: string;
      imageKey: string | null;
      width: number;
      height: number;
      target: string;
    }> = [];

    const s3 = new S3Storage(new S3Config());

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      let imageUrl = pin.imageUrl || "";
      let width = Math.round(pin.width || 0);
      let height = Math.round(pin.height || 0);

      // 前端没带图时，回源拉 pin 详情拿原图
      if (!imageUrl && connection.accessToken) {
        try {
          const detail = await getPin(connection.accessToken, pin.id);
          const img = pickLargestPinImage(detail);
          if (img) {
            imageUrl = img.url;
            width = img.width;
            height = img.height;
          }
        } catch {
          // ignore
        }
      }

      if (!imageUrl) {
        continue;
      }

      // 服务端代理下载
      const res = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        },
      });
      if (!res.ok) {
        continue;
      }
      const contentType = res.headers.get("content-type") || undefined;
      const buffer = Buffer.from(await res.arrayBuffer());

      const title = pin.title || "Pinterest 图片";
      const fileName = `${sanitizeName(title)}.${extFromContentType(contentType)}`;
      const key = `pinterest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extFromContentType(contentType)}`;
      let storedUrl = imageUrl;
      let storedKey: string | null = null;

      if (isLocalBackendEnabled()) {
        const saved = saveBinaryFile(buffer, fileName, contentType);
        storedUrl = saved.url;
        storedKey = saved.key;
      } else {
        const objectKey = await s3.uploadFile({ fileContent: buffer, fileName: key, contentType });
        storedUrl = await s3.generatePresignedUrl({ key: objectKey });
        storedKey = objectKey;
      }

      const { w, h } = displaySize(width, height);
      const now = new Date().toISOString();
      const recordId = randomUUID();

      if (target === "reference") {
        if (isLocalBackendEnabled()) {
          createReferenceImage(userId, {
            project_id: projectId,
            image_url: storedUrl,
            image_key: storedKey,
            file_name: fileName,
          });
        } else {
          const supabase = getSupabaseClient();
          const { error } = await supabase.from("reference_images").insert({
            project_id: projectId,
            image_url: storedUrl,
            image_key: storedKey,
            file_name: fileName,
          });
          if (error) throw error;
        }
      } else {
        const record = {
          id: recordId,
          project_id: projectId,
          user_id: userId,
          prompt: title,
          image_url: storedUrl,
          image_key: storedKey,
          size: ratioLabel(width, height),
          model: "pinterest",
          status: "completed",
          is_favorite: false,
          reference_images: JSON.stringify([{ source: "pinterest", source_url: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null }]),
          canvas_x: Math.round(baseX + i * 24),
          canvas_y: Math.round(baseY + i * 24),
          canvas_width: w,
          canvas_height: h,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          edited_image_key: null,
        };
        if (isLocalBackendEnabled()) {
          upsertImageRecord(record);
        } else {
          const supabase = getSupabaseClient();
          const { error } = await supabase.from("image_records").upsert(record);
          if (error) throw error;
        }
      }

      imported.push({
        id: recordId,
        title,
        sourceUrl: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
        imageUrl: storedUrl,
        imageKey: storedKey,
        width: w,
        height: h,
        target,
      });
    }

    return NextResponse.json({
      success: true,
      imported,
      total: pins.length,
      succeeded: imported.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "导入失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
