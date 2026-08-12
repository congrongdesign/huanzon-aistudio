import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { executeGeneration } from "@/lib/generate-core";
import { getReferenceImageLimitForModel } from "@/lib/image-edit/reference-constants";
import { refreshReferenceUrls } from "@/lib/image-edit/reference-prep";
import {
  createChatMessage,
  isLocalBackendEnabled,
  listChatMessages,
  patchChatMessage,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const SYSTEM_PROMPT = `你是环中AIStudio的 AI 设计助手，集成了 ChatGPT Image 2.0 (gpt-image-2) 和 Nano Banana 系列图像生成模型。

⚠️ 最重要的规则：严格使用用户的原始提示词生图，不要擅自改写、扩写或优化！

生图规则：
- 当用户明确要求生图时，直接用 [GENERATE:用户的原文] 标记，原样保留用户的要求
- 用户提到的比例、风格、颜色、构图等要求必须完整保留
- 如果用户附带参考图片，在提示词中加上"参考用户提供的图片"
- 一次只生成一个方案，用一个 [GENERATE:用户的原文] 标记
- 除非用户明确要求多个方案，否则不要生成多个
- 用户只是提问或闲聊时，正常回复，不加 [GENERATE] 标记`;

const DESIGN_AGENT_PROMPT = `你是环中AIStudio里的“设计执行 Agent”，不是代码开发 Agent，也不是 Codex。

你的任务是在这个设计平台里帮用户完成真实设计工作：
- 理解用户的设计目标、风格、用途、参考图和当前画布上下文
- 自动拆解任务，但不要停留在建议层面，要尽量直接执行
- 需要出图时，使用 [GENERATE:详细生图提示词] 标记，平台会自动调用生图模型并把结果加入画布
- 如果用户要多个方向、多个方案、四宫格、风格探索，你可以输出多个 [GENERATE:...]，每个标记对应一个方案
- 如果用户提供参考图，生成提示词里必须明确“参考用户提供的图片”，并说明要继承的风格、构图、色彩或素材关系
- 如果用户选择了画布图片作为引用，要基于这些图片继续做设计延展、改版、统一风格或系列化
- 不要说自己会修改代码、运行命令、读写项目文件；你只操作设计平台能力
- 不要让用户自己去做复杂配置；如果缺 API Key，只提示去“设置”里配置模型 Key
- 回复要简洁，先说明执行思路，再输出生成任务

输出规范：
- 需要生成图片时，先用一两句话说明方案，然后立刻输出 [GENERATE:...] 标记
- [GENERATE:...] 里的提示词要足够完整，包含主体、场景、风格、构图、色彩、材质、画面质量、文字保留要求等
- 不要把无关解释放进 [GENERATE:...] 里
- 如果用户只是问如何做，可以给步骤；如果用户说“帮我做/生成/设计/出方案”，必须执行生成`;

function cleanApiKey(key: string): string {
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

function cleanBaseUrl(url: string): string {
  const base = (url || "https://grsaiapi.com").replace(/\/+$/, "");
  if (base.endsWith("/v1")) return base.slice(0, -3);
  return base;
}

function buildApiUrl(base: string): string {
  return `${cleanBaseUrl(base)}/v1/chat/completions`;
}

async function loadHistory(projectId: string, userId?: string, limit = 30) {
  if (isLocalBackendEnabled()) {
    return listChatMessages(projectId, userId, limit, true);
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("chat_messages")
    .select("id, role, content, reference_image_urls, image_url, created_at")
    .eq("project_id", projectId);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.reverse();
}

async function saveMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string,
  userId?: string,
  referenceImageUrls?: string[],
  imageUrl?: string,
) {
  if (isLocalBackendEnabled()) {
    return createChatMessage(projectId, userId || null, role, content, referenceImageUrls, imageUrl || null);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      project_id: projectId,
      user_id: userId || null,
      role,
      content,
      reference_image_urls: referenceImageUrls ? JSON.stringify(referenceImageUrls) : null,
      image_url: imageUrl || null,
    })
    .select()
    .single();

  if (error) {
    console.error("[agent-chat] Failed to save message:", error.message);
    return null;
  }
  return data;
}

async function updateMessageImageUrl(messageId: string, imageUrl: string) {
  if (isLocalBackendEnabled()) {
    patchChatMessage(messageId, { image_url: imageUrl });
    return;
  }
  const supabase = getSupabaseClient();
  await supabase
    .from("chat_messages")
    .update({ image_url: imageUrl })
    .eq("id", messageId);
}

function buildLLMMessages(
  history: Array<{ role: string; content: string; reference_image_urls?: string | null }>,
  newMessage: string,
  referenceImageUrls?: string[],
  options?: {
    agentMode?: boolean;
    canvasImages?: Array<{ id?: string; prompt?: string; size?: string; model?: string; status?: string }>;
    imageCount?: number;
    imageModel?: string;
  },
) {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }> = [{
    role: "system",
    content: options?.agentMode
      ? `${DESIGN_AGENT_PROMPT}

当前画布上下文：
${options.canvasImages && options.canvasImages.length > 0
  ? options.canvasImages.slice(0, 40).map((img, index) => `${index + 1}. ${img.size || "未知比例"} | ${img.model || "未知模型"} | ${img.status || "未知状态"} | ${String(img.prompt || "无提示词").slice(0, 160)}`).join("\n")
  : "当前画布暂无可用图片上下文。"}

当前前端设置的生成数量：${Math.max(1, Number(options.imageCount || 1))}。如果用户没有指定多方案，一般按这个数量生成不同方案。`
      : SYSTEM_PROMPT,
  }];

  const imageRefLimit = getReferenceImageLimitForModel(options?.imageModel);

  for (const msg of history) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (msg.role === "user" && msg.reference_image_urls) {
      try {
        const urls: string[] = JSON.parse(msg.reference_image_urls);
        messages.push({
          role: "user",
          content: [
            { type: "text", text: msg.content },
            ...urls.map((url: string) => ({ type: "image_url", image_url: { url } })),
          ],
        });
      } catch {
        messages.push({ role: "user", content: msg.content });
      }
    } else {
      messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
    }
  }

  if (referenceImageUrls && referenceImageUrls.length > 0) {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `${newMessage}\n\n[用户当前输入：${newMessage}]\n[用户附带了${referenceImageUrls.length}张参考图片（当前模型参考图上限：${imageRefLimit} 张）。请逐张分析图片内容，严格保留用户原始要求，并在需要生成时把“参考用户提供的图片”写入生成提示词。]`,
        },
        ...referenceImageUrls.map((url: string) => ({ type: "image_url", image_url: { url } })),
      ],
    });
  } else {
    messages.push({ role: "user", content: newMessage });
  }

  return messages;
}

