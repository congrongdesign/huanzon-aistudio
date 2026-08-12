import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";

function isLocalEndpoint(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function normalizeBase(baseUrl?: string): string {
  const clean = (baseUrl || "https://grsaiapi.com").replace(/\/+$/, "");
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。,.、:：;；!！?？]/g, "").trim();
}

function roughSimilarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const set = new Set(left.split(""));
  let hit = 0;
  for (const ch of right) if (set.has(ch)) hit += 1;
  return hit / Math.max(left.length, right.length);
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const body = await request.json();
    const sourceText = String(body.sourceText || "").trim();
    const originalImageUrl = String(body.originalImageUrl || "").trim();
    const generatedImageUrl = String(body.generatedImageUrl || "").trim();
    const apiKey = String(body.apiKey || "").replace(/^Bearer\s+/i, "").trim();
    const baseUrl = String(body.baseUrl || "").trim();
    const model = String(body.model || "gpt-4o").trim();

    if (!sourceText) {
      return NextResponse.json({ passed: true, confidence: 0.6, reason: "原稿未解析到可校验文字，已跳过文字校验。" });
    }
    if (!generatedImageUrl) {
      return NextResponse.json({ passed: false, confidence: 0, reason: "缺少生成结果图片。" });
    }
    if (!apiKey && !isLocalEndpoint(baseUrl)) {
      return NextResponse.json({ passed: false, confidence: 0, reason: "未配置对话模型 API Key，无法做文字一致性校验。" });
    }

    const messages = [
      {
        role: "system",
        content: "你是严格的中文PPT质检员。只判断生成图中的文字是否与原稿文字100%一致。必须返回JSON，不要输出多余文字。",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `请检查生成图是否完整保留原稿文字。原稿文字如下：\n${sourceText}\n\n判断规则：不能增字、漏字、改字、改数字。版式变化不影响判断。返回格式：{"passed":true/false,"confidence":0-1,"missing":[],"changed":[],"extra":[],"reason":"一句话"}` },
          ...(originalImageUrl ? [{ type: "image_url", image_url: { url: originalImageUrl } }] : []),
          { type: "image_url", image_url: { url: generatedImageUrl } },
        ],
      },
    ];

    const response = await fetch(`${normalizeBase(baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: false, temperature: 0 }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ passed: false, confidence: 0, reason: `文字校验接口失败：${text.slice(0, 180)}` });
    }

    const data = await response.json();
    const content = String(data.choices?.[0]?.message?.content || "").trim();
    const jsonText = content.match(/\{[\s\S]*\}/)?.[0] || content;
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      return NextResponse.json({
        passed: Boolean(parsed.passed),
        confidence: Number(parsed.confidence || 0),
        missing: Array.isArray(parsed.missing) ? parsed.missing : [],
        changed: Array.isArray(parsed.changed) ? parsed.changed : [],
        extra: Array.isArray(parsed.extra) ? parsed.extra : [],
        reason: String(parsed.reason || "校验完成"),
      });
    } catch {
      const similarity = roughSimilarity(sourceText, content);
      return NextResponse.json({
        passed: similarity > 0.92,
        confidence: similarity,
        reason: `校验模型未返回标准 JSON，已按文本相似度兜底：${Math.round(similarity * 100)}%`,
        raw: content.slice(0, 500),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "文字校验失败";
    return NextResponse.json({ passed: false, confidence: 0, reason: message }, { status: 200 });
  }
}
