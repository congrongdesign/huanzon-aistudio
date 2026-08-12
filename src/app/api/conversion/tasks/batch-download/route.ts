import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getCurrentUserId } from "@/lib/auth";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { syncConversionTaskFromCodia } from "@/lib/conversion/codia-task";
import { getConversionTask } from "@/lib/conversion/store";
import {
  addConversionTaskPackageToZip,
  addConversionTaskPptxToZip,
  safeConversionFileName,
  type ConversionPackageAsset,
} from "@/lib/conversion/task-export";
import type { ConversionTaskRecord } from "@/lib/conversion/types";

export const runtime = "nodejs";

type BatchMode = "pptx" | "package";

type BatchItem = {
  id: string;
  name?: string;
  status: "included" | "skipped";
  reason?: string;
  assets?: ConversionPackageAsset[];
};

function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))).slice(0, 80);
}

function parseMode(value: unknown): BatchMode {
  return value === "package" ? "package" : "pptx";
}

async function syncTaskIfPossible(request: NextRequest, task: ConversionTaskRecord) {
  try {
    return await syncConversionTaskFromCodia(task, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
  } catch {
    return task;
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids = uniqueIds((body as Record<string, unknown>).ids);
    const mode = parseMode((body as Record<string, unknown>).mode);
    if (ids.length === 0) return NextResponse.json({ error: "请选择要导出的转换任务" }, { status: 400 });

    const zip = new JSZip();
    const manifest: BatchItem[] = [];
    let includedCount = 0;

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const existing = getConversionTask(id, userId);
      if (!existing) {
        manifest.push({ id, status: "skipped", reason: "任务不存在" });
        continue;
      }

      const task = await syncTaskIfPossible(request, existing);
      const prefix = `${String(index + 1).padStart(2, "0")}-${safeConversionFileName(task.source_name, "转换任务")}`;

      if (mode === "pptx") {
        if (!task.ppt_url) {
          manifest.push({ id, name: task.source_name, status: "skipped", reason: "没有可下载的 PPTX 地址" });
          continue;
        }
        try {
          const asset = await addConversionTaskPptxToZip(zip, request, task, `${String(index + 1).padStart(2, "0")}-`);
          manifest.push({ id, name: task.source_name, status: "included", assets: [asset] });
          includedCount += 1;
        } catch (error) {
          manifest.push({ id, name: task.source_name, status: "skipped", reason: error instanceof Error ? error.message : "读取 PPTX 失败" });
        }
        continue;
      }

      try {
        const assets = await addConversionTaskPackageToZip(zip, request, task, `tasks/${prefix}`);
        manifest.push({ id, name: task.source_name, status: "included", assets });
        includedCount += 1;
      } catch (error) {
        manifest.push({ id, name: task.source_name, status: "skipped", reason: error instanceof Error ? error.message : "导出任务包失败" });
      }
    }

    if (includedCount === 0) {
      return NextResponse.json({ error: "没有可导出的任务", items: manifest }, { status: 400 });
    }

    zip.file("batch-manifest.json", JSON.stringify({
      format: "huanzon-aistudio-conversion-batch",
      version: 1,
      mode,
      exportedAt: new Date().toISOString(),
      requested: ids.length,
      included: includedCount,
      items: manifest,
    }, null, 2));

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const filename = mode === "package" ? "转换任务包批量导出.zip" : "PPTX批量下载.zip";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Export-Included": String(includedCount),
        "X-Export-Requested": String(ids.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "批量导出转换任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}
