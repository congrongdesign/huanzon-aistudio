import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { syncConversionTaskFromCodia } from "@/lib/conversion/codia-task";
import { getConversionTask, updateConversionTask } from "@/lib/conversion/store";
import type { ConversionTaskRecord } from "@/lib/conversion/types";
import {
  createDesignAsset,
  getDesignAssetById,
  isLocalBackendEnabled,
  listDesignAssets,
  resolveLocalFilePath,
  saveBinaryFile,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export const runtime = "nodejs";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type ArchivePayload = {
  url: string;
  key: string | null;
  mimeType: string;
  size: number;
};

function safeFileName(value: string, fallback: string) {
  return (value || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || fallback;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

async function readResultFile(request: NextRequest, url: string) {
  if (url.startsWith("/api/local-file/")) {
    const key = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "");
    const filePath = resolveLocalFilePath(key);
    if (!fs.existsSync(filePath)) throw new Error("结果文件不存在");
    return { buffer: fs.readFileSync(filePath), contentType: PPTX_MIME };
  }

  const resolved = resolveFetchUrl(request, url);
  if (!resolved) throw new Error("结果文件地址无效");
  const response = await fetch(resolved, { cache: "no-store", signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`读取 PPTX 失败 (${response.status})`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || PPTX_MIME,
  };
}

async function prepareArchivePayload(request: NextRequest, task: ConversionTaskRecord): Promise<ArchivePayload> {
  if (!task.ppt_url) throw new Error("转换结果还没有 PPTX 地址");

  if (!isLocalBackendEnabled()) {
    return {
      url: task.ppt_url,
      key: null,
      mimeType: PPTX_MIME,
      size: 0,
    };
  }

  const result = await readResultFile(request, task.ppt_url);
  const saved = saveBinaryFile(
    result.buffer,
    `${safeFileName(task.source_name, "转换结果")}.pptx`,
    PPTX_MIME,
  );
  return {
    url: saved.url,
    key: saved.key,
    mimeType: PPTX_MIME,
    size: result.buffer.byteLength,
  };
}

function findExistingLocalAsset(userId: string | null, task: ConversionTaskRecord) {
  if (task.archived_asset_id) {
    const asset = getDesignAssetById(task.archived_asset_id, userId);
    if (asset) return asset;
  }
  return listDesignAssets(userId, { projectId: task.project_id, kind: "export" }).find((asset) => {
    const metadata = parseMetadata(asset.metadata);
    return metadata.conversionTaskId === task.id;
  }) || null;
}

async function findExistingSupabaseAsset(userId: string, task: ConversionTaskRecord) {
  const supabase = getSupabaseClient();
  if (task.archived_asset_id) {
    const { data } = await supabase
      .from("design_assets")
      .select("*")
      .eq("id", task.archived_asset_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data;
  }

  const { data } = await supabase
    .from("design_assets")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "export")
    .contains("metadata", { conversionTaskId: task.id })
    .limit(1);
  return data?.[0] || null;
}

function archiveMetadata(task: ConversionTaskRecord, payload: ArchivePayload) {
  return {
    conversionTaskId: task.id,
    codiaTaskId: task.codia_task_id,
    sourceType: task.source_type,
    sourceName: task.source_name,
    pageCount: task.page_count || task.source_files.length,
    sourceFiles: task.source_files,
    preparedPdfUrl: task.prepared_pdf_url,
    originalPptUrl: task.ppt_url,
    archivedFrom: "conversion_center",
    fileSize: payload.size,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await params;
    const existing = getConversionTask(id, userId);
    if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    let task = existing;
    try {
      task = await syncConversionTaskFromCodia(existing, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    } catch {
      task = existing;
    }

    if (!task.ppt_url) {
      return NextResponse.json({ error: "转换结果还没有 PPTX 地址，请先同步结果" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const existingAsset = findExistingLocalAsset(userId, task);
      if (existingAsset) {
        const updatedTask = updateConversionTask(task.id, userId, {
          archived_asset_id: existingAsset.id,
          archived_at: task.archived_at || new Date().toISOString(),
        }) || task;
        return NextResponse.json({ asset: existingAsset, task: updatedTask, alreadyArchived: true });
      }

      const payload = await prepareArchivePayload(request, task);
      const asset = createDesignAsset(userId, {
        project_id: task.project_id,
        kind: "export",
        url: payload.url,
        key: payload.key,
        width: 0,
        height: 0,
        mime_type: payload.mimeType,
        metadata: archiveMetadata(task, payload),
      });
      const updatedTask = updateConversionTask(task.id, userId, {
        archived_asset_id: asset.id,
        archived_at: new Date().toISOString(),
      }) || task;
      return NextResponse.json({ asset, task: updatedTask, alreadyArchived: false });
    }

    const existingAsset = await findExistingSupabaseAsset(userId, task);
    if (existingAsset) {
      const updatedTask = updateConversionTask(task.id, userId, {
        archived_asset_id: existingAsset.id,
        archived_at: task.archived_at || new Date().toISOString(),
      }) || task;
      return NextResponse.json({ asset: existingAsset, task: updatedTask, alreadyArchived: true });
    }

    const payload = await prepareArchivePayload(request, task);
    const supabase = getSupabaseClient();
    const { data: asset, error } = await supabase
      .from("design_assets")
      .insert({
        project_id: task.project_id,
        user_id: userId,
        kind: "export",
        url: payload.url,
        key: payload.key,
        width: 0,
        height: 0,
        mime_type: payload.mimeType,
        metadata: archiveMetadata(task, payload),
      })
      .select()
      .single();
    if (error) throw error;

    const updatedTask = updateConversionTask(task.id, userId, {
      archived_asset_id: asset.id,
      archived_at: new Date().toISOString(),
    }) || task;
    return NextResponse.json({ asset, task: updatedTask, alreadyArchived: false });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "归档转换结果失败";
    return NextResponse.json({ error: message }, { status });
  }
}
