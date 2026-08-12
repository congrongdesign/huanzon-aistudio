import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import { getCurrentUserId } from "@/lib/auth";
import {
  createImageRecord,
  isLocalBackendEnabled,
  saveBinaryFile,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import {
  clampFilterSettings,
  describeFilterSettings,
  type ImageFilterSettings,
} from "@/lib/image-edit/filters";

type Body = {
  imageUrl?: string;
  imageKey?: string | null;
  projectId?: string | null;
  prompt?: string;
  settings?: Partial<ImageFilterSettings>;
  canvas_x?: number;
  canvas_y?: number;
  canvas_width?: number;
  canvas_height?: number;
  sourceImageId?: string;
};

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const absoluteUrl = imageUrl.startsWith("/")
    ? `http://127.0.0.1:${process.env.PORT || "3000"}${imageUrl}`
    : imageUrl;
  const response = await fetch(absoluteUrl, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    throw new Error(`读取图片失败: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function buildModulate(settings: ImageFilterSettings) {
  const modulate: { brightness?: number; saturation?: number; hue?: number } = {};
  if (settings.brightness !== 100) modulate.brightness = settings.brightness / 100;
  if (settings.saturation !== 100 || settings.grayscale > 0) {
    modulate.saturation = (settings.saturation / 100) * (1 - settings.grayscale / 100);
  }
  if (settings.hue !== 0) modulate.hue = settings.hue;
  return Object.keys(modulate).length > 0 ? modulate : null;
}

async function applyFilters(buffer: Buffer, settings: ImageFilterSettings): Promise<Buffer> {
  let pipeline = sharp(buffer, { failOn: "none" }).rotate().ensureAlpha();

  const modulate = buildModulate(settings);
  if (modulate) pipeline = pipeline.modulate(modulate);

  if (settings.temperature !== 0) {
    const warm = settings.temperature / 100;
    pipeline = pipeline.recomb([
      [1 + warm * 0.18, 0, warm * 0.04],
      [0, 1 + warm * 0.04, 0],
      [-warm * 0.08, 0, 1 - warm * 0.16],
    ]);
  }

  if (settings.sepia > 0) {
    const amount = settings.sepia / 100;
    pipeline = pipeline.recomb([
      [1 - 0.607 * amount, 0.769 * amount, 0.189 * amount],
      [0.349 * amount, 1 - 0.314 * amount, 0.168 * amount],
      [0.272 * amount, 0.534 * amount, 1 - 0.869 * amount],
    ]);
  }

  if (settings.contrast !== 100) {
    const contrast = settings.contrast / 100;
    const slope = contrast;
    const intercept = 128 * (1 - slope);
    pipeline = pipeline.linear(slope, intercept);
  }

  if (settings.blur > 0) {
    pipeline = pipeline.blur(Math.max(0.3, settings.blur));
  }

  if (settings.sharpen > 0) {
    pipeline = pipeline.sharpen({ sigma: 0.6 + settings.sharpen / 80, m1: 0.8, m2: 2.2, x1: 2, y2: 10 });
  }

  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function saveFilteredRecord(body: Body, userId: string, settings: ImageFilterSettings, output: Buffer) {
  const prompt = body.prompt || `[滤镜调色] ${describeFilterSettings(settings)}`;
  const width = Math.round(toNumber(body.canvas_width, 320));
  const height = Math.round(toNumber(body.canvas_height, 320));
  const canvasX = Math.round(toNumber(body.canvas_x, 40));
  const canvasY = Math.round(toNumber(body.canvas_y, 40));

  if (isLocalBackendEnabled()) {
    const saved = saveBinaryFile(output, `filter_${Date.now()}.png`, "image/png");
    return createImageRecord({
      project_id: body.projectId || null,
      user_id: userId,
      prompt,
      image_url: saved.url,
      image_key: saved.key,
      reference_images: JSON.stringify([body.imageUrl]),
      canvas_x: canvasX,
      canvas_y: canvasY,
      canvas_width: width,
      canvas_height: height,
      size: "custom",
      model: "local-filter",
      status: "completed",
    });
  }

  const s3 = new S3Storage(new S3Config());
  const objectKey = await s3.uploadFile({ fileContent: output, fileName: `filter_${Date.now()}.png`, contentType: "image/png" });
  const presignedUrl = await s3.generatePresignedUrl({ key: objectKey });
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("image_records")
    .insert({
      project_id: body.projectId || null,
      user_id: userId,
      prompt,
      image_url: presignedUrl,
      image_key: objectKey,
      reference_images: JSON.stringify([body.imageUrl]),
      canvas_x: canvasX,
      canvas_y: canvasY,
      canvas_width: width,
      canvas_height: height,
      size: "custom",
      model: "local-filter",
      status: "completed",
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "保存滤镜结果失败");
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = (await request.json()) as Body;
    if (!body.imageUrl) {
      return NextResponse.json({ error: "缺少图片地址" }, { status: 400 });
    }

    const settings = clampFilterSettings(body.settings);
    const source = await fetchImageBuffer(body.imageUrl);
    const output = await applyFilters(source, settings);
    const record = await saveFilteredRecord(body, userId, settings, output);

    return NextResponse.json({ success: true, record, settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "滤镜处理失败";
    console.error("Image filter error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
