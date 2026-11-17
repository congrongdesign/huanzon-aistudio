export type ConnectionType = "yunwu" | "grsai" | "codia" | "codiaz" | "custom";
export type ModelConnection = {
  id: string; name: string; baseUrl: string; apiKeyLocal: string; type: ConnectionType;
  enabled: boolean; createdAt: string; updatedAt: string; lastDetectedAt?: string;
};
export type SettingsModel = {
  id: string; displayName?: string; description?: string; category?: string; type?: string;
  capabilities?: string[]; tags?: string[]; supplierName?: string; owned_by?: string; endpoint?: string;
};
export type ModelUse = "image" | "chat" | "imageTool" | "video" | "speech" | "reasoning" | "embedding";
export type SettingsBinding = {
  capability: ModelUse; providerId: string; modelId: string; enabled: boolean;
  showInPicker: boolean; isDefault: boolean; updatedAt: string;
};
export type ModelKind = "image" | "chat" | "video" | "vision" | "audio" | "embedding" | "rerank" | "unknown";
export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  image: "生图", chat: "对话", video: "视频", vision: "视觉理解", audio: "音频",
  embedding: "向量", rerank: "重排序", unknown: "用途待确认",
};
export const MODEL_USE_LABELS: Record<ModelUse, string> = {
  image: "生图", chat: "对话", imageTool: "图像编辑", video: "视频", speech: "语音", reasoning: "思考", embedding: "向量",
};
export function modelConnectionKey(providerId: string, modelId: string) {
  return JSON.stringify([providerId, modelId]);
}
export function commonModelKeys(bindings: SettingsBinding[]) {
  return new Set(bindings.filter(b => b.enabled && b.showInPicker).map(b => modelConnectionKey(b.providerId, b.modelId)));
}
export const SERVICE_PRESETS: { label: string; url: string; type: ConnectionType; hint?: string }[] = [
  { label: "DeepSeek", url: "https://api.deepseek.com/v1", type: "custom" },
  { label: "火山引擎", url: "https://ark.cn-beijing.volces.com/api/v3", type: "custom", hint: "模型 ID 请填写方舟控制台提供的模型名称或接入点 ID（ep- 开头）。若无法读取目录，可手动添加。" },
  { label: "阿里云百炼", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", type: "custom" },
  { label: "硅基流动", url: "https://api.siliconflow.cn/v1", type: "custom" },
  { label: "智谱", url: "https://open.bigmodel.cn/api/paas/v4", type: "custom" },
  { label: "Moonshot", url: "https://api.moonshot.cn/v1", type: "custom" },
  { label: "GRSAI", url: "https://grsaiapi.com", type: "grsai" },
  { label: "本地 Ollama", url: "http://127.0.0.1:11434/v1", type: "custom" },
  { label: "自定义服务", url: "", type: "custom" },
];

// Match hosts rather than provider labels: custom names must not change the destination.
export function serviceWebsite(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    const destinations: [string[], string][] = [
      [["deepseek.com"], "https://platform.deepseek.com/"],
      [["volces.com", "volcengine.com"], "https://console.volcengine.com/ark/"],
      [["aliyuncs.com", "bailian.aliyun.com"], "https://bailian.console.aliyun.com/"],
      [["siliconflow.cn", "siliconflow.com"], "https://cloud.siliconflow.cn/"],
      [["bigmodel.cn"], "https://open.bigmodel.cn/"],
      [["moonshot.cn", "moonshot.ai"], "https://platform.moonshot.cn/"],
      [["grsaiapi.com", "grsai.ai", "grsai.com"], "https://grsai.ai/"],
      [["apinebula.com", "apinebula.ai"], "https://apinebula.com/"],
      [["yunwu.ai"], "https://yunwu.ai/"],
    ];
    for (const [domains, website] of destinations) {
      if (domains.some(domain => host === domain || host.endsWith("." + domain))) return website;
    }
    // Drop the API path and any embedded credentials, query or fragment.
    return url.origin + "/";
  } catch { return null; }
}

// A saved model value is never authorization to use an inactive model.
export function resolveActivatedBinding(bindings: SettingsBinding[], providers: ModelConnection[], capability: ModelUse, selected?: { providerId?: string; modelId: string } | null) {
  const allowed = bindings.filter(b => b.enabled && b.showInPicker && providers.some(p => p.id === b.providerId && p.enabled) && (b.capability === capability || capability === "imageTool" && b.capability === "image"));
  if (selected?.modelId) return allowed.find(b => b.modelId === selected.modelId && (!selected.providerId || b.providerId === selected.providerId)) || null;
  return allowed.find(b => b.capability === capability && b.isDefault) || allowed.find(b => b.capability === capability) || allowed.find(b => b.isDefault) || allowed[0] || null;
}

export function validateConnection(baseUrl: string, apiKey: string) {
  let url: URL;
  try { url = new URL(baseUrl.trim()); } catch { return { field: "baseUrl", message: "请输入完整的 API 地址，例如 https://api.example.com" }; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return { field: "baseUrl", message: "请使用 http 或 https 地址，密钥请填写在 API Key 中。" };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && !apiKey.trim()) return { field: "apiKeyLocal", message: "请粘贴服务提供的 API Key。本地服务可留空。" };
  return null;
}
export function connectionError(message: string) {
  if (/401|unauthorized|invalid.*key|密钥|认证/i.test(message)) return "密钥未通过验证，请检查 API Key 是否正确、是否已过期。";
  if (/403|forbidden/i.test(message)) return "服务拒绝了访问，请检查密钥权限或服务账号状态。";
  if (/timeout|timed out|超时|aborted/i.test(message)) return "连接超时，请检查 API 地址和网络后重试。";
  if (/404|not found/i.test(message)) return "未找到模型列表接口，请核对 API 地址；也可以手动添加模型。";
  if (/429|rate.limit/i.test(message)) return "请求过于频繁，请稍后重试。";
  return "暂时无法获取模型，请检查地址或网络；也可以手动添加模型。";
}

// Keep existing callers and the new editor on the same write queue: a delayed old
// request must never overwrite a later explicit save. Payloads never enter logs.
let profileWriteQueue: Promise<unknown> = Promise.resolve();
export function saveConnectionStore(payload: unknown) {
  const snapshot = JSON.stringify(payload);
  const request = profileWriteQueue.catch(() => undefined).then(async () => {
    const response = await fetch("/api/provider-profiles", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: snapshot,
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error("配置未能写入本机，请重试。");
    return result;
  });
  profileWriteQueue = request;
  return request;
}
