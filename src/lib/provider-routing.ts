"use client";

export type ProviderType = "yunwu" | "grsai" | "codia" | "codiaz" | "custom";

export type RoutedProviderProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyLocal: string;
  type: ProviderType;
};

export type OperationKey =
  | "image.remove_bg"
  | "conversion.pdf_to_ppt";

export type OperationMode = "model" | "tool" | "task";

export type OperationRoute = {
  operation: OperationKey;
  providerId: string;
  enabled: boolean;
  mode: OperationMode;
  modelId?: string;
  updatedAt: string;
};

export type OperationDefinition = {
  key: OperationKey;
  label: string;
  hint: string;
  mode: OperationMode;
  requiresModel?: boolean;
  supportedProviderTypes?: ProviderType[];
};

export type ResolvedOperationRoute = {
  operation: OperationKey;
  enabled: boolean;
  mode: OperationMode;
  providerId?: string;
  providerName?: string;
  providerType?: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId?: string;
  bound: boolean;
};

export const STORAGE_OPERATION_ROUTES = "hz_operation_routes_v1";

export const OPERATION_ROUTE_DEFINITIONS: OperationDefinition[] = [
  {
    key: "image.remove_bg",
    label: "去背景",
    hint: "画布去背景走独立服务商和模型。",
    mode: "model",
    requiresModel: true,
  },
  {
    key: "conversion.pdf_to_ppt",
    label: "转 PPT",
    hint: "转换中心图片/PDF 转 PPT 任务。",
    mode: "task",
    supportedProviderTypes: ["codia"],
  },
];

function normalizeOperationKey(value: unknown): OperationKey | null {
  if (value === "image.remove_bg" || value === "conversion.pdf_to_ppt") return value;
  return null;
}

function normalizeMode(value: unknown): OperationMode | null {
  if (value === "model" || value === "tool" || value === "task") return value;
  return null;
}

export function normalizeOperationRoutes(value: unknown): OperationRoute[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const routes: OperationRoute[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const operation = normalizeOperationKey(obj.operation);
    const providerId = typeof obj.providerId === "string" ? obj.providerId.trim() : "";
    if (!operation || !providerId) continue;
    const seenKey = `${operation}|${providerId}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    const definition = OPERATION_ROUTE_DEFINITIONS.find((entry) => entry.key === operation);
    routes.push({
      operation,
      providerId,
      enabled: obj.enabled !== false,
      mode: normalizeMode(obj.mode) || definition?.mode || "tool",
      modelId: typeof obj.modelId === "string" && obj.modelId.trim() ? obj.modelId.trim() : undefined,
      updatedAt: typeof obj.updatedAt === "string" && obj.updatedAt.trim() ? obj.updatedAt : new Date().toISOString(),
    });
  }
  return routes;
}

export function readStoredOperationRoutes(): OperationRoute[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeOperationRoutes(JSON.parse(localStorage.getItem(STORAGE_OPERATION_ROUTES) || "[]"));
  } catch {
    return [];
  }
}

export function persistStoredOperationRoutes(routes: OperationRoute[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_OPERATION_ROUTES, JSON.stringify(routes));
  } catch {
    // ignore storage failures
  }
}

export function upsertOperationRoute(
  routes: OperationRoute[],
  nextRoute: OperationRoute,
): OperationRoute[] {
  const filtered = routes.filter((route) => route.operation !== nextRoute.operation);
  return [...filtered, nextRoute];
}

export function getOperationRoute(routes: OperationRoute[], operation: OperationKey): OperationRoute | null {
  return routes.find((route) => route.operation === operation) || null;
}

type ResolveOperationRouteInput = {
  operation: OperationKey;
  routes: OperationRoute[];
  providers: RoutedProviderProfile[];
  providerApiKeyFallbacks?: Partial<Record<ProviderType, string>>;
  fallback?: Partial<ResolvedOperationRoute>;
};

function cleanBaseUrl(value?: string | null) {
  return (value || "").trim().replace(/\/+$/, "");
}

export function resolveOperationRoute(input: ResolveOperationRouteInput): ResolvedOperationRoute | null {
  const route = getOperationRoute(input.routes, input.operation);
  const provider = route ? input.providers.find((item) => item.id === route.providerId) || null : null;
  if (route && provider) {
    const fallbackKey = input.providerApiKeyFallbacks?.[provider.type] || "";
    return {
      operation: input.operation,
      enabled: route.enabled,
      mode: route.mode,
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      baseUrl: cleanBaseUrl(provider.baseUrl),
      apiKey: (provider.apiKeyLocal || fallbackKey).trim(),
      modelId: route.modelId,
      bound: true,
    };
  }
  if (!input.fallback) return null;
  return {
    operation: input.operation,
    enabled: input.fallback.enabled !== false,
    mode: input.fallback.mode || "tool",
    providerId: input.fallback.providerId,
    providerName: input.fallback.providerName,
    providerType: input.fallback.providerType,
    baseUrl: cleanBaseUrl(input.fallback.baseUrl),
    apiKey: (input.fallback.apiKey || "").trim(),
    modelId: input.fallback.modelId,
    bound: false,
  };
}
