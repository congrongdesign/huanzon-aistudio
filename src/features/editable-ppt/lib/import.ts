import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import sharp from "sharp";
import { findLibreOffice, findPdfToPpm as findInstalledPdfToPpm } from "@/lib/doc-tools";
import { resolveLocalFilePath, saveBinaryFile } from "@/lib/local-backend";
import { buildPageAst } from "./ast";
import {
  DEFAULT_EDITABLE_PPT_CONFIG,
  type EditablePptConfig,
  type EditablePptElementRecord,
  type EditablePptExportMode,
  type EditablePptJobRecord,
  type EditablePptNodeRole,
  type EditablePptOcrLine,
  type EditablePptPageMode,
  type EditablePptPageRecord,
  type EditablePptPageStatus,
  type EditablePptSourceType,
  type EditablePptStructureMetrics,
  type EditablePptStructureNode,
  type EditablePptStructureRoot,
} from "./types";

const execFileAsync = promisify(execFile);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const PPTX_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

export type ImportedEditablePptPayload = {
  sourceType: EditablePptSourceType;
  sourceName: string;
  sourceKey: string | null;
  sourceUrl: string | null;
  pageCount: number;
  warnings: string[];
  aspectRatioGuess: string | null;
  pages: EditablePptPageRecord[];
  elements: EditablePptElementRecord[];
};

type ImportedElementSeed = {
  id?: string;
  elementType: EditablePptElementRecord["element_type"];
  bboxX: number;
  bboxY: number;
  bboxW: number;
  bboxH: number;
  zIndex: number;
  rotation: number;
  opacity: number;
  confidence: number;
  textContent: string | null;
  style: Record<string, unknown>;
  assetKey: string | null;
  assetUrl: string | null;
  hidden?: boolean;
  locked?: boolean;
  sourceRef: string | null;
  parentId?: string | null;
  groupId?: string | null;
  nodeRole?: EditablePptNodeRole;
  exportMode?: EditablePptExportMode;
  originStage?: "native" | "ocr" | "region" | "fallback";
};

type ImportedPageAnalysis = {
  pageMode: EditablePptPageMode;
  parseStatus: EditablePptPageStatus;
  parseConfidence: number;
  editableScore: number;
  textRecoveryScore: number;
  layoutRecoveryScore: number;
  unknownNodeRatio: number;
  metrics: EditablePptStructureMetrics;
  warnings: string[];
  structure: Omit<EditablePptStructureRoot, "pageId" | "pageNumber">;
  seeds: ImportedElementSeed[];
};

type ImportedImagePage = {
  pageNumber: number;
  title: string;
  role: string;
  width: number;
  height: number;
  sourceImageKey: string;
  sourceImageUrl: string;
  fileName: string;
  sourceText: string;
  ocrText: string;
  ocrLines: EditablePptOcrLine[];
  previewImageKey: string | null;
  previewImageUrl: string | null;
  cleanedBackgroundKey: string | null;
  cleanedBackgroundUrl: string | null;
  analysis: ImportedPageAnalysis;
};

type ParagraphGroup = {
  id: string;
  lines: EditablePptOcrLine[];
  bbox: [number, number, number, number];
  text: string;
  avgConfidence: number;
  avgLineHeight: number;
  align: "left" | "center" | "right";
  role: EditablePptNodeRole;
};

type VisualRegion = {
  bbox: [number, number, number, number];
  area: number;
  mean: [number, number, number];
  dominant: [number, number, number];
  entropy: number;
  sharpness: number;
  avgDelta: number;
  saturation: number;
  cellCount: number;
  kind?: "video" | "document" | "person" | "graphic" | "complex";
};

type ParsedPptxSlideSeed = {
  textSeeds: ImportedElementSeed[];
  imageSeeds: ImportedElementSeed[];
  shapeSeeds: ImportedElementSeed[];
};

