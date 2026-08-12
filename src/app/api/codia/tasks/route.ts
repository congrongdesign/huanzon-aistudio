import { NextRequest, NextResponse } from "next/server";
import { CodiaApiError, codiaRequest, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders, listCodiaTasks } from "@/lib/codia/client";

export async function GET(request: NextRequest) {
  try {
    const result = await listCodiaTasks(request.nextUrl.search, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取 Codia 任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const idempotencyKey = request.headers.get("Idempotency-Key") || undefined;
    const result = await codiaRequest("/v2/open/tasks", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body,
      apiKey: getCodiaApiKeyFromHeaders(request.headers),
      baseUrl: getCodiaBaseUrlFromHeaders(request.headers),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "创建 Codia 任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}
