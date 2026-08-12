import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { imagesToOriginalRatioPdf, isSupportedConversionImage } from "@/lib/conversion/image-to-pdf";
import type { ConversionSourceFile, ConversionSourceType } from "@/lib/conversion/types";

type PreparedImageInput = {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
  sourceUrl?: string | null;
  width?: number | null;
  height?: number | null;
};

type ImageUrlMeta = {
  url: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
};

type PreparedOrderedImage = {
  key: string;
  sourceFile: ConversionSourceFile;
  imageInput: {
    name: string;
    type: string;
    buffer: Buffer;
  };
};

export type PreparedConversionRequest = {
  projectId: string | null;
  taskName: string;
  sourceType: ConversionSourceType;
  sourceFiles: ConversionSourceFile[];
  pdfBuffer: Buffer;
  pageCount: number;
};

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function sourceFile(file: File): ConversionSourceFile {
  return {
    name: file.name || "未命名文件",
    size: file.size,
    type: file.type || "application/octet-stream",
    origin: "upload",
  };
}

function uploadFileOrderKey(file: File) {
  return `upload:${file.name}:${file.size}`;
}

function canvasUrlOrderKey(url: string) {
  return `canvas:${url}`;
}

export function safeTaskName(name: string) {
  return (name || "图片转可编辑PPT").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 80) || "图片转可编辑PPT";
}

function imageExtFromContentType(contentType: string) {
  if (/jpe?g/i.test(contentType)) return ".jpg";
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  if (/avif/i.test(contentType)) return ".avif";
  return ".png";
}

function safeImageName(name: string, fallback: string, contentType: string) {
  const base = safeTaskName(name).replace(/\.[a-z0-9]+$/i, "").slice(0, 64);
  if (!base) return fallback;
  return `${base}${imageExtFromContentType(contentType)}`;
}

function imageNameFromUrl(url: URL, index: number, contentType: string) {
  const pathnameName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  const hasExt = /\.[a-z0-9]+$/i.test(pathnameName);
  return hasExt ? pathnameName : `canvas-image-${String(index + 1).padStart(3, "0")}${imageExtFromContentType(contentType)}`;
}

function resolveImageUrl(request: NextRequest, value: string) {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, request.nextUrl.origin);
    const isRelative = raw.startsWith("/");
    const host = url.hostname.toLowerCase();
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);
    if (isRelative || (url.protocol === "http:" && isLocalHost)) {
      return new URL(`${url.pathname}${url.search}`, request.nextUrl.origin);
    }
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function parseImageUrls(form: FormData) {
  const values = [...form.getAll("imageUrls"), ...form.getAll("imageUrl")];
  const urls: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (typeof item === "string" && item.trim()) urls.push(item.trim());
          });
          continue;
        }
      } catch {
        // Fall through to newline parsing.
      }
    }
    trimmed.split(/\n+/).map((item) => item.trim()).filter(Boolean).forEach((item) => urls.push(item));
  }
  return Array.from(new Set(urls)).slice(0, 200);
}

function parseImageUrlMeta(form: FormData) {
  const rawValues = [...form.getAll("imageMeta"), ...form.getAll("imageMetas")];
  const map = new Map<string, ImageUrlMeta>();

  for (const value of rawValues) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const parsed = JSON.parse(value) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const url = typeof obj.url === "string" ? obj.url.trim() : "";
        if (!url) continue;
        map.set(url, {
          url,
          name: typeof obj.name === "string" ? obj.name : null,
          width: typeof obj.width === "number" && Number.isFinite(obj.width) ? obj.width : null,
          height: typeof obj.height === "number" && Number.isFinite(obj.height) ? obj.height : null,
        });
      }
    } catch {
      // Ignore malformed optional metadata.
    }
  }

  return map;
}

function parsePageOrder(form: FormData) {
  const values = form.getAll("pageOrder");
  const keys: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const raw = value.trim();
    if (!raw) continue;
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (typeof item === "string" && item.trim()) keys.push(item.trim());
          });
          continue;
        }
      } catch {
        // Fall through to line-based parsing.
      }
    }
    raw.split(/\n+/).map((item) => item.trim()).filter(Boolean).forEach((item) => keys.push(item));
  }

  return Array.from(new Set(keys)).slice(0, 400);
}

