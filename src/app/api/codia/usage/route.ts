import { NextRequest, NextResponse } from "next/server";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders, getCodiaUsage } from "@/lib/codia/client";

export async function GET(request: NextRequest) {
  try {
    const result = await getCodiaUsage(request.nextUrl.search, getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取 Codia 用量失败";
    return NextResponse.json({ error: message }, { status });
  }
}