function nowIso() {
  return new Date().toISOString();
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function cleanName(name: string) {
  return name.replace(/[/\\]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function normalizeTextForCheck(text: string) {
  return text.replace(/\s+/g, "").replace(/[\u0000-\u001f]/g, "").trim();
}

function inferRole(pageNumber: number, total: number, title: string) {
  if (pageNumber === 1) return "封面页";
  if (pageNumber === total) return "结尾页";
  if (/目录|contents|agenda/i.test(title)) return "目录页";
  if (/团队|成员|team/i.test(title)) return "团队页";
  if (/市场|竞品|商业|模式|合作/i.test(title)) return "商业页";
  if (/背景|痛点|问题|政策/i.test(title)) return "背景/痛点页";
  if (/方案|产品|服务|技术|研发/i.test(title)) return "方案/产品页";
  return "内容页";
}

function aspectRatioGuess(width: number, height: number) {
  if (!width || !height) return null;
  const ratio = width / height;
  const candidates = [
    { name: "16:9", value: 16 / 9 },
    { name: "4:3", value: 4 / 3 },
    { name: "3:4", value: 3 / 4 },
    { name: "9:16", value: 9 / 16 },
    { name: "1:1", value: 1 },
  ];
  const best = candidates.reduce((prev, current) =>
    Math.abs(current.value - ratio) < Math.abs(prev.value - ratio) ? current : prev
  );
  return best.name;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function uniqueWarnings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function unionBbox(boxes: Array<[number, number, number, number]>): [number, number, number, number] {
  if (boxes.length === 0) return [0, 0, 0, 0];
  const left = Math.min(...boxes.map((box) => box[0]));
  const top = Math.min(...boxes.map((box) => box[1]));
  const right = Math.max(...boxes.map((box) => box[0] + box[2]));
  const bottom = Math.max(...boxes.map((box) => box[1] + box[3]));
  return [left, top, Math.max(0, right - left), Math.max(0, bottom - top)];
}

function bboxArea(box: [number, number, number, number]) {
  return Math.max(0, box[2]) * Math.max(0, box[3]);
}

function overlapArea(a: [number, number, number, number], b: [number, number, number, number]) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function overlapRatioToSmaller(
  a: [number, number, number, number],
  b: [number, number, number, number],
) {
  const smallerArea = Math.max(1, Math.min(bboxArea(a), bboxArea(b)));
  return overlapArea(a, b) / smallerArea;
}

function boxContains(outer: [number, number, number, number], inner: [number, number, number, number]) {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  );
}

function inferTextAlign(box: [number, number, number, number], pageWidth: number): "left" | "center" | "right" {
  const centerX = box[0] + box[2] / 2;
  const leftMargin = box[0];
  const rightMargin = pageWidth - (box[0] + box[2]);
  if (Math.abs(centerX - pageWidth / 2) < pageWidth * 0.08 && Math.abs(leftMargin - rightMargin) < pageWidth * 0.08) {
    return "center";
  }
  if (rightMargin < pageWidth * 0.08 && leftMargin > pageWidth * 0.22) {
    return "right";
  }
  return "left";
}

function inferTextRole(
  bbox: [number, number, number, number],
  avgLineHeight: number,
  text: string,
  pageWidth: number,
  pageHeight: number,
  maxLineHeight: number,
): EditablePptNodeRole {
  const topRatio = bbox[1] / Math.max(1, pageHeight);
  const widthRatio = bbox[2] / Math.max(1, pageWidth);
  const lineCount = text.split("\n").filter(Boolean).length;
  if (topRatio < 0.22 && avgLineHeight >= maxLineHeight * 0.92) return "title";
  if (topRatio < 0.28 && lineCount <= 2 && widthRatio > 0.28 && avgLineHeight >= maxLineHeight * 0.78) return "subtitle";
  if (bbox[1] + bbox[3] > pageHeight * 0.84 && avgLineHeight <= 24) return "caption";
  return "body";
}

async function imageMeta(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  return {
    width: meta.width || 0,
    height: meta.height || 0,
  };
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

function findPdfToPpm(): string | null {
  return findInstalledPdfToPpm();
}

async function convertPdfToImages(buffer: Buffer, fileName: string): Promise<{ imageBuffers: Buffer[]; warnings: string[] }> {
  const pdftoppm = findPdfToPpm();
  if (!pdftoppm) {
    return {
      imageBuffers: [],
      warnings: ["当前电脑未检测到 Poppler，无法把 PDF 拆成页面图片。请先安装 Poppler。"],
    };
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editable-pdf-"));
  try {
    const inputPath = path.join(tmpRoot, cleanName(fileName || "input.pdf"));
    const outBase = path.join(tmpRoot, "page");
    fs.writeFileSync(inputPath, buffer);
    await execFileAsync(pdftoppm, ["-png", "-r", "180", inputPath, outBase], { timeout: 180000 });
    const names = fs.readdirSync(tmpRoot).filter((name) => /^page-\d+\.png$/.test(name)).sort(naturalSort);
    return {
      imageBuffers: names.map((name) => fs.readFileSync(path.join(tmpRoot, name))),
      warnings: names.length === 0 ? ["PDF 已读取，但没有成功生成页面图片。"] : [],
    };
  } catch (error) {
    return {
      imageBuffers: [],
      warnings: [error instanceof Error ? `PDF 拆页失败：${error.message}` : "PDF 拆页失败"],
    };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function convertPptxToImages(fileBuffer: Buffer, fileName: string, pageCount: number): Promise<{ imageBuffers: Buffer[]; warnings: string[] }> {
  const converter = findConverter();
  if (!converter) {
    return { imageBuffers: [], warnings: ["当前电脑未检测到 LibreOffice，无法直接把 PPTX 拆成页面图片。请安装 LibreOffice 后重试。"] };
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editable-pptx-"));
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
    if (!pdftoppm) {
      return {
        imageBuffers: [],
        warnings: [`PPTX 已转 PDF，但当前电脑未检测到 pdftoppm，暂时无法继续拆成 ${pageCount} 张图片。请安装 Poppler。`],
      };
    }

    await execFileAsync(pdftoppm, ["-png", "-r", "180", path.join(pdfDir, pdf), path.join(imgDir, "slide")], { timeout: 180000 });
    const names = fs.readdirSync(imgDir).filter((name) => name.endsWith(".png")).sort(naturalSort);
    return { imageBuffers: names.map((name) => fs.readFileSync(path.join(imgDir, name))), warnings: [] };
  } catch (error) {
    return { imageBuffers: [], warnings: [error instanceof Error ? `PPTX 拆页失败：${error.message}` : "PPTX 拆页失败"] };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function runVisionOcr(imagePath: string): Promise<EditablePptOcrLine[]> {
  if (process.platform !== "darwin") return [];
  const scriptPath = path.join(process.cwd(), "scripts", "vision_ocr.swift");
  if (!fs.existsSync(scriptPath)) return [];
  try {
    const { stdout } = await execFileAsync("/usr/bin/swift", [scriptPath, imagePath], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { lines?: Array<{ text: string; confidence: number; bbox: number[] }> };
    return Array.isArray(parsed.lines)
      ? parsed.lines
          .filter((line) => Array.isArray(line.bbox) && line.bbox.length === 4 && typeof line.text === "string")
          .map((line) => ({
            text: line.text,
            confidence: Number.isFinite(line.confidence) ? Number(line.confidence) : 0,
            bbox: [
              Number(line.bbox[0]) || 0,
              Number(line.bbox[1]) || 0,
              Number(line.bbox[2]) || 0,
              Number(line.bbox[3]) || 0,
            ] as [number, number, number, number],
          }))
      : [];
  } catch {
    return [];
  }
}

async function drawPreview(
  buffer: Buffer,
  width: number,
  height: number,
  seeds: ImportedElementSeed[],
) {
  if (!width || !height || seeds.length === 0) return null;
  const overlay = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${seeds
        .map((seed) => {
          const fill = seed.elementType === "text"
            ? "rgba(59,130,246,0.04)"
            : seed.elementType === "shape"
              ? "rgba(34,197,94,0.05)"
              : "rgba(245,158,11,0.05)";
          const stroke = seed.elementType === "text"
            ? "rgba(59,130,246,0.88)"
            : seed.elementType === "shape"
              ? "rgba(34,197,94,0.86)"
              : "rgba(245,158,11,0.88)";
          return `
            <rect
              x="${seed.bboxX}"
              y="${seed.bboxY}"
              width="${Math.max(2, seed.bboxW)}"
              height="${Math.max(2, seed.bboxH)}"
              rx="8"
              fill="${fill}"
              stroke="${stroke}"
              stroke-width="${seed.elementType === "shape" ? 1.6 : 2}"
              stroke-dasharray="${seed.elementType === "image" || seed.elementType === "chart_or_complex" ? "8 6" : "0"}"
            />
          `;
        })
        .join("")}
    </svg>
  `;
  const composited = await sharp(buffer).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).png().toBuffer();
  return saveBinaryFile(composited, `editable_preview_${Date.now()}.png`, "image/png");
}

function parseSlideRelationships(xml: string) {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractXmlSection(block: string, tagName: string) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`));
  return match?.[1] || "";
}

function parseAlphaPercent(section: string) {
  const alphaRaw = Number(section.match(/<a:alpha[^>]*val="(\d+)"/)?.[1] || 100000);
  const alphaPercent = clamp(Math.round(alphaRaw / 1000), 0, 100);
  return 100 - alphaPercent;
}

function parseShapeFill(section: string) {
  if (!section || /<a:noFill\s*\/>/.test(section)) {
    return { fill: null as string | null, transparency: 100 };
  }
  const color = section.match(/<a:solidFill>[\s\S]*?<a:srgbClr[^>]*val="([0-9A-Fa-f]{6})"/)?.[1];
  if (!color) {
    return { fill: null as string | null, transparency: 100 };
  }
  return {
    fill: `#${color.toUpperCase()}`,
    transparency: parseAlphaPercent(section),
  };
}

function parseShapeLine(section: string) {
  const lineSection = section.match(/<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/);
  const selfClosing = lineSection ? null : section.match(/<a:ln\b([^>]*)\s*\/>/);
  if (!lineSection && !selfClosing) {
    return {
      stroke: null as string | null,
      strokeWidth: 0,
      strokeTransparency: 100,
    };
  }

  const attrs = lineSection?.[1] || selfClosing?.[1] || "";
  const body = lineSection?.[2] || "";
  const color = body.match(/<a:solidFill>[\s\S]*?<a:srgbClr[^>]*val="([0-9A-Fa-f]{6})"/)?.[1];
  const widthEmu = Number(attrs.match(/w="(\d+)"/)?.[1] || 0);
  return {
    stroke: color ? `#${color.toUpperCase()}` : null,
    strokeWidth: widthEmu > 0 ? Math.max(0.5, round2(widthEmu / 12700)) : 0,
    strokeTransparency: body ? parseAlphaPercent(body) : 0,
  };
}

function extractTransformBox(xml: string) {
  const match = xml.match(/<a:xfrm[\s\S]*?<a:off[^>]*x="(\d+)"[^>]*y="(\d+)"[^>]*\/>[\s\S]*?<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*\/>[\s\S]*?<\/a:xfrm>/);
  if (!match) return null;
  return {
    x: Number(match[1] || 0),
    y: Number(match[2] || 0),
    w: Number(match[3] || 0),
    h: Number(match[4] || 0),
  };
}

function emuToPx(value: number, totalEmu: number, totalPx: number) {
  if (!totalEmu || !totalPx) return 0;
  return (value / totalEmu) * totalPx;
}

function parsePptxSlideSize(presentationXml: string) {
  const match = presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  return {
    width: Number(match?.[1] || 12192000),
    height: Number(match?.[2] || 6858000),
  };
}

function buildPptxTextSeed(
  box: { x: number; y: number; w: number; h: number },
  texts: string[],
  slideEmuWidth: number,
  slideEmuHeight: number,
  pageWidth: number,
  pageHeight: number,
  zIndex: number,
  block: string,
): ImportedElementSeed {
  const fontMatch = block.match(/<a:(?:defRPr|rPr)[^>]*sz="(\d+)"/);
  const colorMatch = block.match(/<a:srgbClr[^>]*val="([0-9A-Fa-f]{6})"/);
  const alignMatch = block.match(/<a:pPr[^>]*algn="([^"]+)"/);
  const fontSizePt = fontMatch ? Number(fontMatch[1]) / 100 : Math.max(16, Math.round(emuToPx(box.h, slideEmuHeight, pageHeight) * 0.34));
  const alignRaw = (alignMatch?.[1] || "l").toLowerCase();
  const align = alignRaw === "ctr" ? "center" : alignRaw === "r" ? "right" : "left";
  const bbox: [number, number, number, number] = [
    emuToPx(box.x, slideEmuWidth, pageWidth),
    emuToPx(box.y, slideEmuHeight, pageHeight),
    emuToPx(box.w, slideEmuWidth, pageWidth),
    emuToPx(box.h, slideEmuHeight, pageHeight),
  ];
  return {
    elementType: "text" as const,
    bboxX: bbox[0],
    bboxY: bbox[1],
    bboxW: bbox[2],
    bboxH: bbox[3],
    zIndex,
    rotation: 0,
    opacity: 100,
    confidence: 99,
    textContent: texts.join("\n"),
    style: {
      fontSize: Math.max(10, Math.round(fontSizePt)),
      fontFamily: "Microsoft YaHei",
      color: `#${(colorMatch?.[1] || "111111").toUpperCase()}`,
      align,
      lineHeight: 1.18,
    },
    assetKey: null,
    assetUrl: null,
    sourceRef: "pptx-text",
    nodeRole: bbox[1] < pageHeight * 0.24 && bbox[3] > pageHeight * 0.05 ? "title" : "body",
    exportMode: "editable" as const,
    originStage: "native" as const,
  };
}

function inferShapeRole(
  prst: string,
  bbox: [number, number, number, number],
  pageWidth: number,
  pageHeight: number,
): EditablePptNodeRole {
  const areaRatio = bboxArea(bbox) / Math.max(1, pageWidth * pageHeight);
  if (areaRatio >= 0.82) return "background";
  if (["line", "arc"].includes(prst) || bbox[2] < 96 || bbox[3] < 96) return "decoration";
  if (["ellipse", "triangle", "diamond", "chevron"].includes(prst)) return "decoration";
  return "card";
}

function buildPptxBackgroundSeed(
  slideXml: string,
  pageWidth: number,
  pageHeight: number,
  zIndex: number,
): ImportedElementSeed | null {
  const bgSection = extractXmlSection(slideXml, "p:bgPr");
  if (!bgSection) return null;
  const fill = parseShapeFill(bgSection);
  if (!fill.fill || fill.transparency >= 96) return null;
  return {
    elementType: "shape",
    bboxX: 0,
    bboxY: 0,
    bboxW: pageWidth,
    bboxH: pageHeight,
    zIndex,
    rotation: 0,
    opacity: 100,
    confidence: 99,
    textContent: null,
    style: {
      shapeType: "rect",
      fill: fill.fill,
      transparency: fill.transparency,
      stroke: null,
      strokeWidth: 0,
      strokeTransparency: 100,
    },
    assetKey: null,
    assetUrl: null,
    sourceRef: "pptx-background",
    nodeRole: "background",
    exportMode: "editable",
    originStage: "native",
  };
}

function buildPptxShapeSeed(
  block: string,
  box: { x: number; y: number; w: number; h: number },
  slideEmuWidth: number,
  slideEmuHeight: number,
  pageWidth: number,
  pageHeight: number,
  zIndex: number,
): ImportedElementSeed | null {
  const spPr = extractXmlSection(block, "p:spPr");
  if (!spPr) return null;

  const prst = spPr.match(/<a:prstGeom[^>]*prst="([^"]+)"/)?.[1] || "rect";
  const fill = parseShapeFill(spPr);
  const line = parseShapeLine(spPr);
  const hasVisibleFill = Boolean(fill.fill) && fill.transparency < 96;
  const hasVisibleStroke = Boolean(line.stroke) && (line.strokeWidth > 0 || ["line", "arc"].includes(prst));
  if (!hasVisibleFill && !hasVisibleStroke) return null;

  const bbox: [number, number, number, number] = [
    emuToPx(box.x, slideEmuWidth, pageWidth),
    emuToPx(box.y, slideEmuHeight, pageHeight),
    emuToPx(box.w, slideEmuWidth, pageWidth),
    emuToPx(box.h, slideEmuHeight, pageHeight),
  ];
  const rotationRaw = Number(spPr.match(/<a:xfrm[^>]*rot="(-?\d+)"/)?.[1] || 0);

  return {
    elementType: "shape",
    bboxX: bbox[0],
    bboxY: bbox[1],
    bboxW: bbox[2],
    bboxH: bbox[3],
    zIndex,
    rotation: round2(rotationRaw / 60000),
    opacity: 100,
    confidence: 98,
    textContent: null,
    style: {
      shapeType: prst,
      fill: fill.fill,
      transparency: fill.transparency,
      stroke: line.stroke,
      strokeWidth: line.strokeWidth,
      strokeTransparency: line.strokeTransparency,
    },
    assetKey: null,
    assetUrl: null,
    sourceRef: "pptx-shape",
    nodeRole: inferShapeRole(prst, bbox, pageWidth, pageHeight),
    exportMode: "editable",
    originStage: "native",
  };
}

function resolveZipMediaPath(slidePath: string, target: string) {
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(slidePath), target));
  return normalized.replace(/^(\.\.\/)+/, "");
}

async function parsePptxSlideSeeds(
  zip: JSZip,
  slidePath: string,
  slideXml: string,
  relXml: string | null,
  slideEmuWidth: number,
  slideEmuHeight: number,
  pageWidth: number,
  pageHeight: number,
  pageIndex: number,
): Promise<ParsedPptxSlideSeed> {
  const relationships = parseSlideRelationships(relXml || "");
  const textSeeds: ImportedElementSeed[] = [];
  const imageSeeds: ImportedElementSeed[] = [];
  const shapeSeeds: ImportedElementSeed[] = [];

  let zIndex = 20;
  const backgroundSeed = buildPptxBackgroundSeed(slideXml, pageWidth, pageHeight, zIndex++);
  if (backgroundSeed) {
    shapeSeeds.push(backgroundSeed);
  }

  for (const match of slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const block = match[0];
    const box = extractTransformBox(block);
    const texts = [...block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((item) => decodeXmlEntities(item[1]))
      .filter(Boolean);
    if (!box) continue;

    const shapeSeed = buildPptxShapeSeed(block, box, slideEmuWidth, slideEmuHeight, pageWidth, pageHeight, zIndex++);
    if (shapeSeed) {
      const shapeBox: [number, number, number, number] = [shapeSeed.bboxX, shapeSeed.bboxY, shapeSeed.bboxW, shapeSeed.bboxH];
      const bgBox: [number, number, number, number] | null = backgroundSeed
        ? [backgroundSeed.bboxX, backgroundSeed.bboxY, backgroundSeed.bboxW, backgroundSeed.bboxH]
        : null;
      const duplicatedBackground = bgBox
        ? overlapArea(shapeBox, bgBox) / Math.max(1, bboxArea(shapeBox)) > 0.92
        : false;
      if (!(duplicatedBackground && shapeSeed.nodeRole === "background")) {
        shapeSeeds.push(shapeSeed);
      }
    }

    if (texts.length > 0) {
      textSeeds.push(buildPptxTextSeed(box, texts, slideEmuWidth, slideEmuHeight, pageWidth, pageHeight, zIndex++, block));
    }
  }

  for (const match of slideXml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
    const block = match[0];
    const box = extractTransformBox(block);
    const embed = block.match(/<a:blip[^>]*r:embed="([^"]+)"/)?.[1];
    const target = embed ? relationships.get(embed) || null : null;
    if (!box || !target) continue;
    const mediaPath = resolveZipMediaPath(slidePath, target);
    const zipped = zip.file(mediaPath);
    if (!zipped) continue;
    const assetBuffer = await zipped.async("nodebuffer");
    const ext = path.extname(mediaPath).toLowerCase() || ".png";
    const savedAsset = saveBinaryFile(assetBuffer, `editable_asset_${pageIndex}_${cleanName(path.basename(mediaPath))}`, contentTypeFromExt(ext));
    imageSeeds.push({
      elementType: "image",
      bboxX: emuToPx(box.x, slideEmuWidth, pageWidth),
      bboxY: emuToPx(box.y, slideEmuHeight, pageHeight),
      bboxW: emuToPx(box.w, slideEmuWidth, pageWidth),
      bboxH: emuToPx(box.h, slideEmuHeight, pageHeight),
      zIndex: zIndex++,
      rotation: 0,
      opacity: 100,
      confidence: 99,
      textContent: null,
      style: {},
      assetKey: savedAsset.key,
      assetUrl: savedAsset.url,
      sourceRef: "pptx-media",
      nodeRole: "media",
      exportMode: "raster",
      originStage: "native",
    });
  }

  return { textSeeds, imageSeeds, shapeSeeds };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function sanitizeOcrText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[|｜]{2,}/g, "|")
    .trim();
}

function noisyCharacterRatio(text: string) {
  const normalized = normalizeTextForCheck(text);
  if (!normalized) return 1;
  const chars = Array.from(normalized);
  const noisy = chars.filter((char) => !/[\u4E00-\u9FFFA-Za-z0-9()（）【】《》“”‘’"'、，。！？!?,.:：;；\-+/%&]/.test(char)).length;
  return noisy / Math.max(1, chars.length);
}

function isLikelyNoiseLine(
  line: EditablePptOcrLine,
  pageWidth: number,
  pageHeight: number,
) {
  const text = sanitizeOcrText(line.text);
  const normalized = normalizeTextForCheck(text);
  if (!normalized) return true;

  const box = line.bbox;
  const area = bboxArea(box);
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const hasReadableChar = /[A-Za-z0-9\u4E00-\u9FFF]/.test(normalized);
  const tinyBox = box[2] < Math.max(18, pageWidth * 0.012) || box[3] < Math.max(14, pageHeight * 0.012);
  const ultraSmall = area < pageArea * 0.00008;

  if (!hasReadableChar && normalized.length <= 3) return true;
  if (ultraSmall && line.confidence < 0.52) return true;
  if (tinyBox && normalized.length <= 2 && line.confidence < 0.62) return true;
  if (normalized.length === 1 && /[·•\-_.,:;]/.test(normalized) && line.confidence < 0.72) return true;
  return false;
}

function horizontalOverlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number],
) {
  const left = Math.max(a[0], b[0]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const overlap = Math.max(0, right - left);
  return overlap / Math.max(1, Math.min(a[2], b[2]));
}

function isBulletLine(text: string) {
  return /^[•·▪■◆▶\-\dA-Za-z一二三四五六七八九十]+[).、:：\s]/.test(text.trim());
}

function shouldMergeOcrLine(
  group: ParagraphGroup,
  line: EditablePptOcrLine,
  pageWidth: number,
) {
  const currentBox = line.bbox;
  const lastLine = group.lines[group.lines.length - 1];
  const lastLineBox = lastLine?.bbox || group.bbox;
  const verticalGap = currentBox[1] - (lastLineBox[1] + lastLineBox[3]);
  if (verticalGap < -Math.max(currentBox[3] * 0.3, 8)) return false;

  const leftGap = Math.abs(currentBox[0] - lastLineBox[0]);
  const centerGap = Math.abs(
    (currentBox[0] + currentBox[2] / 2) - (lastLineBox[0] + lastLineBox[2] / 2),
  );
  const widthRatio = currentBox[2] / Math.max(1, lastLineBox[2]);
  const similarHeight = currentBox[3] / Math.max(1, group.avgLineHeight);
  const alignedColumn =
    horizontalOverlapRatio(currentBox, lastLineBox) > 0.18
    || leftGap <= Math.max(36, pageWidth * 0.028)
    || centerGap <= Math.max(42, pageWidth * 0.03);
  const bulletContinuation = isBulletLine(lastLine.text) || isBulletLine(line.text);
  const widthCompatible = widthRatio >= 0.42 && widthRatio <= 2.4;

  if (!alignedColumn && !bulletContinuation) return false;
  if (!widthCompatible && !bulletContinuation) return false;
  if (similarHeight < 0.55 || similarHeight > 1.85) return false;
  if (verticalGap > Math.max(group.avgLineHeight * 1.1, currentBox[3] * 1.1, bulletContinuation ? 30 : 22)) return false;

  const strongStyleJump =
    Math.abs(currentBox[3] - group.avgLineHeight) > Math.max(18, group.avgLineHeight * 0.7)
    && verticalGap > 8;
  if (strongStyleJump) return false;

  return true;
}

function buildParagraphGroups(
  ocrLines: EditablePptOcrLine[],
  pageWidth: number,
  pageHeight: number,
): ParagraphGroup[] {
  if (ocrLines.length === 0) return [];
  const sorted = [...ocrLines]
    .map((line) => ({
      ...line,
      text: sanitizeOcrText(line.text),
    }))
    .filter((line) => line.text.length > 0)
    .filter((line) => !isLikelyNoiseLine(line, pageWidth, pageHeight))
    .sort((a, b) => {
      if (Math.abs(a.bbox[1] - b.bbox[1]) > 6) return a.bbox[1] - b.bbox[1];
      return a.bbox[0] - b.bbox[0];
    });

  if (sorted.length === 0) return [];
  const maxLineHeight = Math.max(...sorted.map((line) => line.bbox[3]), 18);
  const groups: ParagraphGroup[] = [];

  for (const line of sorted) {
    const [x, y, w, h] = line.bbox;
    const currentBox: [number, number, number, number] = [x, y, w, h];
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push({
        id: randomUUID(),
        lines: [line],
        bbox: currentBox,
        text: line.text,
        avgConfidence: line.confidence,
        avgLineHeight: h,
        align: inferTextAlign(currentBox, pageWidth),
        role: inferTextRole(currentBox, h, line.text, pageWidth, pageHeight, maxLineHeight),
      });
      continue;
    }

    const shouldMerge = shouldMergeOcrLine(last, line, pageWidth);

    if (!shouldMerge) {
      groups.push({
        id: randomUUID(),
        lines: [line],
        bbox: currentBox,
        text: line.text,
        avgConfidence: line.confidence,
        avgLineHeight: h,
        align: inferTextAlign(currentBox, pageWidth),
        role: inferTextRole(currentBox, h, line.text, pageWidth, pageHeight, maxLineHeight),
      });
      continue;
    }

    last.lines.push(line);
    last.bbox = unionBbox([...last.lines.map((item) => item.bbox)]);
    last.text = last.lines.map((item) => item.text).join("\n");
    last.avgConfidence = average(last.lines.map((item) => item.confidence));
    last.avgLineHeight = average(last.lines.map((item) => item.bbox[3]));
    last.align = inferTextAlign(last.bbox, pageWidth);
    last.role = inferTextRole(last.bbox, last.avgLineHeight, last.text, pageWidth, pageHeight, maxLineHeight);
  }

  return groups.filter((group) => normalizeTextForCheck(group.text).length > 0);
}

async function sampleRegionStats(buffer: Buffer, box: [number, number, number, number]) {
  const [x, y, w, h] = box.map((value) => Math.round(value)) as [number, number, number, number];
  if (w < 2 || h < 2) return null;
  try {
    const stats = await sharp(buffer, { limitInputPixels: false }).extract({ left: x, top: y, width: w, height: h }).stats();
    return {
      mean: [
        Math.round(stats.channels[0]?.mean || 255),
        Math.round(stats.channels[1]?.mean || 255),
        Math.round(stats.channels[2]?.mean || 255),
      ] as [number, number, number],
      dominant: [stats.dominant.r, stats.dominant.g, stats.dominant.b] as [number, number, number],
      entropy: stats.entropy || 0,
      sharpness: stats.sharpness || 0,
    };
  } catch {
    return null;
  }
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2,
  );
}

function rgbSaturation(rgb: [number, number, number]) {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  if (max <= 0) return 0;
  return (max - min) / max;
}

async function estimateBackgroundColor(buffer: Buffer, width: number, height: number) {
  const sampleBoxes: Array<[number, number, number, number]> = [
    [0, 0, width, Math.max(16, Math.round(height * 0.05))],
    [0, height - Math.max(16, Math.round(height * 0.05)), width, Math.max(16, Math.round(height * 0.05))],
    [0, 0, Math.max(16, Math.round(width * 0.05)), height],
    [width - Math.max(16, Math.round(width * 0.05)), 0, Math.max(16, Math.round(width * 0.05)), height],
  ];
  const stats = await Promise.all(sampleBoxes.map((box) => sampleRegionStats(buffer, box)));
  const usable = stats.filter(Boolean) as Array<{ mean: [number, number, number] }>;
  if (usable.length === 0) return [245, 245, 245] as [number, number, number];
  return [
    Math.round(average(usable.map((item) => item.mean[0]))),
    Math.round(average(usable.map((item) => item.mean[1]))),
    Math.round(average(usable.map((item) => item.mean[2]))),
  ] as [number, number, number];
}

async function saveRegionAsset(
  buffer: Buffer,
  box: [number, number, number, number],
  prefix: string,
) {
  const [x, y, w, h] = box.map((value) => Math.round(value)) as [number, number, number, number];
  if (w < 2 || h < 2) return null;
  const cropped = await sharp(buffer, { limitInputPixels: false }).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
  return saveBinaryFile(cropped, `${prefix}_${Date.now()}.png`, "image/png");
}

function splitLargeRegionBox(
  box: [number, number, number, number],
  width: number,
  height: number,
): Array<[number, number, number, number]> {
  const [x, y, w, h] = box;
  const pageArea = width * height;
  const areaRatio = bboxArea(box) / Math.max(1, pageArea);
  if (areaRatio < 0.34) return [box];

  const result: Array<[number, number, number, number]> = [];
  if (w > h * 1.35) {
    const splitX1 = x + w * 0.42;
    const splitX2 = x + w * 0.68;
    result.push([x, y, splitX1 - x, h]);
    result.push([splitX1, y, splitX2 - splitX1, h]);
    result.push([splitX2, y, x + w - splitX2, h]);
    return result.map((item) => [item[0], item[1], Math.max(1, item[2]), Math.max(1, item[3])] as [number, number, number, number]);
  }

  if (h > w * 1.2) {
    const splitY = y + h * 0.5;
    result.push([x, y, w, splitY - y]);
    result.push([x, splitY, w, y + h - splitY]);
    return result.map((item) => [item[0], item[1], Math.max(1, item[2]), Math.max(1, item[3])] as [number, number, number, number]);
  }

  return [box];
}

async function detectVisualRegions(
  buffer: Buffer,
  width: number,
  height: number,
  textBoxes: Array<[number, number, number, number]>,
  backgroundColor: [number, number, number],
) {
  const cols = clamp(Math.round(width / 48), 24, 64);
  const rows = clamp(Math.round(height / 48), 18, 64);
  const raw = await sharp(buffer, { limitInputPixels: false })
    .resize(cols, rows, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const strong: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const candidate: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cellsMeta: Array<Array<{
    rgb: [number, number, number];
    dist: number;
    saturation: number;
    delta: number;
    overlapsText: boolean;
  }>> = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
    rgb: [255, 255, 255] as [number, number, number],
    dist: 0,
    saturation: 0,
    delta: 0,
    overlapsText: false,
  })));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const idx = (row * cols + col) * 3;
      const rgb: [number, number, number] = [raw[idx], raw[idx + 1], raw[idx + 2]];
      const cellBox: [number, number, number, number] = [col * cellWidth, row * cellHeight, cellWidth, cellHeight];
      const overlapsText = textBoxes.some((box) => overlapArea(box, cellBox) >= bboxArea(cellBox) * 0.24);
      const dist = colorDistance(rgb, backgroundColor);
      cellsMeta[row][col] = {
        rgb,
        dist,
        saturation: rgbSaturation(rgb),
        delta: 0,
        overlapsText,
      };
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const current = cellsMeta[row][col];
      const neighbors: Array<[number, number, number]> = [];
      if (row > 0) neighbors.push(cellsMeta[row - 1][col].rgb);
      if (row < rows - 1) neighbors.push(cellsMeta[row + 1][col].rgb);
      if (col > 0) neighbors.push(cellsMeta[row][col - 1].rgb);
      if (col < cols - 1) neighbors.push(cellsMeta[row][col + 1].rgb);
      current.delta = average(neighbors.map((neighbor) => colorDistance(current.rgb, neighbor)));
      if (current.overlapsText) continue;

      const isStrong =
        (current.dist > 30 && current.delta > 9)
        || (current.dist > 22 && current.saturation > 0.13 && current.delta > 8)
        || (current.dist > 18 && current.delta > 18);
      const isCandidate =
        (current.dist > 16 && current.delta > 5)
        || (current.dist > 22 && current.saturation > 0.08);
      strong[row][col] = isStrong;
      candidate[row][col] = isCandidate || isStrong;
    }
  }

  const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const regions: VisualRegion[] = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!strong[row][col] || visited[row][col]) continue;
      const queue: Array<[number, number]> = [[row, col]];
      visited[row][col] = true;
      const cells: Array<[number, number]> = [];

      while (queue.length > 0) {
        const [r, c] = queue.shift()!;
        cells.push([r, c]);
        for (const [dr, dc] of directions) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (visited[nr][nc] || !candidate[nr][nc]) continue;
          visited[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }

      const mergedBox = unionBbox(
        cells.map(([r, c]) => [
          c * cellWidth,
          r * cellHeight,
          cellWidth,
          cellHeight,
        ] as [number, number, number, number]),
      );

      const splitBoxes = splitLargeRegionBox(mergedBox, width, height);
      for (const box of splitBoxes) {
        if (bboxArea(box) < width * height * 0.006) continue;
        if (box[2] < 42 || box[3] < 32) continue;
        if (textBoxes.some((textBox) => boxContains(box, textBox) && bboxArea(textBox) / Math.max(1, bboxArea(box)) > 0.55)) continue;
        const stats = await sampleRegionStats(buffer, box);
        if (!stats) continue;
        const avgDelta = average(cells.map(([r, c]) => cellsMeta[r][c].delta));
        const avgSaturation = average(cells.map(([r, c]) => cellsMeta[r][c].saturation));
        regions.push({
          bbox: box,
          area: bboxArea(box),
          mean: stats.mean,
          dominant: stats.dominant,
          entropy: stats.entropy,
          sharpness: stats.sharpness,
          avgDelta,
          saturation: avgSaturation,
          cellCount: cells.length,
        });
      }
    }
  }

  return regions
    .sort((a, b) => b.area - a.area)
    .filter((region, index, all) => {
      if (region.area > width * height * 0.72 && region.avgDelta < 14) return false;
      return !all.some((other, otherIndex) => otherIndex < index && overlapArea(other.bbox, region.bbox) / Math.max(1, bboxArea(region.bbox)) > 0.72);
    });
}

