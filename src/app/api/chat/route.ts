import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createChatMessage,
  isLocalBackendEnabled,
  listChatMessages,
  patchChatMessage,
} from "@/lib/local-backend";
import { getReferenceImageLimitForModel } from "@/lib/image-edit/reference-constants";
import { prepareReferenceImagesForModel, refreshReferenceUrls } from "@/lib/image-edit/reference-prep";
import { createLlmRequestPreview } from "@/lib/llm-preview";
import { buildNumberedReferencePromptText } from "@/lib/reference-text";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const SYSTEM_PROMPT = `你是环中AIStudio的 AI 设计助手。

规则：
- 只根据本次用户消息回复，不读取、不补充、不沿用任何历史对话或项目记忆
- 用户明确要求生图时，原样保留本次用户提示词，并用 [GENERATE:xxx] 标记
- 保留比例、风格、颜色、构图和参考图要求
- 用户只是提问或闲聊时，正常回复，不加 [GENERATE] 标记`;

const OPTIMIZE_PROMPT = `你是一个专业的AI图像生成提示词优化专家。你的任务是将用户提供的简短或模糊的图像描述，扩展为更加详细、精准、富有表现力的中文提示词。
只返回优化后的中文提示词，不要加任何解释、前缀或后缀。`;

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

function encodeSseData(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, payload: Record<string, unknown>) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function toPreviewImageUrl(url: string): string {
  if (!url.startsWith("data:")) return url;
  const mime = url.match(/^data:([^;]+);base64,/)?.[1] || "image";
  return `[${mime} data url omitted]`;
}

function buildVisionContent(text: string, urls: string[]) {
  return [
    { type: "text", text: buildNumberedReferencePromptText(text, urls.length) },
    ...urls.map((u: string) => ({ type: "image_url", image_url: { url: u } })),
  ];
}

function buildPreviewMessages(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>,
) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "image_url" || !part.image_url?.url) return part;
        return { ...part, image_url: { url: toPreviewImageUrl(part.image_url.url) } };
      }),
    };
  });
}

function extractErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const errorObj = parsed.error as Record<string, unknown> | string | undefined;
    if (typeof errorObj === "string") return errorObj;
    if (errorObj && typeof errorObj.message === "string") return errorObj.message;
    if (typeof parsed.message === "string") return parsed.message;
    return raw;
  } catch {
    return raw;
  }
}

