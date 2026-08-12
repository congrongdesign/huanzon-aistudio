export type CodiaEnvelope<T = unknown> = {
  code?: number;
  message?: string;
  data?: T;
  [key: string]: unknown;
};

type CodiaRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  apiKey?: string | null;
  baseUrl?: string | null;
};

export class CodiaApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "CodiaApiError";
    this.status = status;
    this.details = details;
  }
}

export function getCodiaApiKey() {
  return (
    process.env.CODIA_API_KEY ||
    process.env.CODIA_OPEN_API_KEY ||
    process.env.NEXT_PRIVATE_CODIA_API_KEY ||
    ""
  ).trim();
}

export function hasCodiaApiKey() {
  return Boolean(getCodiaApiKey());
}

export function getCodiaApiKeyFromHeaders(headers: Headers) {
  return (headers.get("x-codia-api-key") || "").trim();
}

export function getCodiaBaseUrlFromHeaders(headers: Headers) {
  return (headers.get("x-codia-base-url") || "").trim();
}

function codiaBaseUrl(baseUrl?: string | null) {
  return (baseUrl || process.env.CODIA_BASE_URL || "https://api.codia.ai")
    .replace(/\/+$/, "")
    .replace(/\/v2\/open(?:\/.*)?$/i, "");
}

function buildUrl(path: string, baseUrl?: string | null) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${codiaBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

async function parseCodiaResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<CodiaEnvelope>;
  }
  const text = await response.text();
  return { code: response.ok ? 0 : response.status, message: text, data: null };
}

export async function codiaRequest<T = unknown>(
  path: string,
  options: CodiaRequestOptions = {},
): Promise<CodiaEnvelope<T>> {
  const apiKey = (options.apiKey || "").trim() || getCodiaApiKey();
  if (!apiKey) {
    throw new CodiaApiError("Codia API Key 未配置", 401);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...(options.headers || {}),
  };

  const init: RequestInit = {
    method: options.method || "GET",
    headers,
    signal: controller.signal,
  };

  if (options.body !== undefined) {
    if (isFormDataBody(options.body)) {
      init.body = options.body;
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
  }

  try {
    const response = await fetch(buildUrl(path, options.baseUrl), init);
    const payload = await parseCodiaResponse(response);
    if (!response.ok) {
      throw new CodiaApiError(payload.message || `Codia 请求失败 (${response.status})`, response.status, payload);
    }
    if (typeof payload.code === "number" && payload.code !== 0) {
      throw new CodiaApiError(payload.message || "Codia 返回错误", response.status, payload);
    }
    return payload as CodiaEnvelope<T>;
  } catch (error) {
    if (error instanceof CodiaApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CodiaApiError("Codia 请求超时", 408);
    }
    throw new CodiaApiError(error instanceof Error ? error.message : "Codia 请求失败", 500);
  } finally {
    clearTimeout(timeout);
  }
}

export function getCodiaCredits(apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest("/v2/open/credits", { apiKey, baseUrl });
}

export function getCodiaLimits(apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest("/v2/open/limits", { apiKey, baseUrl });
}

export function getCodiaUsage(query = "", apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest(`/v2/open/usage${query}`, { apiKey, baseUrl });
}

export function listCodiaTasks(query = "", apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest(`/v2/open/tasks${query}`, { apiKey, baseUrl });
}

export function getCodiaTask(taskId: string, apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest(`/v2/open/tasks/${encodeURIComponent(taskId)}`, { apiKey, baseUrl });
}

export function cancelCodiaTask(taskId: string, apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest(`/v2/open/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", apiKey, baseUrl });
}

export function uploadCodiaPdf(buffer: Buffer, fileName: string, apiKey?: string | null, baseUrl?: string | null) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), fileName);
  return codiaRequest("/v2/open/uploads", {
    method: "POST",
    body: form,
    timeoutMs: 180000,
    apiKey,
    baseUrl,
  });
}

export function estimateCodiaPdfToPpt(input: Record<string, unknown>, apiKey?: string | null, baseUrl?: string | null) {
  return codiaRequest("/v2/open/estimate", {
    method: "POST",
    body: { operation: "pdf_to_ppt", input },
    apiKey,
    baseUrl,
  });
}

export function createCodiaPdfToPptTask(
  input: Record<string, unknown>,
  idempotencyKey: string,
  callbackUrl?: string,
  apiKey?: string | null,
  baseUrl?: string | null,
) {
  return codiaRequest("/v2/open/tasks", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: {
      operation: "pdf_to_ppt",
      input,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    },
    apiKey,
    baseUrl,
  });
}
