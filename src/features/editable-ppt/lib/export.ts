import fs from "node:fs";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import { resolveLocalFilePath, saveBinaryFile } from "@/lib/local-backend";
import { parseStructureRoot, safeJsonParse } from "./ast";
import { inferPageExportMode, shouldIncludeElementInExport, type EditablePptPageExportMode } from "./export-rules";
import type { EditablePptElementRecord, EditablePptPageRecord } from "./types";

function safeName(name: string) {
  return (name || "Editable-PPT")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function ratioToLayout(aspectRatio: string | null | undefined) {
  const [wRaw, hRaw] = String(aspectRatio || "16:9").split(":").map((value) => Number(value));
  const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 16;
  const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 9;
  const baseWidth = 13.333;
  return { name: "CUSTOM_LAYOUT", width: baseWidth, height: baseWidth * (h / w) };
}

function pxToInches(value: number, totalPx: number, totalInches: number) {
  if (!totalPx) return 0;
  return (value / totalPx) * totalInches;
}

function buildImageDataUrl(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp"
      ? "image/webp"
      : "image/png";
  return `data:${mime};base64,${Buffer.from(fs.readFileSync(filePath)).toString("base64")}`;
}

function resolveOptionalLocalPath(key: string | null | undefined) {
  if (!key) return null;
  try {
    const filePath = resolveLocalFilePath(key);
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

function toHexColor(value: unknown, fallback = "F3F4F6") {
  const raw = String(value || "").trim();
  const hex = raw.replace("#", "");
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : fallback;
}

function lineSpacingMultiple(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1.2;
  return Math.max(0.8, Math.min(2, num));
}

function resolveShapeType(shapeType: unknown) {
  const raw = String(shapeType || "rect");
  const allowed = new Set([
    "rect",
    "roundRect",
    "ellipse",
    "line",
    "arc",
    "triangle",
    "diamond",
    "chevron",
  ]);
  return allowed.has(raw) ? raw : "rect";
}

function addFullSlideImage(
  slide: PptxGenJS.Slide,
  layout: { width: number; height: number },
  filePath: string,
) {
  slide.addImage({
    data: buildImageDataUrl(filePath),
    x: 0,
    y: 0,
    w: layout.width,
    h: layout.height,
  });
}

function addBackground(
  slide: PptxGenJS.Slide,
  page: EditablePptPageRecord,
  layout: { width: number; height: number },
  mode: EditablePptPageExportMode,
) {
  if (mode === "raster") {
    const full = resolveOptionalLocalPath(page.source_image_key);
    if (full) addFullSlideImage(slide, layout, full);
    return;
  }

  const structure = parseStructureRoot(page);
  const backgroundNode = structure?.children.find((node) => node.role === "background");
  if (backgroundNode) {
    if (backgroundNode.assetKey) {
      const bgPath = resolveOptionalLocalPath(backgroundNode.assetKey);
      if (bgPath) {
        addFullSlideImage(slide, layout, bgPath);
        return;
      }
    }

    const bgStyle = (backgroundNode.style || {}) as Record<string, unknown>;
    const bgFill = String(bgStyle.fill || "").trim();
    if (bgFill) {
      slide.background = { color: toHexColor(bgFill, "FFFFFF") };
      return;
    }
  }

  slide.background = { color: "FFFFFF" };
}

function addShapeElement(
  slide: PptxGenJS.Slide,
  page: EditablePptPageRecord,
  layout: { width: number; height: number },
  element: EditablePptElementRecord,
) {
  const style = safeJsonParse<Record<string, unknown>>(element.style_json, {});
  const shapeType = resolveShapeType(style.shapeType);
  const fillColor = typeof style.fill === "string" ? style.fill : null;
  const strokeColor = typeof style.stroke === "string" ? style.stroke : null;
  const hasFill = Boolean(fillColor) && Number(style.transparency ?? 100) < 100;
  const hasStroke = Boolean(strokeColor) && Number(style.strokeTransparency ?? 100) < 100 && Number(style.strokeWidth ?? 0) > 0;
  slide.addShape(shapeType as never, {
    x: pxToInches(element.bbox_x, page.width, layout.width),
    y: pxToInches(element.bbox_y, page.height, layout.height),
    w: pxToInches(element.bbox_w, page.width, layout.width),
    h: pxToInches(element.bbox_h, page.height, layout.height),
    fill: {
      color: toHexColor(fillColor, "F5F6F8"),
      transparency: hasFill ? Number(style.transparency || 0) : 100,
    },
    line: {
      color: toHexColor(strokeColor, toHexColor(fillColor, "F5F6F8")),
      transparency: hasStroke ? Number(style.strokeTransparency || 0) : 100,
      width: Number(style.strokeWidth || 0),
    },
    rectRadius: Number(style.radiusRatio || 0.12),
    rotate: Number(style.rotation || element.rotation || 0),
  });
}

function addRasterElement(
  slide: PptxGenJS.Slide,
  page: EditablePptPageRecord,
  layout: { width: number; height: number },
  element: EditablePptElementRecord,
) {
  const assetPath = resolveOptionalLocalPath(element.asset_key);
  if (!assetPath) return;
  slide.addImage({
    data: buildImageDataUrl(assetPath),
    x: pxToInches(element.bbox_x, page.width, layout.width),
    y: pxToInches(element.bbox_y, page.height, layout.height),
    w: pxToInches(element.bbox_w, page.width, layout.width),
    h: pxToInches(element.bbox_h, page.height, layout.height),
    transparency: Math.max(0, 100 - Math.round(element.opacity || 100)),
  });
}

function addTextElement(
  slide: PptxGenJS.Slide,
  page: EditablePptPageRecord,
  layout: { width: number; height: number },
  element: EditablePptElementRecord,
) {
  if (!element.text_content?.trim()) return;
  const style = safeJsonParse<Record<string, unknown>>(element.style_json, {});
  const fontSize = Number(style.fontSize || 18);
  const fontColor = toHexColor(style.color, "111111");
  const isBold = Boolean(style.fontWeight && Number(style.fontWeight) >= 600) || element.node_role === "title";
  const align = (style.align as "left" | "center" | "right" | undefined) || "left";
  slide.addText(element.text_content, {
    x: pxToInches(element.bbox_x, page.width, layout.width),
    y: pxToInches(element.bbox_y, page.height, layout.height),
    w: pxToInches(element.bbox_w, page.width, layout.width),
    h: pxToInches(element.bbox_h, page.height, layout.height),
    fontFace: String(style.fontFamily || "Microsoft YaHei"),
    fontSize,
    color: fontColor,
    margin: 0,
    bold: isBold,
    valign: "top",
    align,
    fit: "shrink",
    paraSpaceAfter: 0,
    transparency: 0,
    lineSpacingMultiple: lineSpacingMultiple(style.lineHeight),
  });
}

function filterElementsForMode(
  elements: EditablePptElementRecord[],
  mode: EditablePptPageExportMode,
) {
  return elements.filter((element) => shouldIncludeElementInExport(element, mode));
}

export async function exportEditablePptDeck(
  input: {
    projectName: string;
    aspectRatio?: string | null;
    pages: EditablePptPageRecord[];
    elementsByPage: Record<string, EditablePptElementRecord[]>;
  },
) {
  const pptx = new PptxGenJS();
  const layout = ratioToLayout(input.aspectRatio || "16:9");
  pptx.author = "环中AIStudio";
  pptx.subject = `${input.projectName} 可编辑PPT`;
  pptx.title = input.projectName;
  pptx.defineLayout(layout);
  pptx.layout = layout.name;

  for (const page of input.pages.sort((a, b) => a.page_number - b.page_number)) {
    const slide = pptx.addSlide();
    const allElements = (input.elementsByPage[page.id] || []).slice().sort((a, b) => a.z_index - b.z_index);
    const mode = inferPageExportMode(page);
    addBackground(slide, page, layout, mode);

    const elements = filterElementsForMode(allElements, mode);
    for (const element of elements) {
      if (element.hidden) continue;
      if (element.node_role === "background") continue;
      if (element.element_type === "shape" && element.export_mode === "editable") {
        addShapeElement(slide, page, layout, element);
        continue;
      }

      if (element.asset_key && (element.export_mode === "raster" || ["image", "icon", "chart_or_complex", "table"].includes(element.element_type))) {
        addRasterElement(slide, page, layout, element);
        continue;
      }

      if (element.element_type === "text") {
        addTextElement(slide, page, layout, element);
      }
    }

    if (mode === "raster" && allElements.length === 0) {
      const full = resolveOptionalLocalPath(page.source_image_key);
      if (full) addFullSlideImage(slide, layout, full);
    }
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  return saveBinaryFile(buffer, `${safeName(input.projectName)}_editable.pptx`, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
}
