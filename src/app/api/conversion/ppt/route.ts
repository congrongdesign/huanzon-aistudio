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
import { pageNumbers, prepareConversionRequest } from "@/lib/conversion/prepare-request";
import { createConversionTask, updateConversionTask } from "@/lib/conversion/store";
import { saveBinaryFile } from "@/lib/local-backend";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const codiaApiKey = getCodiaApiKeyFromHeaders(request.headers);
  const codiaBaseUrl = getCodiaBaseUrlFromHeaders(request.headers);

  let taskId: string | null = null;

  try {
    const prepared = await prepareConversionRequest(request);
    const isPdf = prepared.sourceType === "pdf";
    const initial = createConversionTask(userId, {
      project_id: prepared.projectId,
      codia_task_id: null,
      source_type: prepared.sourceType,
      source_name: prepared.taskName,
      source_files: prepared.sourceFiles,
      page_count: 0,
      status: isPdf ? "uploading" : "preparing_pdf",
      progress: isPdf ? 10 : 5,
      estimated_credits: null,
      charged_credits: null,
      upload_id: null,
      prepared_pdf_key: null,
      prepared_pdf_url: null,
      ppt_url: null,
      error_message: null,
    });
    taskId = initial.id;

    const savedPdf = saveBinaryFile(prepared.pdfBuffer, `${prepared.taskName}.pdf`, "application/pdf");
    updateConversionTask(initial.id, userId, {
      page_count: prepared.pageCount,
      prepared_pdf_key: savedPdf.key,
      prepared_pdf_url: savedPdf.url,
      status: "uploading",
      progress: 20,
    });

    const uploadResponse = await uploadCodiaPdf(prepared.pdfBuffer, `${prepared.taskName}.pdf`, codiaApiKey, codiaBaseUrl);
    const uploadId = extractUploadId(uploadResponse.data);
    if (!uploadId) throw new Error("Codia 未返回 upload_id");

    const input: Record<string, unknown> = {
      upload_id: uploadId,
      title: prepared.taskName,
      ...(prepared.pageCount > 0 ? { page_no: pageNumbers(prepared.pageCount) } : {}),
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

    const idempotencyKey = `conversion-${initial.id}`;
    const createResponse = await createCodiaPdfToPptTask(input, idempotencyKey, undefined, codiaApiKey, codiaBaseUrl);
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
    const status = error instanceof CodiaApiError ? error.status : taskId ? 500 : 400;
    const message = error instanceof Error ? error.message : "创建转换任务失败";
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
