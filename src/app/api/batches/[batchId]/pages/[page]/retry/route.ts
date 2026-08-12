import { NextRequest, NextResponse } from "next/server";
import { retryPageForUser } from "@/lib/batch-module/jobs";
import { getCurrentUserId } from "@/lib/auth";
import type { BatchJobStage } from "@/lib/batch-module/types";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string; page: string }> }) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    const { batchId, page } = await context.params;
    const body = (await request.json()) as { stage?: BatchJobStage };
    const stage = body.stage || "colorization";
    if (stage !== "draft_generation" && stage !== "colorization") {
      const normalized = normalizeOperationError({ message: "stage 必须是 draft_generation 或 colorization", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    const pageNumber = Number.parseInt(page, 10);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      const normalized = normalizeOperationError({ message: "页码不合法", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    return NextResponse.json({ ok: true, batch: await retryPageForUser(batchId, userId, pageNumber, stage) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "BATCH_ACCESS_DENIED" ? 403 : /不存在|not\s*found/i.test(message) ? 404 : 500;
    const normalized = normalizeOperationError({
      message,
      status,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
