import fs from "fs";
import { PDFDocument } from "pdf-lib";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  CodiaApiError,
  createCodiaPdfToPptTask,
  estimateCodiaPdfToPpt,
  getCodiaApiKeyFromHeaders,
  getCodiaBaseUrlFromHeaders,
  uploadCodiaPdf,
} from "@/lib/codia/client";
import { createConversionTask, getConversionTask, updateConversionTask } from "@/lib/conversion/store";
import { resolveLocalFilePath, saveBinaryFile } from "@/lib/local-backend";

export const runtime = "nodejs";

function safeTaskName(name: string) {
  return (name || "图片转可编辑PPT").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 80) || "图片转可编辑PPT";
}

function extractUploadId(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  return typeof obj.upload_id === "string" ? obj.upload_id : "";
}

function extractTaskId(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  return typeof obj.task_id === "string" ? obj.task_id : typeof obj.id === "string" ? obj.id : "";
}

function extractCredits(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const credits = Number((data as Record<string, unknown>).credits);
  return Number.isFinite(credits) ? credits : null;
}

function extractSufficient(data: unknown) {
  if (!data || typeof data !== "object") return true;
  const value = (data as Record<string, unknown>).sufficient;
  return typeof value === "boolean" ? value : true;
}

function pageNumbers(pageCount: number) {
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => index);
}

async function readPreparedPdf(request: NextRequest, key?: string | null, url?: string | null) {
  if (key) {
    const filePath = resolveLocalFilePath(key);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  }

  if (!url) throw new Error("任务没有可重试的中间 PDF");
  const resolved = new URL(url, request.nextUrl.origin);
  const response = await fetch(resolved, { cache: "no-store", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`读取中间 PDF 失败 (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function getPdfPageCount(buffer: Buffer) {
  try {
    const pdf = await PDFDocument.load(buffer);
    return pdf.getPageCount();
  } catch {
    return 0;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const codiaApiKey = getCodiaApiKeyFromHeaders(request.headers);
  const codiaBaseUrl = getCodiaBaseUrlFromHeaders(request.headers);
  let taskId: string | null = null;

  try {
    const { id } = await params;
    const sourceTask = getConversionTask(id, userId);
    if (!sourceTask) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    if (!sourceTask.prepared_pdf_url && !sourceTask.prepared_pdf_key) {
      return NextResponse.json({ error: "任务没有可重试的中间 PDF" }, { status: 400 });
    }

    const taskName = safeTaskName(`${sourceTask.source_name}-重试`);
    const pdfBuffer = await readPreparedPdf(request, sourceTask.prepared_pdf_key, sourceTask.prepared_pdf_url);
    const pageCount = sourceTask.page_count || await getPdfPageCount(pdfBuffer);
    const savedPdf = saveBinaryFile(pdfBuffer, `${taskName}.pdf`, "application/pdf");

    const initial = createConversionTask(userId, {
      project_id: sourceTask.project_id,
      codia_task_id: null,
      source_type: sourceTask.source_type,
      source_name: taskName,
      source_files: sourceTask.source_files,
      page_count: pageCount,
      status: "uploading",
      progress: 20,
      estimated_credits: null,
      charged_credits: null,
      upload_id: null,
      prepared_pdf_key: savedPdf.key,
      prepared_pdf_url: savedPdf.url,
      ppt_url: null,
      error_message: null,
    });
    taskId = initial.id;

    const uploadResponse = await uploadCodiaPdf(pdfBuffer, `${taskName}.pdf`, codiaApiKey, codiaBaseUrl);
    const uploadId = extractUploadId(uploadResponse.data);
    if (!uploadId) throw new Error("Codia 未返回 upload_id");

    const input: Record<string, unknown> = {
      upload_id: uploadId,
      title: taskName,
      ...(pageCount > 0 ? { page_no: pageNumbers(pageCount) } : {}),
    };

    updateConversionTask(initial.id, userId, {
      upload_id: uploadId,
      status: "estimating",
      progress: 35,
    });

    const estimate = await estimateCodiaPdfToPpt(input, codiaApiKey, codiaBaseUrl);
    const credits = extractCredits(estimate.data);
    if (!extractSufficient(estimate.data)) {
      throw new Error("Codia 余额不足，无法创建转换任务");
    }

    const createResponse = await createCodiaPdfToPptTask(input, `conversion-retry-${initial.id}`, undefined, codiaApiKey, codiaBaseUrl);
    const codiaTaskId = extractTaskId(createResponse.data);
    if (!codiaTaskId) throw new Error("Codia 未返回任务 ID");

    const task = updateConversionTask(initial.id, userId, {
      codia_task_id: codiaTaskId,
      estimated_credits: credits,
      status: "queued",
      progress: 45,
    });

    return NextResponse.json({ task });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "重试转换任务失败";
    const task = taskId
      ? updateConversionTask(taskId, userId, {
          status: "failed",
          progress: 100,
          error_message: message,
        })
      : null;
    return NextResponse.json({ error: message, task }, { status });
  }
}