function parseGenerateTags(content: string): string[] {
  const regex = /\[GENERATE:([^\]]+)\]/g;
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const matchedPrompt = match[1];
    if (matchedPrompt) {
      tags.push(matchedPrompt.trim());
    }
  }
  return tags;
}

function buildGenerationPrompts(tags: string[], requestedCount: number): string[] {
  const count = Math.max(1, Math.min(16, Math.floor(Number(requestedCount) || 1)));
  if (tags.length === 0) return [];
  return Array.from({ length: count }, (_, index) => tags[index % tags.length]);
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    const {
      message,
      projectId,
      referenceImageUrls,
      chatModel,
      apiKey: rawApiKey,
      baseUrl: rawBaseUrl,
      imageModel,
      imageApiKey,
      imageBaseUrl,
      imageAspectRatio,
      imagePixelSize,
      imageCount = 1,
      agentMode = false,
      canvasImages = [],
    } = await request.json();
    const requestedImageCount = Math.max(1, Math.min(16, Math.floor(Number(imageCount) || 1)));

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
    }
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId is required" }), { status: 400 });
    }

    let apiKey = cleanApiKey(rawApiKey || "");
    const baseUrl = cleanBaseUrl(rawBaseUrl || "https://grsaiapi.com");
    const imgApiKey = cleanApiKey(imageApiKey || rawApiKey || "");
    const imgBaseUrl = cleanBaseUrl(imageBaseUrl || rawBaseUrl || "https://grsaiapi.com");
    const model = chatModel || "gpt-4o";
    const effectiveReferenceImageUrls = Array.isArray(referenceImageUrls)
      ? await refreshReferenceUrls(referenceImageUrls)
      : undefined;

    if (!apiKey && isLocalEndpoint(baseUrl)) {
      apiKey = "ollama";
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "请先配置对话 API Key" }), { status: 400 });
    }

    await saveMessage(projectId, "user", message, userId || undefined, effectiveReferenceImageUrls);
    const history = await loadHistory(projectId, userId || undefined);
    const llmMessages = buildLLMMessages(history, message, effectiveReferenceImageUrls, {
      agentMode: Boolean(agentMode),
      canvasImages: Array.isArray(canvasImages) ? canvasImages : [],
      imageCount: requestedImageCount,
      imageModel,
    });

    const apiUrl = buildApiUrl(baseUrl);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";

        try {
          const llmResponse = await fetch(apiUrl, {
            method: "POST",
            headers: (() => {
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
              return headers;
            })(),
            body: JSON.stringify({
              model,
              messages: llmMessages,
              stream: true,
              temperature: 0.2,
            }),
          });

          if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: `API错误 (${llmResponse.status}): ${errorText}` })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
            controller.close();
            return;
          }

          const reader = llmResponse.body?.getReader();
          if (!reader) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: "LLM 响应为空" })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
            controller.close();
            return;
          }

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
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`));
                }
              } catch {
                // ignore
              }
            }
          }

          const savedMsg = await saveMessage(projectId, "assistant", fullContent, userId || undefined);
          const generatePrompts = buildGenerationPrompts(parseGenerateTags(fullContent), requestedImageCount);

          if (generatePrompts.length > 0) {
            generatePrompts.forEach((prompt, index) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "generate_start", prompt, index })}\n\n`));
            });

            await Promise.all(generatePrompts.map(async (prompt, index) => {
              try {
                const generationPrompt = [
                  prompt.trim(),
                  `原始用户要求：${message.trim()}`,
                  referenceImageUrls && referenceImageUrls.length > 0
                    ? `参考图要求：共 ${referenceImageUrls.length} 张参考图，必须逐张分析并继承用户指定的风格、构图、主体关系与色彩逻辑。`
                    : "",
                  "生成约束：严格保留用户原始要求，不要删减关键细节，不要把参考图当成可忽略的装饰。",
                ].filter(Boolean).join("\n\n");
                const genResult = await executeGeneration({
                  prompt: generationPrompt,
                  size: imageAspectRatio || "1:1",
                  apiKey: imgApiKey,
                  baseUrl: imgBaseUrl,
                  model: imageModel || "gpt-image-2",
                  imageSize: imagePixelSize || "1K",
                  projectId,
                  userId: userId || undefined,
                  referenceImages: effectiveReferenceImageUrls || [],
                });

                if (genResult.success && genResult.record) {
                  if (index === 0 && savedMsg?.id && genResult.record.image_url) {
                    await updateMessageImageUrl(savedMsg.id, genResult.record.image_url);
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "generate_complete", image: genResult.record, index })}\n\n`));
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "generate_error", prompt, error: genResult.error || "生图失败", index })}\n\n`));
                }
              } catch (genErr) {
                const errMsg = genErr instanceof Error ? genErr.message : "生图异常";
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "generate_error", prompt, error: errMsg, index })}\n\n`));
              }
            }));
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          } catch {
            // ignore
          }
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
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const history = await loadHistory(projectId, userId || undefined, 100);
    return new Response(JSON.stringify({ messages: history }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