function buildTextSeedsFromGroups(groups: ParagraphGroup[], pageHeight: number) {
  return groups.map<ImportedElementSeed>((group, index) => {
    const fontSize = clamp(Math.round(group.avgLineHeight * 0.76), 12, 42);
    const confidence = Math.round(group.avgConfidence * 100);
    const normalized = normalizeTextForCheck(group.text);
    const boxArea = bboxArea(group.bbox);
    const lineCount = group.lines.length;
    const charCount = Array.from(normalized).length;
    const lowConfidence = confidence < 54;
    const veryLowConfidence = confidence < 44;
    const mediumLowConfidence = confidence < 60;
    const shortToken = normalized.length <= 6;
    const tinyBlock = group.bbox[2] <= 168 || group.bbox[3] <= 30 || boxArea <= 3600;
    const prominent = group.role === "title" || group.role === "subtitle" || group.bbox[3] >= pageHeight * 0.05;
    const symbolHeavy = noisyCharacterRatio(group.text) > 0.28;
    const singleTinyLine = lineCount === 1 && shortToken && tinyBlock;
    const compactProminent = prominent && charCount <= 8 && lineCount <= 1;
    const weakSingleLine = lineCount === 1 && charCount <= 12;
    const shouldIgnore =
      (veryLowConfidence && (!prominent || compactProminent))
      || (lowConfidence && singleTinyLine)
      || (lowConfidence && normalized.length <= 2)
      || (mediumLowConfidence && weakSingleLine && !prominent)
      || (mediumLowConfidence && compactProminent)
      || (symbolHeavy && confidence < 68 && !prominent);
    return {
      id: group.id,
      elementType: "text",
      bboxX: Math.round(group.bbox[0]),
      bboxY: Math.round(group.bbox[1]),
      bboxW: Math.round(group.bbox[2]),
      bboxH: Math.round(group.bbox[3]),
      zIndex: 200 + index,
      rotation: 0,
      opacity: 100,
      confidence,
      textContent: group.text,
      style: {
        fontSize,
        fontFamily: "Microsoft YaHei",
        color: "#111111",
        align: group.align,
        lineHeight: group.role === "title" ? 1.1 : 1.22,
      },
      assetKey: null,
      assetUrl: null,
      sourceRef: "ocr-paragraph",
      groupId: group.id,
      nodeRole: group.role,
      exportMode: shouldIgnore ? "ignored" : "editable",
      originStage: "ocr",
    };
  });
}

