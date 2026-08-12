import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";

interface ExportSlide {
  pageNumber: number;
  title?: string;
  imageUrl: string;
}

function safeName(name: string): string {
  return (name || "AI-PPT")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function fileExtFromContentType(contentType: string, url: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  const parsed = path.extname(url.split("?")[0]).replace(/^\./, "").toLowerCase();
  return parsed || "png";
}

function absoluteUrl(request: NextRequest, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, request.url).toString();
}

async function fetchImage(request: NextRequest, slide: ExportSlide): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const res = await fetch(absoluteUrl(request, slide.imageUrl), {
    headers: {
      cookie: request.headers.get("cookie") || "",
      authorization: request.headers.get("authorization") || "",
    },
  });
  if (!res.ok) throw new Error(`第 ${slide.pageNumber} 页图片读取失败`);
  const contentType = res.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType, ext: fileExtFromContentType(contentType, slide.imageUrl) };
}

function ratioToLayout(aspectRatio: string): { name: string; width: number; height: number } {
  const [wRaw, hRaw] = aspectRatio.split(":").map((v) => Number(v));
  const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 16;
  const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 9;
  const baseWidth = 13.333;
  return { name: "CUSTOM_LAYOUT", width: baseWidth, height: baseWidth * (h / w) };
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const body = await request.json();
    const type = String(body.type || "zip") as "zip" | "pptx";
    const projectName = safeName(String(body.projectName || "AI-PPT美化版"));
    const aspectRatio = String(body.aspectRatio || "16:9");
    const slides = Array.isArray(body.slides) ? (body.slides as ExportSlide[]) : [];

    const validSlides = slides
      .filter((slide) => slide && slide.imageUrl)
      .sort((a, b) => Number(a.pageNumber || 0) - Number(b.pageNumber || 0));

    if (validSlides.length === 0) {
      const normalized = normalizeOperationError({ message: "没有可导出的已审核页面", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const assets: Array<{ slide: ExportSlide; buffer: Buffer; contentType: string; ext: string }> = [];
    for (const slide of validSlides) {
      assets.push({ slide, ...(await fetchImage(request, slide)) });
    }

    if (type === "pptx") {
      const pptx = new PptxGenJS();
      pptx.author = "环中AIStudio";
      pptx.subject = `${projectName} 高清图片版 PPT`;
      pptx.title = projectName;
      const layout = ratioToLayout(aspectRatio);
      pptx.defineLayout(layout);
      pptx.layout = layout.name;

      for (const asset of assets) {
        const slide = pptx.addSlide();
        const data = `data:${asset.contentType};base64,${asset.buffer.toString("base64")}`;
        slide.background = { color: "FFFFFF" };
        slide.addImage({ data, x: 0, y: 0, w: layout.width, h: layout.height });
      }

      const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
      return new NextResponse(new Uint8Array(pptxBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${projectName}_高清图片版.pptx`)}`,
        },
      });
    }

    const zip = new JSZip();
    for (const asset of assets) {
      const page = String(asset.slide.pageNumber).padStart(3, "0");
      const title = safeName(asset.slide.title || `第${asset.slide.pageNumber}页`).slice(0, 40);
      zip.file(`${page}_${title}.${asset.ext}`, asset.buffer);
    }
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${projectName}_高清图片包.zip`)}`,
      },
    });
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "导出失败",
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
