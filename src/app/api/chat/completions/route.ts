import { NextRequest, NextResponse } from "next/server";

function cleanBaseUrl(url?: string): string {
  const raw = (url || "https://grsaiapi.com").trim().replace(/\/+$/, "");
  if (raw.endsWith("/v1")) return raw.slice(0, -3);
  return raw;
}

function cleanApiKey(key?: string): string {
  return (key || "").replace(/^Bearer\s+/i, "").trim();
}

function isLocalEndpoint(url?: string): boolean {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function buildChatUrl(baseUrl?: string): string {
  return `${cleanBaseUrl(baseUrl)}/v1/chat/completions`;
}

function getDefaultBaseUrl(): string {
  return (
    process.env.GRS_BASE_URL ||
    process.env.CHAT_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://grsaiapi.com"
  );
}

function getDefaultApiKey(): string {
  return (
    process.env.GRS_API_KEY ||
    process.env.CHAT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

async function forwardOpenAIChatCompletion(
  request: NextRequest,
  payload: {
    model?: string;
    stream?: boolean;
    messages?: unknown[];
    temperature?: number;
    apiKey?: string;
    baseUrl?: string;
  },
) {
  const url = buildChatUrl(payload.baseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const headerApiKey = cleanApiKey(request.headers.get("authorization") || undefined);
  const apiKey = cleanApiKey(payload.apiKey || headerApiKey);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (isLocalEndpoint(payload.baseUrl)) {
    headers.Authorization = "Bearer ollama";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: payload.model || "gpt-4o",
      stream: payload.stream !== false,
      messages: payload.messages,
      temperature: payload.temperature ?? 0.7,
    }),
  });

  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const searchParams = new URL(request.url).searchParams;

    const baseUrl = String(
      body.baseUrl ||
      body.base_url ||
      searchParams.get("baseUrl") ||
      searchParams.get("base_url") ||
      getDefaultBaseUrl(),
    ).trim();

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = body.stream !== false;
    const apiKey = String(body.apiKey || body.api_key || getDefaultApiKey()).trim();
    const model = String(body.model || "gpt-4o").trim();
    const temperature = typeof body.temperature === "number" ? body.temperature : undefined;

    if (messages.length === 0) {
      return NextResponse.json({ error: "messages is required" }, { status: 400 });
    }

    const response = await forwardOpenAIChatCompletion(request, {
      model,
      stream,
      messages,
      temperature,
      apiKey,
      baseUrl,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return new NextResponse(text || `API错误 (${response.status})`, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
        },
      });
    }

    if (!stream) {
      const json = await response.json();
      return NextResponse.json(json);
    }

    const headers = new Headers();
    headers.set("Content-Type", response.headers.get("content-type") || "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
