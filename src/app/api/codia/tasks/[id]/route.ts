import { NextResponse } from "next/server";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders, getCodiaTask } from "@/lib/codia/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await getCodiaTask(id, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取 Codia 任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}