async function fetchImageInput(request: NextRequest, imageUrl: string, index: number, meta?: ImageUrlMeta): Promise<PreparedImageInput> {
  const resolved = resolveImageUrl(request, imageUrl);
  if (!resolved) {
    throw new Error("包含无效的画布图片地址");
  }

  const response = await fetch(resolved, { cache: "no-store", signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    throw new Error(`读取画布图片失败 (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  const fallbackName = imageNameFromUrl(resolved, index, contentType);
  const name = safeImageName(meta?.name || "", fallbackName, contentType);
  if (!isSupportedConversionImage(name, contentType)) {
    throw new Error(`${name} 格式暂不支持`);
  }

  let width: number | null = null;
  let height: number | null = null;
  try {
    const metadata = await sharp(buffer).metadata();
    width = metadata.width || null;
    height = metadata.height || null;
  } catch {
    // The conversion step will perform the final validation.
  }

  return {
    name,
    type: contentType,
    size: buffer.byteLength,
    buffer,
    sourceUrl: imageUrl,
    width: width ?? meta?.width ?? null,
    height: height ?? meta?.height ?? null,
  };
}

async function getPdfPageCount(buffer: Buffer) {
  try {
    const pdf = await PDFDocument.load(buffer);
    return pdf.getPageCount();
  } catch {
    return 0;
  }
}

export function pageNumbers(pageCount: number) {
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => index);
}

export async function prepareConversionRequest(request: NextRequest): Promise<PreparedConversionRequest> {
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  const singleFile = form.get("file");
  if (files.length === 0 && singleFile instanceof File && singleFile.size > 0) files.push(singleFile);
  const imageUrls = parseImageUrls(form);
  const imageUrlMeta = parseImageUrlMeta(form);
  const pageOrder = parsePageOrder(form);

  if (files.length === 0 && imageUrls.length === 0) {
    throw new Error("请上传图片或 PDF");
  }

  const projectIdValue = form.get("projectId");
  const projectId = typeof projectIdValue === "string" && projectIdValue.trim() ? projectIdValue.trim() : null;
  const nameValue = form.get("name");
  const taskName = safeTaskName(typeof nameValue === "string" ? nameValue : files[0]?.name || "转换任务");
  const pdfFiles = files.filter(isPdfFile);
  const imageFiles = files.filter((file) => isSupportedConversionImage(file.name, file.type));
  const urlImageInputs = imageUrls.length > 0
    ? await Promise.all(imageUrls.map((url, index) => fetchImageInput(request, url, index, imageUrlMeta.get(url))))
    : [];

  if (pdfFiles.length > 0 && (imageFiles.length > 0 || urlImageInputs.length > 0)) {
    throw new Error("图片和 PDF 请分开转换");
  }
  if (pdfFiles.length > 1) {
    throw new Error("一次只能转换一个 PDF");
  }
  if (pdfFiles.length === 0 && imageFiles.length !== files.length) {
    throw new Error("包含暂不支持的文件格式");
  }

  const isPdf = pdfFiles.length === 1;
  let sourceFiles: ConversionSourceFile[];

  let pdfBuffer: Buffer;
  let pageCount = 0;
  if (isPdf) {
    sourceFiles = files.map(sourceFile);
    pdfBuffer = Buffer.from(await pdfFiles[0].arrayBuffer());
    pageCount = await getPdfPageCount(pdfBuffer);
  } else {
    const orderedEntries: PreparedOrderedImage[] = [
      ...await Promise.all(imageFiles.map(async (file) => ({
        key: uploadFileOrderKey(file),
        sourceFile: sourceFile(file),
        imageInput: {
          name: file.name,
          type: file.type,
          buffer: Buffer.from(await file.arrayBuffer()),
        },
      }))),
      ...urlImageInputs.map((file) => ({
        key: canvasUrlOrderKey(file.sourceUrl || ""),
        sourceFile: {
          name: file.name,
          size: file.size,
          type: file.type,
          origin: "canvas" as const,
          source_url: file.sourceUrl || null,
          thumbnail_url: file.sourceUrl || null,
          width: file.width ?? null,
          height: file.height ?? null,
        },
        imageInput: {
          name: file.name,
          type: file.type,
          buffer: file.buffer,
        },
      })),
    ];

    const orderIndex = new Map(pageOrder.map((key, index) => [key, index]));
    const sortedEntries = pageOrder.length > 0
      ? orderedEntries
          .map((entry, index) => ({ entry, index }))
          .sort((a, b) => {
            const aOrder = orderIndex.get(a.entry.key);
            const bOrder = orderIndex.get(b.entry.key);
            const aRank = aOrder ?? Number.MAX_SAFE_INTEGER;
            const bRank = bOrder ?? Number.MAX_SAFE_INTEGER;
            return aRank === bRank ? a.index - b.index : aRank - bRank;
          })
          .map(({ entry }) => entry)
      : orderedEntries;

    sourceFiles = sortedEntries.map((entry) => entry.sourceFile);
    const imageInputs = sortedEntries.map((entry) => entry.imageInput);
    const pdf = await imagesToOriginalRatioPdf(imageInputs);
    pdfBuffer = pdf.buffer;
    pageCount = pdf.pageCount;
  }

  return {
    projectId,
    taskName,
    sourceType: isPdf ? "pdf" : "images",
    sourceFiles,
    pdfBuffer,
    pageCount,
  };
}
