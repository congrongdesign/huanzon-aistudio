import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export type ImageToPdfInput = {
  name: string;
  type: string;
  buffer: Buffer;
};

export type ImageToPdfResult = {
  buffer: Buffer;
  pageCount: number;
  warnings: string[];
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const SUPPORTED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);

export function isSupportedConversionImage(fileName: string, mimeType = "") {
  const lowerName = fileName.toLowerCase();
  const dotIndex = lowerName.lastIndexOf(".");
  const ext = dotIndex >= 0 ? lowerName.slice(dotIndex) : "";
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext) || SUPPORTED_IMAGE_MIME.has(mimeType.toLowerCase());
}

function isJpeg(file: ImageToPdfInput) {
  return /image\/jpe?g/i.test(file.type) || /\.(jpe?g)$/i.test(file.name);
}

function isPng(file: ImageToPdfInput) {
  return /image\/png/i.test(file.type) || /\.png$/i.test(file.name);
}

function safePageSize(width: number, height: number) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1920;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1080;
  return { width: safeWidth, height: safeHeight };
}

export async function imagesToOriginalRatioPdf(files: ImageToPdfInput[]): Promise<ImageToPdfResult> {
  if (files.length === 0) {
    throw new Error("请至少上传一张图片");
  }

  const pdf = await PDFDocument.create();
  const warnings: string[] = [];

  for (const file of files) {
    if (!isSupportedConversionImage(file.name, file.type)) {
      warnings.push(`${file.name} 格式暂不支持，已跳过`);
      continue;
    }

    let imageBuffer = file.buffer;
    let width = 0;
    let height = 0;
    let kind: "jpg" | "png" = "png";

    if (isJpeg(file)) {
      const meta = await sharp(imageBuffer).metadata();
      width = meta.width || 0;
      height = meta.height || 0;
      kind = "jpg";
    } else if (isPng(file)) {
      const meta = await sharp(imageBuffer).metadata();
      width = meta.width || 0;
      height = meta.height || 0;
      kind = "png";
    } else {
      const converted = await sharp(imageBuffer).png().toBuffer({ resolveWithObject: true });
      imageBuffer = converted.data;
      width = converted.info.width;
      height = converted.info.height;
      kind = "png";
    }

    const pageSize = safePageSize(width, height);
    const embedded = kind === "jpg"
      ? await pdf.embedJpg(imageBuffer)
      : await pdf.embedPng(imageBuffer);
    const page = pdf.addPage([pageSize.width, pageSize.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pageSize.width,
      height: pageSize.height,
    });
  }

  if (pdf.getPageCount() === 0) {
    throw new Error("没有可转换的图片文件");
  }

  return {
    buffer: Buffer.from(await pdf.save({ useObjectStreams: false })),
    pageCount: pdf.getPageCount(),
    warnings,
  };
}
