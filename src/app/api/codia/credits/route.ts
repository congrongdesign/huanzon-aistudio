import { NextResponse } from "next/server";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders, getCodiaCredits } from "@/lib/codia/client";

export async function GET(request: Request) {
  try {
    const result = await getCodiaCredits(getCodiaApiKeyFromHeaders(request.headers), getCodiaBaseUrlFromHeaders(request.headers));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取 Codia 余额失败";
    return NextResponse.json({ error: message }, { status });
  }
}
