import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getCurrentUserId } from "@/lib/auth";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { syncConversionTaskFromCodia } from "@/lib/conversion/codia-task";
import { getConversionTask } from "@/lib/conversion/store";
import { addConversionTaskPackageToZip, safeConversionFileName } from "@/lib/conversion/task-export";

export const runtime = "nodejs";

export async function GET(
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

    const zip = new JSZip();
    const taskName = safeConversionFileName(task.source_name, "转换任务");
    await addConversionTaskPackageToZip(zip, request, task);

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${taskName}_转换任务包.zip`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "导出转换任务包失败";
    return NextResponse.json({ error: message }, { status });
  }
}
