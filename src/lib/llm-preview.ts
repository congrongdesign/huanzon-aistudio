export type LlmRequestPreviewMessageContentItem = {
  type: string;
  text?: string;
  image_url?: { url: string };
};

export type LlmRequestPreviewMessage = {
  role: string;
  content: string | LlmRequestPreviewMessageContentItem[];
};

export type LlmGenerationRequestPreview = {
  index: number;
  prompt: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  endpoint?: string;
  size?: string;
  imageSize?: string;
  referenceImages: string[];
  requestBody?: Record<string, unknown>;
};

export type LlmRequestPreview = {
  requestId: string;
  source: "chat" | "agent-chat" | "grsai-chat" | "chat-completions" | string;
  model: string;
  baseUrl: string;
  temperature?: number;
  stream: boolean;
  apiKey: string;
  rawInput?: string;
  referenceImageUrls: string[];
  messages: LlmRequestPreviewMessage[];
  generationRequests?: LlmGenerationRequestPreview[];
  note?: string;
  createdAt: string;
};

const STORAGE_KEY = "hz_llm_request_preview_v1";
const CHAT_STORAGE_KEY = "hz_chat_request_preview_v1";

export function redactSecret(value?: string | null): string {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.length <= 8) return `${clean.slice(0, 2)}***`;
  return `${clean.slice(0, 4)}***${clean.slice(-4)}`;
}

function normalizeUrls(urls?: string[] | null): string[] {
  return Array.from(new Set((urls || []).filter((url): url is string => typeof url === "string" && url.trim().length > 0).map((url) => url.trim())));
}

export function createLlmRequestPreview(input: {
  requestId?: string;
  source: LlmRequestPreview["source"];
  model: string;
  baseUrl?: string;
  temperature?: number;
  stream?: boolean;
  apiKey?: string;
  rawInput?: string;
  messages: LlmRequestPreviewMessage[];
  referenceImageUrls?: string[] | null;
  generationRequests?: LlmGenerationRequestPreview[] | null;
  note?: string;
}): LlmRequestPreview {
  const preview: LlmRequestPreview = {
    requestId: input.requestId || crypto.randomUUID(),
    source: input.source,
    model: input.model,
    baseUrl: (input.baseUrl || "").trim(),
    temperature: input.temperature,
    stream: input.stream !== false,
    apiKey: redactSecret(input.apiKey),
    referenceImageUrls: normalizeUrls(input.referenceImageUrls),
    messages: JSON.parse(JSON.stringify(input.messages || [])) as LlmRequestPreviewMessage[],
    generationRequests: Array.isArray(input.generationRequests)
      ? JSON.parse(JSON.stringify(input.generationRequests)) as LlmGenerationRequestPreview[]
      : undefined,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  const cleanRawInput = String(input.rawInput || "").trim();
  if (cleanRawInput) preview.rawInput = cleanRawInput;
  return preview;
}

export function createGenerationLlmRequestPreview(input: {
  requestId?: string;
  generation: LlmGenerationRequestPreview;
  note?: string;
}): LlmRequestPreview {
  const generation = JSON.parse(JSON.stringify(input.generation)) as LlmGenerationRequestPreview;
  generation.apiKey = redactSecret(generation.apiKey);
  return {
    requestId: input.requestId || crypto.randomUUID(),
    source: "image-generation",
    model: generation.model,
    baseUrl: generation.baseUrl,
    stream: false,
    apiKey: generation.apiKey,
    referenceImageUrls: normalizeUrls(generation.referenceImages),
    messages: [],
    generationRequests: [generation],
    note: input.note || "实际提交给生图模型的请求",
    createdAt: new Date().toISOString(),
  };
}

export function saveLatestLlmRequestPreview(preview: LlmRequestPreview | null | undefined) {
  if (typeof window === "undefined" || !preview) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preview));
  } catch {
    // Ignore storage failures.
  }
}

export function loadLatestLlmRequestPreview(): LlmRequestPreview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LlmRequestPreview;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLatestChatRequestPreview(preview: LlmRequestPreview | null | undefined) {
  if (typeof window === "undefined" || !preview) return;
  try {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(preview));
  } catch {
    // Ignore storage failures.
  }
}

export function loadLatestChatRequestPreview(): LlmRequestPreview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LlmRequestPreview;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formatLlmRequestPreview(preview: LlmRequestPreview): string {
  return JSON.stringify(preview, null, 2);
}