function suppressTextInsideVisualMedia(
  textSeeds: ImportedElementSeed[],
  visualSeeds: ImportedElementSeed[],
) {
  const mediaBoxes = visualSeeds
    .filter((seed) => {
      const kind = String((seed.style?.regionKind as string | undefined) || "");
      return kind === "video" || kind === "document";
    })
    .map((seed) => ({
      box: [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH] as [number, number, number, number],
      kind: String((seed.style?.regionKind as string | undefined) || ""),
    }));

  if (mediaBoxes.length === 0) return textSeeds;

  return textSeeds.map((seed) => {
    if (seed.elementType !== "text") return seed;
    const seedBox: [number, number, number, number] = [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH];
    const insideMedia = mediaBoxes.some((media) => {
      const overlapRatio = overlapRatioToSmaller(seedBox, media.box);
      return overlapRatio >= 0.72 || boxContains(media.box, seedBox);
    });
    if (!insideMedia) return seed;
    return {
      ...seed,
      exportMode: "ignored" as const,
      sourceRef: `${seed.sourceRef || "ocr-paragraph"}-suppressed`,
    };
  });
}

function classifyRegionAsShape(
  region: VisualRegion,
  pageArea: number,
  backgroundColor: [number, number, number],
  config: EditablePptConfig,
) {
  if (!config.rebuildShapes) return false;
  const [w, h] = [region.bbox[2], region.bbox[3]];
  if (w <= 80 || h <= 30) return false;
  const dist = colorDistance(region.mean, backgroundColor);
  const coversTooMuch = region.area > pageArea * 0.52;
  return !coversTooMuch && region.entropy < 2.2 && region.sharpness < 18 && dist > 12;
}

