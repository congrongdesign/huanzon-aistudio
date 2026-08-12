import { NextRequest, NextResponse } from "next/server";
import {
  normalizeProviderProfilesStore,
  readProviderProfilesStore,
  writeProviderProfilesStore,
} from "@/lib/provider-profiles-store";

export async function GET() {
  return NextResponse.json(readProviderProfilesStore());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const store = normalizeProviderProfilesStore(body);
    const saved = writeProviderProfilesStore(store);
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存中转站配置失败" },
      { status: 500 },
    );
  }
}
