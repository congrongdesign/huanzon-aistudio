import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { PDFDocument } from "pdf-lib";
import type { BatchManifest } from "@/lib/batch-module/types";
import { resolveLocalFilePath } from "@/lib/local-backend";

function safeName(name: string): string {
  return (name || "AI-PPT-Batch")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function absoluteRatio(aspectRatio: string): { width: number; height: number } {
  const [wRaw, hRaw] = String(aspectRatio || "16:9").split(":").map((item) => Number(item));
  const width = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 16;
  const height = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 9;
  return { width, height };
}

function getRenderablePages(manifest: BatchManifest) {
  return manifest.pages
    .filter((page) => manifest.batch.options.selectedPages.includes(page.pageNumber))
    .map((page) => ({
      pageNumber: page.pageNumber,
      title: page.title,
      url: page.coloredImageUrl || page.draftImageUrl || page.originalUrl,
    }))
    .filter((page) => Boolean(page.url))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

async function bufferFromUrl(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (url.startsWith("/api/local-file/")) {
    const key = decodeURIComponent(url.split("/").pop() || "").split("?")[0];
    const filePath = resolveLocalFilePath(key);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return { buffer: fs.readFileSync(filePath), contentType };
  }
  if (url.startsWith("data:")) {
    const matched = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!matched) throw new Error("不支持的 data URL");
    return { buffer: Buffer.from(matched[2], "base64"), contentType: matched[1] };
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取图片失败：${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/png",
  };
}

export async function buildZipBuffer(manifest: BatchManifest): Promise<Buffer> {
  const zip = new JSZip();
  const pages = getRenderablePages(manifest);
  if (pages.length === 0) throw new Error("当前没有可导出的页面");
  for (const page of pages) {
    const { buffer, contentType } = await bufferFromUrl(page.url);
    const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    zip.file(`${String(page.pageNumber).padStart(3, "0")}_${safeName(page.title)}.${ext}`, buffer);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function buildPptxBuffer(manifest: BatchManifest): Promise<Buffer> {
  const pages = getRenderablePages(manifest);
  if (pages.length === 0) throw new Error("当前没有可导出的页面");
  const pptx = new PptxGenJS();
  const ratio = absoluteRatio(manifest.batch.options.aspectRatio);
  const width = 13.333;
  const height = width * (ratio.height / ratio.width);
  pptx.defineLayout({ name: "BATCH_LAYOUT", width, height });
  pptx.layout = "BATCH_LAYOUT";
  pptx.author = "环中AIStudio";
  pptx.subject = `${manifest.batch.sourceFileName} 批量导出`;
  pptx.title = manifest.batch.sourceFileName;

  for (const page of pages) {
    const asset = await bufferFromUrl(page.url);
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addImage({
      data: `data:${asset.contentType};base64,${asset.buffer.toString("base64")}`,
      x: 0,
      y: 0,
      w: width,
      h: height,
    });
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

export async function buildPdfBuffer(manifest: BatchManifest): Promise<Buffer> {
  const pages = getRenderablePages(manifest);
  if (pages.length === 0) throw new Error("当前没有可导出的页面");
  const ratio = absoluteRatio(manifest.batch.options.aspectRatio);
  const width = 1333.3;
  const height = width * (ratio.height / ratio.width);
  const pdf = await PDFDocument.create();

  for (const page of pages) {
    const asset = await bufferFromUrl(page.url);
    const embedded = asset.contentType.includes("jpeg") ? await pdf.embedJpg(asset.buffer) : await pdf.embedPng(asset.buffer);
    const pdfPage = pdf.addPage([width, height]);
    pdfPage.drawImage(embedded, { x: 0, y: 0, width, height });
  }

  return Buffer.from(await pdf.save());
}