function inferVisualRegionKind(region: VisualRegion) {
  const [w, h] = [region.bbox[2], region.bbox[3]];
  const ratio = w / Math.max(1, h);
  if (ratio > 1.2 && ratio < 2.1 && region.area > 180000 && region.avgDelta > 18) return "video";
  if (ratio > 0.55 && ratio < 0.9 && region.area > 120000 && region.saturation < 0.16 && region.entropy < 4.8) return "document";
  if (ratio > 0.55 && ratio < 0.95 && region.area > 70000 && region.saturation > 0.14 && region.avgDelta > 14) return "person";
  if (region.avgDelta > 20 || region.saturation > 0.2) return "graphic";
  return "complex";
}

async function buildVisualSeeds(
  buffer: Buffer,
  regions: VisualRegion[],
  backgroundColor: [number, number, number],
  pageArea: number,
  config: EditablePptConfig,
  pageNumber: number,
) {
  const seeds: ImportedElementSeed[] = [];
  let zIndex = 20;

  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    const regionKind = inferVisualRegionKind(region);
    const isShape = classifyRegionAsShape(region, pageArea, backgroundColor, config);
    if (isShape) {
      const fillHex = `#${region.mean.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
      seeds.push({
        elementType: "shape",
        bboxX: Math.round(region.bbox[0]),
        bboxY: Math.round(region.bbox[1]),
        bboxW: Math.round(region.bbox[2]),
        bboxH: Math.round(region.bbox[3]),
        zIndex: zIndex++,
        rotation: 0,
        opacity: 100,
        confidence: Math.round(clamp(82 - region.entropy * 8, 58, 92)),
        textContent: null,
        style: {
          shapeType: region.bbox[2] > 140 && region.bbox[3] > 48 ? "roundRect" : "rect",
          fill: fillHex,
          transparency: 0,
          radiusRatio: region.bbox[2] > 160 ? 0.18 : 0,
        },
        assetKey: null,
        assetUrl: null,
        sourceRef: "region-shape",
        nodeRole: "card",
        exportMode: "editable",
        originStage: "region",
      });
      continue;
    }

    const asset = await saveRegionAsset(buffer, region.bbox, `editable_region_${pageNumber}_${index + 1}`);
    const large = region.area > pageArea * 0.22;
    seeds.push({
      elementType: large ? "chart_or_complex" : "image",
      bboxX: Math.round(region.bbox[0]),
      bboxY: Math.round(region.bbox[1]),
      bboxW: Math.round(region.bbox[2]),
      bboxH: Math.round(region.bbox[3]),
      zIndex: zIndex++,
      rotation: 0,
      opacity: 100,
      confidence: Math.round(clamp(78 - region.entropy * 5, 48, 88)),
      textContent: null,
      style: {
        regionKind,
        entropy: round2(region.entropy),
        sharpness: round2(region.sharpness),
        avgDelta: round2(region.avgDelta),
        saturation: round2(region.saturation),
      },
      assetKey: asset?.key || null,
      assetUrl: asset?.url || null,
      sourceRef: regionKind === "video"
        ? "region-video"
        : regionKind === "document"
          ? "region-document"
          : large ? "region-complex" : "region-image",
      nodeRole: regionKind === "person" ? "media" : large ? "decoration" : "media",
      exportMode: "raster",
      originStage: "region",
    });
  }

  return seeds;
}

function isTextSeed(seed: ImportedElementSeed) {
  return seed.elementType === "text";
}

function isShapeSeed(seed: ImportedElementSeed) {
  return seed.elementType === "shape";
}

function isRasterLikeSeed(seed: ImportedElementSeed) {
  return seed.exportMode === "raster" || ["image", "chart_or_complex", "icon", "table"].includes(seed.elementType);
}

function isNativeDominantPage(seeds: ImportedElementSeed[]) {
  if (seeds.length === 0) return false;
  const nativeCount = seeds.filter((seed) => seed.originStage === "native").length;
  return nativeCount > 0 && nativeCount / seeds.length >= 0.6;
}

function isBenignOverlapPair(
  seed: ImportedElementSeed,
  other: ImportedElementSeed,
  nativeDominant: boolean,
) {
  if (seed.exportMode === "ignored" || other.exportMode === "ignored") return true;
  if (seed.hidden || other.hidden) return true;

  if (
    seed.nodeRole === "background"
    || other.nodeRole === "background"
    || seed.nodeRole === "decoration"
    || other.nodeRole === "decoration"
  ) {
    return true;
  }

  if (
    (isTextSeed(seed) && isShapeSeed(other))
    || (isShapeSeed(seed) && isTextSeed(other))
  ) {
    return true;
  }

  if (
    (seed.nodeRole === "card" && isTextSeed(other))
    || (other.nodeRole === "card" && isTextSeed(seed))
  ) {
    return true;
  }

  const seedBox: [number, number, number, number] = [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH];
  const otherBox: [number, number, number, number] = [other.bboxX, other.bboxY, other.bboxW, other.bboxH];
  const oneContainsAnother = boxContains(seedBox, otherBox) || boxContains(otherBox, seedBox);

  if (isShapeSeed(seed) && isShapeSeed(other)) {
    if (nativeDominant) return true;
    if (oneContainsAnother) return true;
  }

  if (nativeDominant && oneContainsAnother) {
    return true;
  }

  if (
    nativeDominant
    && (
      (seed.originStage === "native" && other.originStage === "native")
      || (seed.nodeRole === "card" || other.nodeRole === "card")
    )
  ) {
    return true;
  }

  if (isTextSeed(seed) && isTextSeed(other)) {
    const sameTextBlock = oneContainsAnother || overlapRatioToSmaller(seedBox, otherBox) < 0.72;
    if (sameTextBlock) return true;
  }

  if (
    (isRasterLikeSeed(seed) && isTextSeed(other))
    || (isRasterLikeSeed(other) && isTextSeed(seed))
  ) {
    if (oneContainsAnother) return true;
  }

  return false;
}

function calcMetrics(
  seeds: ImportedElementSeed[],
  groups: ParagraphGroup[],
  pageArea: number,
): EditablePptStructureMetrics {
  const totalNodes = seeds.length;
  const textSeeds = seeds.filter((seed) => seed.elementType === "text" && seed.exportMode !== "ignored");
  const imageSeeds = seeds.filter((seed) => seed.elementType === "image");
  const shapeSeeds = seeds.filter((seed) => seed.elementType === "shape");
  const rasterSeeds = seeds.filter((seed) => seed.exportMode === "raster");
  const uncertainSeeds = seeds.filter((seed) =>
    seed.exportMode === "raster"
    && (seed.originStage !== "native" || seed.elementType === "chart_or_complex" || seed.confidence < 76)
  );
  const lowConfidenceNodes = seeds.filter((seed) => seed.confidence < 55).length;
  const editableArea = seeds
    .filter((seed) => seed.exportMode === "editable")
    .reduce((sum, seed) => sum + seed.bboxW * seed.bboxH, 0);
  const editableCoverage = clamp(Math.round((editableArea / Math.max(1, pageArea)) * 100), 0, 100);
  const averageTextConfidence = Math.round(average(textSeeds.map((seed) => seed.confidence)));
  const nativeDominant = isNativeDominantPage(seeds);
  const uncertainArea = clamp(
    uncertainSeeds.reduce((sum, seed) => sum + seed.bboxW * seed.bboxH, 0),
    0,
    Math.max(1, pageArea),
  );
  const uncertainAreaRatio = clamp(Math.round((uncertainArea / Math.max(1, pageArea)) * 100), 0, 100);
  const overlapPenalty = seeds.reduce((penalty, seed, index) => {
    const rest = seeds.slice(index + 1);
    const seedBox: [number, number, number, number] = [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH];
    const conflictingOverlap = rest.some((other) => {
      const otherBox: [number, number, number, number] = [other.bboxX, other.bboxY, other.bboxW, other.bboxH];
      const overlapRatio = overlapRatioToSmaller(seedBox, otherBox);
      if (overlapRatio <= 0.56) return false;
      if (isBenignOverlapPair(seed, other, nativeDominant)) return false;
      return true;
    });
    return penalty + (conflictingOverlap ? (nativeDominant ? 3 : 8) : 0);
  }, 0);

  const groupedTextCount = groups.filter((group) => group.lines.length > 1).length;
  const textRecoveryScore = textSeeds.length === 0
    ? 10
    : clamp(Math.round(averageTextConfidence * 0.62 + Math.min(28, groupedTextCount * 6) + Math.min(14, groups.length * 2)), 0, 100);
  const unknownNodeRatio = totalNodes === 0
    ? 100
    : clamp(
      Math.round(
        Math.max(
          (uncertainSeeds.length / totalNodes) * 100,
          uncertainAreaRatio * 0.92,
        ),
      ),
      0,
      100,
    );
  const layoutRecoveryScore = clamp(
    Math.round(
      (nativeDominant ? 74 : 68)
      + Math.min(16, shapeSeeds.length * 2)
      + Math.min(12, imageSeeds.length * 4)
      - overlapPenalty
      - Math.max(0, unknownNodeRatio - 35) * (nativeDominant ? 0.2 : 0.44),
    ),
    0,
    100,
  );
  const editableScore = clamp(
    Math.round(textRecoveryScore * 0.48 + layoutRecoveryScore * 0.32 + editableCoverage * 0.2),
    0,
    100,
  );

  return {
    totalNodes,
    textNodes: textSeeds.length,
    imageNodes: imageSeeds.length,
    shapeNodes: shapeSeeds.length,
    rasterNodes: rasterSeeds.length,
    lowConfidenceNodes,
    textLineCount: groups.reduce((sum, group) => sum + group.lines.length, 0),
    paragraphCount: groups.length,
    groupedTextCount,
    averageTextConfidence,
    editableCoverage,
    editableScore,
    textRecoveryScore,
    layoutRecoveryScore,
    unknownNodeRatio,
  };
}

function buildStructureFromSeeds(
  sourceKind: "pptx" | "pdf" | "image",
  pageMode: EditablePptPageMode,
  metrics: EditablePptStructureMetrics,
  warnings: string[],
  seeds: ImportedElementSeed[],
): Omit<EditablePptStructureRoot, "pageId" | "pageNumber"> {
  const children: EditablePptStructureNode[] = seeds
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((seed) => ({
      id: seed.id || randomUUID(),
      type: seed.elementType === "chart_or_complex" ? "chart" : seed.elementType,
      role: seed.nodeRole || "unknown",
      bbox: [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH],
      zIndex: seed.zIndex,
      confidence: seed.confidence,
      exportMode: seed.exportMode || "editable",
      fallbackStrategy: seed.exportMode === "raster" ? "rasterize" : "editable",
      sourceRef: seed.sourceRef,
      assetKey: seed.assetKey,
      assetUrl: seed.assetUrl,
      textContent: seed.textContent,
      style: seed.style,
      children: [],
    }));

  return {
    version: 2,
    width: 0,
    height: 0,
    sourceKind,
    pageMode,
    editableScore: metrics.editableScore,
    textRecoveryScore: metrics.textRecoveryScore,
    layoutRecoveryScore: metrics.layoutRecoveryScore,
    unknownNodeRatio: metrics.unknownNodeRatio,
    warnings,
    metrics,
    children,
  };
}

async function analyzeImagePage(
  buffer: Buffer,
  width: number,
  height: number,
  ocrLines: EditablePptOcrLine[],
  sourceText: string,
  config: EditablePptConfig,
  pageNumber: number,
): Promise<ImportedPageAnalysis> {
  const groups = buildParagraphGroups(ocrLines, width, height);
  const textSeeds = buildTextSeedsFromGroups(groups, height);
  const backgroundColor = await estimateBackgroundColor(buffer, width, height);
  const visualRegions = await detectVisualRegions(
    buffer,
    width,
    height,
    textSeeds.map((seed) => [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH] as [number, number, number, number]),
    backgroundColor,
  );
  const pageArea = width * height;
  const visualSeeds = await buildVisualSeeds(buffer, visualRegions, backgroundColor, pageArea, config, pageNumber);
  const filteredTextSeeds = suppressTextInsideVisualMedia(textSeeds, visualSeeds);
  const seeds = [...visualSeeds, ...filteredTextSeeds].sort((a, b) => a.zIndex - b.zIndex);
  const warnings: string[] = [];

  if (filteredTextSeeds.filter((seed) => seed.exportMode === "editable").length === 0 && normalizeTextForCheck(sourceText).length > 0) {
    warnings.push("页面已有文字线索，但 OCR 没有稳定识别出可编辑文本，建议人工复核。");
  }
  if (filteredTextSeeds.filter((seed) => seed.exportMode === "editable").length === 0) {
    warnings.push("当前页没有识别到稳定文字，将主要以图片保真方式导出。");
  }
  if (visualSeeds.some((seed) => seed.elementType === "chart_or_complex")) {
    warnings.push("复杂视觉区域会保留为局部图片，而不是强行拆成原生对象。");
  }

  if (seeds.length === 0) {
    warnings.push("当前页未拆出可复用结构，将整页保留为高保真图片。");
  }

  const metrics = calcMetrics(seeds, groups, pageArea);
  let pageMode: EditablePptPageMode = "hybrid";
  if (textSeeds.length > 0 && visualSeeds.length === 0) pageMode = "ocr";
  if (textSeeds.length === 0) pageMode = "raster_fallback";
  const parseConfidence = textSeeds.length > 0
    ? Math.round(average(textSeeds.map((seed) => seed.confidence)))
    : 24;

  let parseStatus: EditablePptPageStatus = "ready";
  if (
    metrics.editableScore < 35
    || metrics.unknownNodeRatio >= 80
    || (metrics.rasterNodes > 0 && metrics.layoutRecoveryScore < 40)
  ) {
    parseStatus = "needs_review";
  } else if (metrics.editableScore < 65 || metrics.unknownNodeRatio >= 55) {
    parseStatus = "partial_ready";
  }

  let finalSeeds = seeds;
  if (finalSeeds.length === 0) {
    finalSeeds = [{
      elementType: "chart_or_complex",
      bboxX: 0,
      bboxY: 0,
      bboxW: width,
      bboxH: height,
      zIndex: 1,
      rotation: 0,
      opacity: 100,
      confidence: 18,
      textContent: null,
      style: {},
      assetKey: null,
      assetUrl: null,
      sourceRef: "full-page-fallback",
      nodeRole: "background",
      exportMode: "raster",
      originStage: "fallback",
    }];
  }

  return {
    pageMode,
    parseStatus,
    parseConfidence,
    editableScore: metrics.editableScore,
    textRecoveryScore: metrics.textRecoveryScore,
    layoutRecoveryScore: metrics.layoutRecoveryScore,
    unknownNodeRatio: metrics.unknownNodeRatio,
    metrics,
    warnings: uniqueWarnings(warnings),
    structure: buildStructureFromSeeds("image", pageMode, metrics, uniqueWarnings(warnings), finalSeeds),
    seeds: finalSeeds,
  };
}

function buildMetricsFromSeeds(
  seeds: ImportedElementSeed[],
  width: number,
  height: number,
) {
  const fakeGroups: ParagraphGroup[] = seeds
    .filter((seed) => seed.elementType === "text" && seed.textContent)
    .map((seed) => ({
      id: seed.id || randomUUID(),
      lines: [{
        text: seed.textContent || "",
        confidence: seed.confidence / 100,
        bbox: [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH],
      }],
      bbox: [seed.bboxX, seed.bboxY, seed.bboxW, seed.bboxH],
      text: seed.textContent || "",
      avgConfidence: seed.confidence / 100,
      avgLineHeight: seed.bboxH,
      align: ((seed.style.align as "left" | "center" | "right" | undefined) || "left"),
      role: seed.nodeRole || "body",
    }));
  return calcMetrics(seeds, fakeGroups, Math.max(1, width * height));
}

function buildNativeAnalysis(
  sourceKind: "pptx" | "pdf" | "image",
  pageMode: EditablePptPageMode,
  seeds: ImportedElementSeed[],
  width: number,
  height: number,
  extraWarnings: string[] = [],
): ImportedPageAnalysis {
  const metrics = buildMetricsFromSeeds(seeds, width, height);
  const warnings = uniqueWarnings(extraWarnings);
  let parseStatus: EditablePptPageStatus = "ready";
  if (metrics.editableScore < 35) parseStatus = "needs_review";
  else if (metrics.editableScore < 65) parseStatus = "partial_ready";
  const parseConfidence = seeds.length > 0 ? Math.round(average(seeds.map((seed) => seed.confidence))) : 20;
  return {
    pageMode,
    parseStatus,
    parseConfidence,
    editableScore: metrics.editableScore,
    textRecoveryScore: metrics.textRecoveryScore,
    layoutRecoveryScore: metrics.layoutRecoveryScore,
    unknownNodeRatio: metrics.unknownNodeRatio,
    metrics,
    warnings,
    structure: buildStructureFromSeeds(sourceKind, pageMode, metrics, warnings, seeds),
    seeds,
  };
}

function buildStructureRootForPage(
  pageId: string,
  pageNumber: number,
  width: number,
  height: number,
  analysis: ImportedPageAnalysis,
) {
  return {
    ...analysis.structure,
    pageId,
    pageNumber,
    width,
    height,
  } satisfies EditablePptStructureRoot;
}

async function buildPageFromImageBuffer(
  buffer: Buffer,
  fileName: string,
  pageNumber: number,
  totalPages: number,
  sourceText: string,
  config: EditablePptConfig,
  presetAnalysis?: ImportedPageAnalysis,
): Promise<ImportedImagePage> {
  const ext = path.extname(fileName).toLowerCase() || `.${extFromMime("image/jpeg")}`;
  const safeName = cleanName(fileName || `slide_${pageNumber}${ext}`);
  const saved = saveBinaryFile(buffer, `editable_ppt_${String(pageNumber).padStart(3, "0")}_${safeName}`, contentTypeFromExt(ext));
  const meta = await imageMeta(buffer);
  const title = `第 ${pageNumber} 页`;
  const ocrLines = await runVisionOcr(resolveLocalFilePath(saved.key));
  const ocrText = ocrLines.map((line) => line.text).join("\n").trim() || sourceText || "";
  const analysis = presetAnalysis || await analyzeImagePage(buffer, meta.width, meta.height, ocrLines, sourceText, config, pageNumber);
  const preview = await drawPreview(buffer, meta.width, meta.height, analysis.seeds);

  return {
    pageNumber,
    title,
    role: inferRole(pageNumber, totalPages, title),
    width: meta.width,
    height: meta.height,
    sourceImageKey: saved.key,
    sourceImageUrl: saved.url,
    fileName,
    sourceText,
    ocrText,
    ocrLines,
    previewImageKey: preview?.key || null,
    previewImageUrl: preview?.url || null,
    cleanedBackgroundKey: null,
    cleanedBackgroundUrl: null,
    analysis,
  };
}

function buildElementsFromSeeds(
  jobId: string,
  pageId: string,
  seeds: ImportedElementSeed[],
) {
  const now = nowIso();
  return seeds.map<EditablePptElementRecord>((seed, index) => ({
    id: seed.id || randomUUID(),
    job_id: jobId,
    page_id: pageId,
    element_type: seed.elementType,
    bbox_x: Math.round(seed.bboxX),
    bbox_y: Math.round(seed.bboxY),
    bbox_w: Math.round(seed.bboxW),
    bbox_h: Math.round(seed.bboxH),
    z_index: seed.zIndex || (100 + index),
    rotation: seed.rotation || 0,
    opacity: seed.opacity ?? 100,
    group_id: seed.groupId || null,
    parent_id: seed.parentId || null,
    confidence: seed.confidence ?? 90,
    text_content: seed.textContent,
    style_json: JSON.stringify(seed.style || {}),
    asset_url: seed.assetUrl,
    asset_key: seed.assetKey,
    hidden: Boolean(seed.hidden),
    locked: Boolean(seed.locked),
    source_ref: seed.sourceRef,
    node_role: seed.nodeRole || "unknown",
    export_mode: seed.exportMode || "editable",
    origin_stage: seed.originStage || "region",
    created_at: now,
    updated_at: now,
  }));
}

async function importImageFiles(
  files: File[],
  config: EditablePptConfig,
  sourceTexts: string[] = [],
): Promise<{ pages: ImportedImagePage[]; warnings: string[] }> {
  const sorted = [...files].sort((a, b) => naturalSort(a.name, b.name));
  const pages: ImportedImagePage[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const file = sorted[index];
    const buffer = Buffer.from(await file.arrayBuffer());
    pages.push(await buildPageFromImageBuffer(buffer, file.name, index + 1, sorted.length, sourceTexts[index] || "", config));
  }
  return { pages, warnings: [] };
}

async function importImageZip(file: File, config: EditablePptConfig): Promise<{ pages: ImportedImagePage[]; warnings: string[] }> {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => naturalSort(a.name, b.name));
  const pages: ImportedImagePage[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const buffer = await entry.async("nodebuffer");
    pages.push(await buildPageFromImageBuffer(buffer, path.basename(entry.name), index + 1, entries.length, "", config));
  }
  return {
    pages,
    warnings: entries.length === 0 ? ["压缩包里没有找到图片文件，请确认包含 PNG/JPG/WebP 等页面图。"] : [],
  };
}

async function importPptx(file: File, config: EditablePptConfig): Promise<{ pages: ImportedImagePage[]; warnings: string[]; sourceType: EditablePptSourceType }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("text");
  const slideSize = parsePptxSlideSize(presentationXml || "");
  const slideEntries = Object.values(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => {
      const an = Number(a.name.match(/slide(\d+)\.xml/)?.[1] || 0);
      const bn = Number(b.name.match(/slide(\d+)\.xml/)?.[1] || 0);
      return an - bn;
    });

  const sourceTexts: string[] = [];
  for (const entry of slideEntries) {
    sourceTexts.push(readTextFromSlideXml(await entry.async("text")));
  }

  const converted = await convertPptxToImages(buffer, file.name, slideEntries.length);
  const pages: ImportedImagePage[] = [];
  for (let index = 0; index < converted.imageBuffers.length; index += 1) {
    const slideEntry = slideEntries[index];
    const slideXml = slideEntry ? await slideEntry.async("text") : "";
    const relPath = slideEntry
      ? `ppt/slides/_rels/${path.basename(slideEntry.name)}.rels`
      : null;
    const relXml = relPath ? await zip.file(relPath)?.async("text") || null : null;
    const probeMeta = await imageMeta(converted.imageBuffers[index]);
    const parsed = slideEntry
      ? await parsePptxSlideSeeds(
        zip,
        slideEntry.name,
        slideXml,
        relXml,
        slideSize.width,
        slideSize.height,
        probeMeta.width,
        probeMeta.height,
        index + 1,
      )
      : { textSeeds: [], imageSeeds: [], shapeSeeds: [] };
    const nativeSeeds = [...parsed.shapeSeeds, ...parsed.imageSeeds, ...parsed.textSeeds].sort((a, b) => a.zIndex - b.zIndex);
    const nativeAnalysis = buildNativeAnalysis(
      "pptx",
      nativeSeeds.some((seed) => seed.elementType === "image") ? "hybrid" : "native",
      nativeSeeds,
      probeMeta.width,
      probeMeta.height,
      converted.warnings,
    );
    pages.push(await buildPageFromImageBuffer(
      converted.imageBuffers[index],
      `slide-${String(index + 1).padStart(3, "0")}.png`,
      index + 1,
      Math.max(converted.imageBuffers.length, sourceTexts.length),
      sourceTexts[index] || "",
      config,
      nativeAnalysis,
    ));
  }

  for (let index = converted.imageBuffers.length; index < sourceTexts.length; index += 1) {
    const text = sourceTexts[index] || "";
    const emptyImage = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: "#ffffff",
      },
    }).png().toBuffer();
    const textOnlyAnalysis = buildNativeAnalysis("pptx", "native", [{
      elementType: "text",
      bboxX: 120,
      bboxY: 120,
      bboxW: 1680,
      bboxH: 860,
      zIndex: 100,
      rotation: 0,
      opacity: 100,
      confidence: 70,
      textContent: text,
      style: {
        fontSize: 24,
        fontFamily: "Microsoft YaHei",
        color: "#111111",
        align: "left",
        lineHeight: 1.22,
      },
      assetKey: null,
      assetUrl: null,
      sourceRef: "pptx-text-fallback",
      nodeRole: "body",
      exportMode: "editable",
      originStage: "fallback",
    }], 1920, 1080, ["未能渲染原始页面图片，当前页仅按提取到的文字重建。"]);
    pages.push(await buildPageFromImageBuffer(emptyImage, `fallback-${index + 1}.png`, index + 1, sourceTexts.length, text, config, textOnlyAnalysis));
  }

  return { pages, warnings: converted.warnings, sourceType: "pptx" };
}

async function importPdf(file: File, config: EditablePptConfig): Promise<{ pages: ImportedImagePage[]; warnings: string[]; sourceType: EditablePptSourceType }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const converted = await convertPdfToImages(buffer, file.name);
  const pages: ImportedImagePage[] = [];
  for (let index = 0; index < converted.imageBuffers.length; index += 1) {
    pages.push(await buildPageFromImageBuffer(
      converted.imageBuffers[index],
      `pdf-${String(index + 1).padStart(3, "0")}.png`,
      index + 1,
      converted.imageBuffers.length,
      "",
      config,
    ));
  }
  return { pages, warnings: converted.warnings, sourceType: "pdf" };
}

function summarizeJobFromPages(pages: EditablePptPageRecord[], elements: EditablePptElementRecord[], userId: string | null) {
  const textBlocks = elements.filter((element) => element.element_type === "text").length;
  const rasterBlocks = elements.filter((element) => element.export_mode === "raster").length;
  const shapeBlocks = elements.filter((element) => element.element_type === "shape").length;
  const scores = pages.map((page) => page.editable_score || 0);
  const averageEditableScore = Math.round(average(scores));

  return {
    textBlocks,
    rasterBlocks,
    shapeBlocks,
    importedAt: nowIso(),
    averageEditableScore,
    localOnly: true,
    userId,
  };
}

export async function importEditablePptFiles(
  userId: string | null,
  projectId: string | null,
  inputName: string,
  files: File[],
  config?: Partial<EditablePptConfig>,
): Promise<ImportedEditablePptPayload> {
  if (files.length === 0) {
    throw new Error("请上传 PPTX、PDF、图片包或页面图片");
  }
  if (files.length > 100) {
    throw new Error("单套项目最多支持 100 页");
  }

  const mergedConfig: EditablePptConfig = { ...DEFAULT_EDITABLE_PPT_CONFIG, ...(config || {}) };
  const first = files[0];
  const firstExt = path.extname(first.name).toLowerCase();
  let sourceType: EditablePptSourceType = "images";
  let importedPages: ImportedImagePage[] = [];
  let warnings: string[] = [];

  const sourceSaved = files.length === 1
    ? saveBinaryFile(Buffer.from(await first.arrayBuffer()), `editable_source_${cleanName(first.name)}`, first.type || undefined)
    : null;

  if (files.length > 1) {
    const imageFiles = files.filter((file) => IMAGE_EXTS.has(path.extname(file.name).toLowerCase()) || file.type.startsWith("image/"));
    if (imageFiles.length !== files.length) {
      throw new Error("多文件上传时请只选择页面图片");
    }
    const result = await importImageFiles(imageFiles, mergedConfig);
    importedPages = result.pages;
    warnings = result.warnings;
    sourceType = "images";
  } else if (firstExt === ".zip") {
    const result = await importImageZip(first, mergedConfig);
    importedPages = result.pages;
    warnings = result.warnings;
    sourceType = "image_zip";
  } else if (firstExt === ".ppt") {
    throw new Error("暂不支持旧版 .ppt 文件，请先另存为 .pptx 或导出为图片包。");
  } else if (firstExt === ".pptx" || PPTX_CONTENT_TYPES.has(first.type)) {
    const result = await importPptx(first, mergedConfig);
    importedPages = result.pages;
    warnings = result.warnings;
    sourceType = result.sourceType;
  } else if (firstExt === ".pdf" || first.type === "application/pdf") {
    const result = await importPdf(first, mergedConfig);
    importedPages = result.pages;
    warnings = result.warnings;
    sourceType = result.sourceType;
  } else if (IMAGE_EXTS.has(firstExt) || first.type.startsWith("image/")) {
    const result = await importImageFiles([first], mergedConfig);
    importedPages = result.pages;
    warnings = result.warnings;
    sourceType = "images";
  } else {
    throw new Error("暂只支持 PPTX、PDF、ZIP 图片包、PNG/JPG/WebP 等图片");
  }

  if (importedPages.length === 0) {
    throw new Error(warnings[0] || "没有可导入的页面");
  }

  const jobId = randomUUID();
  const now = nowIso();
  const pages: EditablePptPageRecord[] = [];
  const elements: EditablePptElementRecord[] = [];
  const guessedAspect = aspectRatioGuess(importedPages[0].width, importedPages[0].height);

  for (const importedPage of importedPages.slice(0, 100)) {
    const pageId = randomUUID();
    const pageElements = buildElementsFromSeeds(jobId, pageId, importedPage.analysis.seeds);
    const structureRoot = buildStructureRootForPage(
      pageId,
      importedPage.pageNumber,
      importedPage.width,
      importedPage.height,
      importedPage.analysis,
    );

    const pageRecord: EditablePptPageRecord = {
      id: pageId,
      job_id: jobId,
      page_number: importedPage.pageNumber,
      title: importedPage.title,
      role: importedPage.role,
      source_image_url: importedPage.sourceImageUrl,
      source_image_key: importedPage.sourceImageKey,
      preview_image_url: importedPage.previewImageUrl,
      preview_image_key: importedPage.previewImageKey,
      cleaned_background_url: importedPage.cleanedBackgroundUrl,
      cleaned_background_key: importedPage.cleanedBackgroundKey,
      width: importedPage.width,
      height: importedPage.height,
      parse_status: importedPage.analysis.parseStatus,
      page_mode: importedPage.analysis.pageMode,
      parse_confidence: importedPage.analysis.parseConfidence,
      editable_score: importedPage.analysis.editableScore,
      text_recovery_score: importedPage.analysis.textRecoveryScore,
      layout_recovery_score: importedPage.analysis.layoutRecoveryScore,
      unknown_node_ratio: importedPage.analysis.unknownNodeRatio,
      ocr_text: importedPage.ocrText,
      normalized_text: normalizeTextForCheck(importedPage.ocrText || importedPage.sourceText || ""),
      structure_json: JSON.stringify(structureRoot),
      metrics_json: JSON.stringify(importedPage.analysis.metrics),
      warnings_json: JSON.stringify(importedPage.analysis.warnings),
      ast: "",
      elements_count: pageElements.length,
      manual_notes: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    };
    pageRecord.ast = JSON.stringify(buildPageAst(pageRecord, pageElements));
    pages.push(pageRecord);
    elements.push(...pageElements);
  }

  return {
    sourceType,
    sourceName: inputName || first.name,
    sourceKey: sourceSaved?.key || null,
    sourceUrl: sourceSaved?.url || null,
    pageCount: pages.length,
    warnings: uniqueWarnings([...warnings, ...pages.flatMap((page) => JSON.parse(page.warnings_json || "[]") as string[])]),
    aspectRatioGuess: guessedAspect,
    pages,
    elements,
  };
}

export function buildEditablePptJobPayload(
  userId: string | null,
  projectId: string | null,
  name: string,
  imported: ImportedEditablePptPayload,
  config: EditablePptConfig = DEFAULT_EDITABLE_PPT_CONFIG,
): Omit<EditablePptJobRecord, "id" | "user_id" | "created_at" | "updated_at" | "completed_at" | "failed_at"> {
  const summary = summarizeJobFromPages(imported.pages, imported.elements, userId);
  const averageEditableScore = summary.averageEditableScore;
  const hasNeedsReview = imported.pages.some((page) => page.parse_status === "needs_review");
  const hasPartial = imported.pages.some((page) => page.parse_status === "partial_ready");

  let status: EditablePptJobRecord["status"] = "ready";
  if (averageEditableScore >= 75 && !hasNeedsReview) status = "editable_ready";
  else if (hasNeedsReview) status = "needs_review";
  else if (hasPartial || averageEditableScore < 75) status = "partial_ready";

  return {
    project_id: projectId,
    name,
    source_type: imported.sourceType,
    source_name: imported.sourceName,
    source_key: imported.sourceKey,
    source_url: imported.sourceUrl,
    page_count: imported.pageCount,
    parsed_count: imported.pages.length,
    failed_page_count: imported.pages.filter((page) => page.parse_status === "failed").length,
    status,
    progress: 100,
    aspect_ratio_guess: imported.aspectRatioGuess,
    cover_image_url: imported.pages[0]?.source_image_url || null,
    cover_image_key: imported.pages[0]?.source_image_key || null,
    warnings: JSON.stringify(imported.warnings),
    config: JSON.stringify(config),
    summary: JSON.stringify(summary),
  };
}
