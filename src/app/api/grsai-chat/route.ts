import { NextRequest, NextResponse } from "next/server";
import { createLlmRequestPreview } from "@/lib/llm-preview";
import { buildNumberedReferencePromptText } from "@/lib/reference-text";

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

function withNumberedReferenceText(messages: unknown[]) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const msg = message as { role?: unknown; content?: unknown };
    if (msg.role !== "user" || !Array.isArray(msg.content)) return message;
    const imageCount = msg.content.filter((item) => {
      return item && typeof item === "object" && (item as { type?: unknown }).type === "image_url";
    }).length;
    if (imageCount <= 0) return message;
    return {
      ...msg,
      content: msg.content.map((item) => {
        if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "text") return item;
        const text = (item as { text?: unknown }).text;
        return typeof text === "string"
          ? { ...item, text: buildNumberedReferencePromptText(text, imageCount) }
          : item;
      }),
    };
  });
}

/**
 * Proxy to grsai /v1/chat/completions (OpenAI-compatible)
 * Supports SSE streaming and non-streaming modes
 */
export async function POST(request: NextRequest) {
  try {
    const { messages, model, stream, apiKey, baseUrl, temperature } = await request.json();
    const effectiveMessages = withNumberedReferenceText(messages);

    if (!apiKey?.trim() && !isLocalEndpoint(baseUrl)) {
      return NextResponse.json({ error: "请先配置 API Key" }, { status: 400 });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages is required" }, { status: 400 });
    }

    // Clean inputs - strip whitespace and Bearer prefix
    const cleanApiKey = (apiKey || "").replace(/^Bearer\s+/i, "").trim();
    const cleanBaseUrl = (baseUrl || "https://grsaiapi.com").trim();

    console.log("[grsai-chat] Request:", { model, baseUrl: cleanBaseUrl, stream, messageCount: messages?.length });

    // Build API URL - handle cases where baseUrl already includes /v1 or ends with /
    const cleanBase = cleanBaseUrl.replace(/\/+$/, "");
    let apiUrl: string;
    if (cleanBase.endsWith("/v1") || cleanBase.endsWith("/v1/")) {
      apiUrl = `${cleanBase}/chat/completions`;
    } else {
      apiUrl = `${cleanBase}/v1/chat/completions`;
    }
    const useStream = stream !== false;
    const requestPreview = createLlmRequestPreview({
      source: "grsai-chat",
      model: model || "gpt-4o",
      baseUrl: cleanBaseUrl,
      stream: useStream,
      apiKey: cleanApiKey,
      temperature: temperature ?? 0.7,
      messages: effectiveMessages as never,
      note: "grsai OpenAI 兼容对话请求",
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: (() => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (cleanApiKey) {
          headers.Authorization = `Bearer ${cleanApiKey}`;
        } else if (isLocalEndpoint(cleanBaseUrl)) {
          headers.Authorization = "Bearer ollama";
        }
        return headers;
      })(),
      body: JSON.stringify({
        model: model || "gpt-4o",
        messages: effectiveMessages,
        stream: useStream,
        temperature: temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.error || errorText;
      } catch { /* use raw text */ }
      // Add helpful hint for model not found errors
      if (String(errorMessage).includes('model not register') || String(errorMessage).includes('model_not_found') || String(errorMessage).includes('does not exist')) {
        errorMessage += '（当前API平台可能不支持该模型，请尝试其他模型或在对话模型中选择"自定义模型"输入平台支持的模型名）';
      }
      return NextResponse.json(
        { error: `API错误 (${response.status}): ${errorMessage}` },
        { status: response.status }
      );
    }

    // Non-streaming: return JSON directly
    if (!useStream) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    // Streaming: proxy SSE chunks
    const encoder = new TextEncoder();
    const proxyStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "request_preview", preview: requestPreview })}\n\n`));
        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "No response body" })}\n\n`));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }
              if (!trimmed.startsWith("data: ")) continue;

              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                  );
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
            const trimmed = buffer.trim();
            if (trimmed.startsWith("data: ")) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                  );
                }
              } catch { /* skip */ }
            }
          }

          controller.close();
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(proxyStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
