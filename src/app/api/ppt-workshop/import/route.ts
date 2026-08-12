import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { findLibreOffice, findPdfToPpm } from "@/lib/doc-tools";
import { saveBinaryFile } from "@/lib/local-backend";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";

const execFileAsync = promisify(execFile);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const PPTX_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

interface ImportedSlide {
  id: string;
  pageNumber: number;
  title: string;
  role: string;
  originalUrl: string;
  originalKey?: string;
  fileName: string;
  width?: number;
  height?: number;
  ocrText: string;
  sourceText: string;
  textHash: string;
  status: "ready" | "needs_image";
}

function cleanName(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function genId(prefix = "slide"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashText(text: string): string {
  let h = 0;
  const normalized = normalizeTextForCheck(text);
  for (let i = 0; i < normalized.length; i += 1) {
    h = Math.imul(31, h) + normalized.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

function normalizeTextForCheck(text: string): string {
  return text.replace(/\s+/g, "").replace(/[\u0000-\u001f]/g, "").trim();
}

function inferRole(pageNumber: number, total: number, title: string): string {
  if (pageNumber === 1) return "封面页";
  if (pageNumber === total) return "结尾页";
  if (/目录|contents|agenda/i.test(title)) return "目录页";
  if (/团队|成员|team/i.test(title)) return "团队页";
  if (/市场|竞品|商业|模式|合作/i.test(title)) return "商业页";
  if (/背景|痛点|问题|政策/i.test(title)) return "背景/痛点页";
  if (/方案|产品|服务|技术|研发/i.test(title)) return "方案/产品页";
  return "内容页";
}

async function imageMeta(buffer: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return {};
  }
}

function extFromMime(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("bmp")) return "bmp";
  if (type.includes("avif")) return "avif";
  return "jpg";
}

function contentTypeFromExt(ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase();
  if (clean === "png") return "image/png";
  if (clean === "webp") return "image/webp";
  if (clean === "gif") return "image/gif";
  if (clean === "bmp") return "image/bmp";
  if (clean === "avif") return "image/avif";
  return "image/jpeg";
}

async function makeSlideFromImage(buffer: Buffer, pageNumber: number, total: number, fileName: string, text = ""): Promise<ImportedSlide> {
  const ext = path.extname(fileName).toLowerCase() || `.${extFromMime("image/jpeg")}`;
  const safeName = cleanName(fileName || `slide_${pageNumber}${ext}`);
  const saved = saveBinaryFile(buffer, `ppt_slide_${String(pageNumber).padStart(3, "0")}_${safeName}`, contentTypeFromExt(ext));
  const meta = await imageMeta(buffer);
  const title = `第 ${pageNumber} 页`;
  return {
    id: genId(),
    pageNumber,
    title,
    role: inferRole(pageNumber, total, title),
    originalUrl: saved.url,
    originalKey: saved.key,
    fileName,
    width: meta.width,
    height: meta.height,
    ocrText: text,
    sourceText: text,
    textHash: hashText(text),
    status: "ready",
  };
}

async function importImages(files: File[]): Promise<{ slides: ImportedSlide[]; warnings: string[] }> {
  const sorted = [...files].sort((a, b) => naturalSort(a.name, b.name));
  const slides: ImportedSlide[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const file = sorted[i];
    const buffer = Buffer.from(await file.arrayBuffer());
    slides.push(await makeSlideFromImage(buffer, i + 1, sorted.length, file.name));
  }
  return { slides, warnings: [] };
}

async function importImageZip(file: File): Promise<{ slides: ImportedSlide[]; warnings: string[] }> {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => naturalSort(a.name, b.name));
  const slides: ImportedSlide[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const buffer = await entry.async("nodebuffer");
    slides.push(await makeSlideFromImage(buffer, i + 1, entries.length, path.basename(entry.name)));
  }
  const warnings = entries.length === 0 ? ["压缩包里没有找到图片文件，请确认包含 PNG/JPG/WebP 等页面图。"] : [];
  return { slides, warnings };
}

function readTextFromSlideXml(xml: string): string {
  const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
  return matches
    .map((m) => m[1])
    .map((s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join("\n")
    .trim();
}

function findConverter(): string | null {
  return findLibreOffice();
}

async function convertPptxToImages(fileBuffer: Buffer, fileName: string, pageCount: number): Promise<{ imageBuffers: Buffer[]; warnings: string[] }> {
  const converter = findConverter();
  if (!converter) {
    const quickLook = ["/usr/bin/qlmanage", "/bin/qlmanage"].find((p) => fs.existsSync(p));
    if (!quickLook) {
      return { imageBuffers: [], warnings: ["当前电脑未检测到 LibreOffice，无法直接把 PPTX 拆成页面图片。请安装 LibreOffice 后重试，或先从 PowerPoint 导出图片包上传。"] };
    }
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-workshop-ql-"));
    try {
      const inputPath = path.join(tmpRoot, cleanName(fileName || "input.pptx"));
      fs.writeFileSync(inputPath, fileBuffer);
      await execFileAsync(quickLook, ["-t", "-s", "1920", "-o", tmpRoot, inputPath], { timeout: 60000 });
      const thumb = fs.readdirSync(tmpRoot).find((name) => name.toLowerCase().endsWith(".png"));
      if (thumb) {
        return {
          imageBuffers: [fs.readFileSync(path.join(tmpRoot, thumb))],
          warnings: [
            "当前未安装 LibreOffice/Poppler，已用系统预览生成封面缩略图，仅可用于风格确认。若要完整自动美化全部页面，请安装 LibreOffice 与 Poppler。",
          ],
        };
      }
      return { imageBuffers: [], warnings: ["当前电脑未检测到 LibreOffice，无法直接把 PPTX 拆成页面图片。请安装 LibreOffice 后重试，或先从 PowerPoint 导出图片包上传。"] };
    } catch {
      return { imageBuffers: [], warnings: ["当前电脑未检测到 LibreOffice，无法直接把 PPTX 拆成页面图片。请安装 LibreOffice 后重试，或先从 PowerPoint 导出图片包上传。"] };
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-workshop-"));
  try {
    const inputPath = path.join(tmpRoot, cleanName(fileName || "input.pptx"));
    const pdfDir = path.join(tmpRoot, "pdf");
    const imgDir = path.join(tmpRoot, "images");
    fs.mkdirSync(pdfDir, { recursive: true });
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(inputPath, fileBuffer);

    await execFileAsync(converter, ["--headless", "--convert-to", "pdf", "--outdir", pdfDir, inputPath], { timeout: 120000 });
    const pdf = fs.readdirSync(pdfDir).find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!pdf) return { imageBuffers: [], warnings: ["PPTX 转 PDF 失败，请检查文件是否损坏。"] };

    const pdftoppm = findPdfToPpm();
    if (pdftoppm) {
      await execFileAsync(pdftoppm, ["-png", "-r", "180", path.join(pdfDir, pdf), path.join(imgDir, "slide")], { timeout: 180000 });
      const names = fs.readdirSync(imgDir).filter((name) => name.endsWith(".png")).sort(naturalSort);
      return { imageBuffers: names.map((name) => fs.readFileSync(path.join(imgDir, name))), warnings: [] };
    }

    return {
      imageBuffers: [],
      warnings: [
        `PPTX 已转 PDF，但当前电脑未检测到 pdftoppm，暂时无法继续拆成 ${pageCount} 张图片。请安装 Poppler，或先从 PowerPoint 导出图片包上传。`,
      ],
    };
  } catch (err) {
    return { imageBuffers: [], warnings: [err instanceof Error ? `PPTX 拆页失败：${err.message}` : "PPTX 拆页失败"] };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function importPptx(file: File): Promise<{ slides: ImportedSlide[]; warnings: string[]; sourceTexts: string[] }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.values(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => {
      const an = Number(a.name.match(/slide(\d+)\.xml/)?.[1] || 0);
      const bn = Number(b.name.match(/slide(\d+)\.xml/)?.[1] || 0);
      return an - bn;
    });

  const sourceTexts: string[] = [];
  for (const entry of slideEntries) {
    const xml = await entry.async("text");
    sourceTexts.push(readTextFromSlideXml(xml));
  }

  const converted = await convertPptxToImages(buffer, file.name, slideEntries.length);
  const slides: ImportedSlide[] = [];
  const totalSlides = Math.max(sourceTexts.length, converted.imageBuffers.length, 1);
  for (let i = 0; i < totalSlides; i += 1) {
    if (i < converted.imageBuffers.length) {
      slides.push(await makeSlideFromImage(converted.imageBuffers[i], i + 1, totalSlides, `slide-${String(i + 1).padStart(3, "0")}.png`, sourceTexts[i] || ""));
    } else {
      const title = `第 ${i + 1} 页`;
      slides.push({
        id: genId(),
        pageNumber: i + 1,
        title,
        role: inferRole(i + 1, sourceTexts.length, title),
        originalUrl: "",
        fileName: file.name,
        ocrText: sourceTexts[i] || "",
        sourceText: sourceTexts[i] || "",
        textHash: hashText(sourceTexts[i] || ""),
        status: "needs_image",
      });
    }
  }

  return { slides, warnings: converted.warnings, sourceTexts };
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter((v): v is File => v instanceof File && Boolean(v.name));
    const singleFile = formData.get("file") as File | null;
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : [];

    if (allFiles.length === 0) {
      const normalized = normalizeOperationError({ message: "请上传 PPTX、图片包或页面图片", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    if (allFiles.length > 100) {
      const normalized = normalizeOperationError({ message: "单套 PPT 最多支持 100 页", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const first = allFiles[0];
    const firstExt = path.extname(first.name).toLowerCase();
    let result: { slides: ImportedSlide[]; warnings: string[]; sourceTexts?: string[] };

    if (allFiles.length > 1) {
      const imageFiles = allFiles.filter((file) => IMAGE_EXTS.has(path.extname(file.name).toLowerCase()) || file.type.startsWith("image/"));
      if (imageFiles.length !== allFiles.length) {
        const normalized = normalizeOperationError({ message: "多文件上传时请只选择页面图片", status: 400 });
        return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
      }
      result = await importImages(imageFiles);
    } else if (firstExt === ".zip") {
      result = await importImageZip(first);
    } else if (firstExt === ".ppt") {
      const normalized = normalizeOperationError({
        message: "暂不支持旧版 .ppt 文件，请先在 PowerPoint 另存为 .pptx，或导出为图片包再上传。",
        status: 400,
      });
      return NextResponse.json(
        toOperationErrorPayload(normalized),
        { status: normalized.status },
      );
    } else if (firstExt === ".pptx" || PPTX_CONTENT_TYPES.has(first.type)) {
      result = await importPptx(first);
    } else if (IMAGE_EXTS.has(firstExt) || first.type.startsWith("image/")) {
      result = await importImages([first]);
    } else {
      const normalized = normalizeOperationError({ message: "暂只支持 PPTX、ZIP 图片包、PNG/JPG/WebP 等图片", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    if (result.slides.length > 100) {
      result.slides = result.slides.slice(0, 100);
      result.warnings.push("已超过 100 页，只导入前 100 页。");
    }

    return NextResponse.json({
      slides: result.slides,
      total: result.slides.length,
      warnings: result.warnings,
      canGenerate: result.slides.some((slide) => Boolean(slide.originalUrl)),
    });
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "导入失败",
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
