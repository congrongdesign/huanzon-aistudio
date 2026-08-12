import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { createBatch, listBatchSnapshots } from "@/lib/batch-module/jobs";
import type { CreateBatchInput } from "@/lib/batch-module/types";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    const normalized = normalizeOperationError({ message: "未登录", status: 401 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
  try {
    return NextResponse.json({ records: await listBatchSnapshots(userId) });
  } catch (error) {
    const normalized = normalizeOperationError({
      message: error instanceof Error ? error.message : String(error),
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    const normalized = normalizeOperationError({ message: "未登录", status: 401 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
  try {
    const body = (await request.json()) as Omit<CreateBatchInput, "userId">;
    const snapshot = await createBatch({
      ...body,
      userId,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = normalizeOperationError({
      message,
      status: /api key/i.test(message) ? 400 : 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
