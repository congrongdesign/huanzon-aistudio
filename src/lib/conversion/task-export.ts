import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import JSZip from "jszip";
import { resolveLocalFilePath } from "@/lib/local-backend";
import type { ConversionTaskRecord } from "./types";

export type ConversionPackageAsset = {
  label: string;
  originalUrl?: string | null;
  fileName?: string;
  contentType?: string;
  skipped?: boolean;
  error?: string;
};

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function safeConversionFileName(value: string, fallback: string) {
  return (value || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || fallback;
}

export function extFromUrl(url: string, fallback = "bin") {
  try {
    const parsed = new URL(url, "http://local.invalid");
    const ext = path.extname(parsed.pathname).replace(/^\./, "").toLowerCase();
    return ext && ext.length <= 8 ? ext : fallback;
  } catch {
    const ext = path.extname(url.split("?")[0]).replace(/^\./, "").toLowerCase();
    return ext && ext.length <= 8 ? ext : fallback;
  }
}

export function extFromContentType(contentType?: string | null, fallback = "bin") {
  if (!contentType) return fallback;
  return EXT_BY_CONTENT_TYPE[contentType.split(";")[0].trim().toLowerCase()] || fallback;
}

function resolveFetchUrl(request: NextRequest, value: string) {
  try {
    const url = new URL(value, request.nextUrl.origin);
    const host = url.hostname.toLowerCase();
    const isRelative = value.startsWith("/");
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);
    if (isRelative || (url.protocol === "http:" && isLocalHost)) {
      return new URL(`${url.pathname}${url.search}`, request.nextUrl.origin);
    }
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export async function readConversionUrlAsset(request: NextRequest, url: string): Promise<{ buffer: Buffer; contentType?: string; ext: string }> {
  if (url.startsWith("/api/local-file/")) {
    const key = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "");
    const filePath = resolveLocalFilePath(key);
    if (!fs.existsSync(filePath)) throw new Error("本地文件不存在");
    const ext = path.extname(filePath).replace(/^\./, "") || extFromUrl(url);
    return { buffer: fs.readFileSync(filePath), ext };
  }

  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) throw new Error("Data URL 无效");
    const contentType = match[1] || "application/octet-stream";
    const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
    return { buffer, contentType, ext: extFromContentType(contentType) };
  }

  const resolved = resolveFetchUrl(request, url);
  if (!resolved) throw new Error("文件地址无效");
  const response = await fetch(resolved, { cache: "no-store", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`读取失败 (${response.status})`);
  const contentType = response.headers.get("content-type") || undefined;
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    ext: extFromContentType(contentType, extFromUrl(url)),
  };
}

function readPreparedPdf(task: ConversionTaskRecord) {
  if (!task.prepared_pdf_key) return null;
  const filePath = resolveLocalFilePath(task.prepared_pdf_key);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function taskReadme(task: ConversionTaskRecord) {
  return [
    "环中AIStudio 转换任务包",
    "",
    `任务名称：${task.source_name}`,
    `任务状态：${task.status}`,
    `页数：${task.page_count || task.source_files.length}`,
    `创建时间：${task.created_at}`,
    `更新时间：${task.updated_at || "-"}`,
    "",
    "目录说明：",
    "- manifest.json：任务元数据、源文件信息、Codia 任务信息。",
    "- sources/：可读取到的源图片。",
    "- intermediate/：提交给 Codia 的中间 PDF。",
    "- result/：Codia 返回的 PPTX/结果文件（如果已完成且可下载）。",
  ].join("\n");
}

function normalizeBaseDir(baseDir = "") {
  const cleaned = baseDir.replace(/^\/+/, "").replace(/\/+$/, "");
  return cleaned ? `${cleaned}/` : "";
}

export async function addConversionTaskPackageToZip(zip: JSZip, request: NextRequest, task: ConversionTaskRecord, baseDir = "") {
  const dir = normalizeBaseDir(baseDir);
  const assets: ConversionPackageAsset[] = [];
  const taskName = safeConversionFileName(task.source_name, "转换任务");

  zip.file(`${dir}README.txt`, taskReadme(task));

  const preparedPdf = readPreparedPdf(task);
  if (preparedPdf) {
    const fileName = `${dir}intermediate/${taskName}.pdf`;
    zip.file(fileName, preparedPdf);
    assets.push({ label: "prepared_pdf", originalUrl: task.prepared_pdf_url, fileName, contentType: "application/pdf" });
  } else if (task.prepared_pdf_url) {
    try {
      const asset = await readConversionUrlAsset(request, task.prepared_pdf_url);
      const fileName = `${dir}intermediate/${taskName}.pdf`;
      zip.file(fileName, asset.buffer);
      assets.push({ label: "prepared_pdf", originalUrl: task.prepared_pdf_url, fileName, contentType: asset.contentType || "application/pdf" });
    } catch (error) {
      assets.push({ label: "prepared_pdf", originalUrl: task.prepared_pdf_url, skipped: true, error: error instanceof Error ? error.message : "读取失败" });
    }
  }

  if (task.ppt_url) {
    try {
      const asset = await readConversionUrlAsset(request, task.ppt_url);
      const ext = asset.ext === "bin" ? "pptx" : asset.ext;
      const fileName = `${dir}result/${taskName}.${ext}`;
      zip.file(fileName, asset.buffer);
      assets.push({ label: "ppt_result", originalUrl: task.ppt_url, fileName, contentType: asset.contentType });
    } catch (error) {
      assets.push({ label: "ppt_result", originalUrl: task.ppt_url, skipped: true, error: error instanceof Error ? error.message : "读取失败" });
    }
  }

  for (let index = 0; index < task.source_files.length; index += 1) {
    const source = task.source_files[index];
    const url = source.source_url || source.thumbnail_url;
    if (!url) continue;
    try {
      const asset = await readConversionUrlAsset(request, url);
      const baseName = safeConversionFileName(source.name.replace(/\.[a-z0-9]+$/i, ""), `source-${index + 1}`);
      const fileName = `${dir}sources/${String(index + 1).padStart(3, "0")}-${baseName}.${asset.ext || extFromUrl(url, "png")}`;
      zip.file(fileName, asset.buffer);
      assets.push({ label: `source_${index + 1}`, originalUrl: url, fileName, contentType: asset.contentType || source.type });
    } catch (error) {
      assets.push({ label: `source_${index + 1}`, originalUrl: url, skipped: true, error: error instanceof Error ? error.message : "读取失败" });
    }
  }

  zip.file(`${dir}manifest.json`, JSON.stringify({
    format: "huanzon-aistudio-conversion-task",
    version: 1,
    exportedAt: new Date().toISOString(),
    task,
    assets,
  }, null, 2));

  return assets;
}

export async function addConversionTaskPptxToZip(zip: JSZip, request: NextRequest, task: ConversionTaskRecord, fileNamePrefix = "") {
  if (!task.ppt_url) {
    return { label: "ppt_result", originalUrl: task.ppt_url, skipped: true, error: "没有可下载的 PPTX 地址" } satisfies ConversionPackageAsset;
  }

  const taskName = safeConversionFileName(task.source_name, "转换结果");
  const asset = await readConversionUrlAsset(request, task.ppt_url);
  const ext = asset.ext === "bin" ? "pptx" : asset.ext;
  const fileName = `pptx/${fileNamePrefix}${taskName}.${ext}`;
  zip.file(fileName, asset.buffer);
  return { label: "ppt_result", originalUrl: task.ppt_url, fileName, contentType: asset.contentType } satisfies ConversionPackageAsset;
}
