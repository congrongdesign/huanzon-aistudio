import { NextRequest, NextResponse } from "next/server";
import { getBatchSnapshotForUser } from "@/lib/batch-module/jobs";
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
    return NextResponse.json(await getBatchSnapshotForUser(batchId, userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = normalizeOperationError({
      message,
      status: message === "BATCH_ACCESS_DENIED" ? 403 : 404,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