async function* streamOpenAICompatible(
  payload: {
    model: string;
    messages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>;
    temperature?: number;
  },
  apiKey: string,
  baseUrl?: string,
): AsyncGenerator<string> {
  const response = await fetch(buildChatUrl(baseUrl), {
    method: "POST",
    headers: (() => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const cleaned = cleanApiKey(apiKey);
      if (cleaned) headers.Authorization = `Bearer ${cleaned}`;
      return headers;
    })(),
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      stream: true,
      temperature: payload.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API错误 (${response.status}): ${extractErrorMessage(text)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(trimmed.slice(6));
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ messages: [] });
    }

    if (isLocalBackendEnabled()) {
      const messages = listChatMessages(projectId, userId, 1000, true);
      return NextResponse.json({ messages });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("chat_messages")
      .select("id, role, content, reference_image_urls, image_url, created_at")
      .eq("project_id", projectId);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ messages: data || [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id, content, image_url } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const msg = patchChatMessage(id, { content, image_url });
      if (!msg) return NextResponse.json({ error: "message not found" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const updateData: Record<string, unknown> = {};
    if (content !== undefined) updateData.content = content;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("chat_messages").update(updateData).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    const {
      message,
      role,
      content,
      image_url,
      reference_image_urls,
      projectId,
      referenceImageUrls,
      optimize,
      analyze,
      chatModel,
      dsApiKey,
      dsBaseUrl,
      systemPrompt,
      apiKey,
      baseUrl,
    } = await request.json() as {
      message?: string;
      role?: "user" | "assistant";
      content?: string;
      image_url?: string | null;
      reference_image_urls?: string | null;
      projectId?: string;
      referenceImageUrls?: string[];
      optimize?: boolean;
      analyze?: boolean;
      chatModel?: string;
      dsApiKey?: string;
      dsBaseUrl?: string;
      systemPrompt?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    if (!message && role && content && projectId) {
      let refUrls: string[] | undefined;
      if (reference_image_urls) {
        try {
          const parsed = JSON.parse(reference_image_urls) as string[];
          if (Array.isArray(parsed)) refUrls = parsed;
        } catch {
          refUrls = undefined;
        }
      }

      if (isLocalBackendEnabled()) {
        const message = createChatMessage(projectId, userId, role, content, refUrls, image_url || null);
        return NextResponse.json({ success: true, message });
      } else {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.from("chat_messages").insert({
          project_id: projectId,
          user_id: userId,
          role,
          content,
          reference_image_urls: reference_image_urls || null,
          image_url: image_url || null,
        }).select("id, project_id, role, content, reference_image_urls, image_url, created_at").single();
        if (error) throw error;
        return NextResponse.json({ success: true, message: data });
      }
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const model = chatModel || "gpt-4o";
    let key = cleanApiKey(apiKey || dsApiKey);
    const url = baseUrl || dsBaseUrl || "https://grsaiapi.com";
    const sourceReferenceImageUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
      : undefined;
    let storedReferenceImageUrls: string[] | undefined;
    let effectiveReferenceImageUrls: string[] | undefined;
    let previewReferenceImageUrls: string[] | undefined;
    if (sourceReferenceImageUrls && sourceReferenceImageUrls.length > 0) {
      storedReferenceImageUrls = await refreshReferenceUrls(sourceReferenceImageUrls);
      const prepared = await prepareReferenceImagesForModel(analyze ? sourceReferenceImageUrls : storedReferenceImageUrls, {
        maxCount: getReferenceImageLimitForModel(model),
      });
      effectiveReferenceImageUrls = prepared.references;
      previewReferenceImageUrls = prepared.items.map((item) => item.original).slice(0, effectiveReferenceImageUrls.length);
    }
    if (analyze && (!effectiveReferenceImageUrls || effectiveReferenceImageUrls.length === 0)) {
      return NextResponse.json({ error: "反推提示词需要至少一张可访问的图片" }, { status: 400 });
    }
    if (!key && isLocalEndpoint(url)) {
      key = "ollama";
    }
    if (!key) {
      return NextResponse.json({ error: "请先配置对话 API Key" }, { status: 400 });
    }

    if (projectId) {
      const persistedReferenceImageUrls = analyze ? sourceReferenceImageUrls : storedReferenceImageUrls;
      if (isLocalBackendEnabled()) {
        createChatMessage(projectId, userId, "user", message, persistedReferenceImageUrls, null);
      } else {
        const supabase = getSupabaseClient();
        void (async () => {
          try {
            await supabase.from("chat_messages").insert({
              project_id: projectId,
              user_id: userId,
              role: "user",
              content: message,
              reference_image_urls: persistedReferenceImageUrls ? JSON.stringify(persistedReferenceImageUrls) : null,
            });
          } catch {
            // best-effort persistence only
          }
        })();
      }
    }

    let messages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }> = [];
    if (optimize) {
      messages = [
        { role: "system", content: OPTIMIZE_PROMPT },
        { role: "user", content: message },
      ];
    } else if (analyze && Array.isArray(effectiveReferenceImageUrls) && effectiveReferenceImageUrls.length > 0) {
      const content = buildVisionContent(message, effectiveReferenceImageUrls);
      messages = [
        {
          role: "system",
          content:
            systemPrompt ||
            "你是图像分析专家，请用中文详细分析图片并给出可直接用于生图的完整提示词，只输出提示词。",
        },
        { role: "user", content },
      ];
    } else {
      messages = [{ role: "system", content: systemPrompt || SYSTEM_PROMPT }];
      if (effectiveReferenceImageUrls && effectiveReferenceImageUrls.length > 0) {
        messages.push({
          role: "user",
          content: buildVisionContent(message, effectiveReferenceImageUrls),
        });
      } else {
        messages.push({ role: "user", content: message });
      }
    }

    const encoder = new TextEncoder();
    let fullContent = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const preview = createLlmRequestPreview({
            source: "chat",
            model,
            baseUrl: url,
            stream: true,
            apiKey: key,
            temperature: 0.7,
            messages: buildPreviewMessages(messages),
            referenceImageUrls: previewReferenceImageUrls ?? sourceReferenceImageUrls ?? [],
            note: optimize
              ? "提示词优化请求"
              : analyze
                ? "图片分析请求"
                : "普通对话请求（仅当前消息，未携带历史/记忆）",
          });
          encodeSseData(controller, encoder, { type: "request_preview", preview });

          for await (const text of streamOpenAICompatible({ model, messages, temperature: 0.7 }, key, url)) {
            fullContent += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          if (!optimize && !analyze && projectId) {
            if (isLocalBackendEnabled()) {
              createChatMessage(projectId, userId, "assistant", fullContent);
            } else {
              const supabase = getSupabaseClient();
              await supabase.from("chat_messages").insert({
                project_id: projectId,
                user_id: userId,
                role: "assistant",
                content: fullContent,
              });
            }
          }
        } catch (streamErr) {
          const errMsg = streamErr instanceof Error ? streamErr.message : "Stream error";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
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
