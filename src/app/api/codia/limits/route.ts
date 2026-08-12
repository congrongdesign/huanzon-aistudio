import { NextResponse } from "next/server";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders, getCodiaLimits } from "@/lib/codia/client";

export async function GET(request: Request) {
  try {
    const result = await getCodiaLimits(getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取 Codia 限制失败";
    return NextResponse.json({ error: message }, { status });
  }
}
