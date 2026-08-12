export type OperationErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_4XX"
  | "UPSTREAM_5XX"
  | "POLICY_VIOLATION"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export type NormalizedOperationError = {
  code: OperationErrorCode;
  message: string;
  status: number;
  retryable: boolean;
};

function statusForCode(code: OperationErrorCode): number {
  if (code === "BAD_REQUEST") return 400;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "RATE_LIMITED") return 429;
  if (code === "UPSTREAM_TIMEOUT") return 504;
  if (code === "UPSTREAM_4XX") return 502;
  if (code === "UPSTREAM_5XX") return 502;
  if (code === "POLICY_VIOLATION") return 422;
  if (code === "NETWORK_ERROR") return 502;
  return 500;
}

function isRetryable(code: OperationErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "UPSTREAM_TIMEOUT" || code === "UPSTREAM_5XX" || code === "NETWORK_ERROR";
}

function includesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function normalizeByText(text: string): OperationErrorCode | null {
  if (!text) return null;

  if (includesAny(text, ["rate limit", "too many requests", "429", "请求过于频繁", "限流"])) {
    return "RATE_LIMITED";
  }

  if (includesAny(text, ["timed out", "timeout", "etimedout", "超时"])) {
    return "UPSTREAM_TIMEOUT";
  }

  if (includesAny(text, ["violation", "policy", "safety", "审核", "违规", "敏感"])) {
    return "POLICY_VIOLATION";
  }

  if (includesAny(text, ["fetch failed", "network", "econn", "enotfound", "socket hang up", "网络"])) {
    return "NETWORK_ERROR";
  }

  if (includesAny(text, ["unauthorized", "forbidden", "api key", "未登录", "无权限", "未授权"])) {
    return "UNAUTHORIZED";
  }

  if (includesAny(text, ["missing", "required", "invalid", "缺少", "不能为空", "参数", "格式错误"])) {
    return "BAD_REQUEST";
  }

  return null;
}

export function normalizeOperationError(input: {
  message?: string | null;
  status?: number;
  upstreamStatus?: number;
  fallbackMessage?: string;
}): NormalizedOperationError {
  const message = (input.message || input.fallbackMessage || "请求失败").trim();
  const text = message.toLowerCase();

  let code: OperationErrorCode | null = normalizeByText(text);

  const status = Number(input.status);
  const upstreamStatus = Number(input.upstreamStatus);

  if (!code && Number.isFinite(status)) {
    if (status === 400) code = "BAD_REQUEST";
    else if (status === 401 || status === 403) code = "UNAUTHORIZED";
    else if (status === 429) code = "RATE_LIMITED";
    else if (status === 408 || status === 504) code = "UPSTREAM_TIMEOUT";
    else if (status >= 500) code = "UPSTREAM_5XX";
  }

  if (!code && Number.isFinite(upstreamStatus)) {
    if (upstreamStatus === 429) code = "RATE_LIMITED";
    else if (upstreamStatus === 408 || upstreamStatus === 504) code = "UPSTREAM_TIMEOUT";
    else if (upstreamStatus >= 500) code = "UPSTREAM_5XX";
    else if (upstreamStatus >= 400) code = "UPSTREAM_4XX";
  }

  if (!code) code = "UNKNOWN";

  return {
    code,
    message,
    status: Number.isFinite(status) ? status : statusForCode(code),
    retryable: isRetryable(code),
  };
}

export function toOperationErrorPayload(error: NormalizedOperationError): {
  error: string;
  errorCode: OperationErrorCode;
  retryable: boolean;
} {
  return {
    error: error.message,
    errorCode: error.code,
    retryable: error.retryable,
  };
}

export function toOperationErrorLog(error: NormalizedOperationError): string {
  return `[${error.code}] ${error.message}`;
}
