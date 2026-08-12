import { NextRequest, NextResponse } from "next/server";
import { buildPptxBuffer } from "@/lib/batch-module/export";
import { readManifest, updateManifest, addLog } from "@/lib/batch-module/storage";
import { getCurrentUserId } from "@/lib/auth";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    const { batchId } = await context.params;
    const manifest = await readManifest(batchId);
    if (manifest.batch.userId !== userId) {
      const normalized = normalizeOperationError({ message: "BATCH_ACCESS_DENIED", status: 403 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    const buffer = await buildPptxBuffer(manifest);
    await updateManifest(batchId, (current) => {
      addLog(current, {
        at: new Date().toISOString(),
        level: "info",
        stage: "export",
        status: "succeeded",
        message: "PPTX 导出成功。",
      });
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${manifest.batch.sourceFileName}_批量结果.pptx`)}`,
      },
    });
  } catch (error) {
    const normalized = normalizeOperationError({
      message: error instanceof Error ? error.message : String(error),
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
