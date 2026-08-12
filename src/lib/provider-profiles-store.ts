import fs from "fs";
import path from "path";

export type ProviderType = "yunwu" | "grsai" | "codia" | "codiaz" | "custom";

export type ModelProviderProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyLocal: string;
  type: ProviderType;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastDetectedAt?: string;
};

export type ProviderEndpointHistoryItem = {
  id: string;
  name: string;
  baseUrl: string;
  type: ProviderType;
  lastUsedAt: string;
};

export type CapabilityBinding = {
  capability: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  showInPicker: boolean;
  isDefault: boolean;
  updatedAt: string;
};

export type ProviderProfilesStore = {
  profiles: ModelProviderProfile[];
  activeProviderId: string;
  endpointHistory: ProviderEndpointHistoryItem[];
  capabilityBindings?: CapabilityBinding[];
  updatedAt?: string;
};

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) return path.resolve(process.env.LOCAL_DATA_DIR);
  if (process.env.DESKTOP_ENV_PATH) return path.dirname(process.env.DESKTOP_ENV_PATH);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "环中AIStudio");
  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "环中AIStudio");
  if (process.platform === "linux") return path.join(home, ".config", "环中AIStudio");
  return path.join(process.cwd(), ".local-data", "环中AIStudio");
}

function getStorePath(): string {
  return path.join(getBaseDataDir(), "local-data", "provider-profiles.json");
}

function isProviderType(value: unknown): value is ProviderType {
  return value === "yunwu" || value === "grsai" || value === "codia" || value === "codiaz" || value === "custom";
}

function inferProviderType(baseUrl: string, fallback?: unknown): ProviderType {
  if (isProviderType(fallback)) return fallback;
  const raw = baseUrl.toLowerCase();
  if (raw.includes("yunwu") || raw.includes("wlai") || raw.includes("apiplus")) return "yunwu";
  if (raw.includes("grsai") || raw.includes("dakka")) return "grsai";
  if (raw.includes("codia.ai") && !raw.includes("codiaz")) return "codia";
  if (raw.includes("codiaz")) return "codiaz";
  return "custom";
}

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/v1\/?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider";
}

function createProviderId(baseUrl: string, name?: string): string {
  return `provider-${sanitizeIdPart(baseUrl || name || String(Date.now()))}`;
}

function normalizeProfile(value: unknown): ModelProviderProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  if (!baseUrl) return null;
  const now = new Date().toISOString();
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : createProviderId(baseUrl, typeof obj.name === "string" ? obj.name : undefined);
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : sanitizeIdPart(baseUrl);
  return {
    id,
    name,
    baseUrl,
    apiKeyLocal: typeof obj.apiKeyLocal === "string" ? obj.apiKeyLocal : typeof obj.apiKey === "string" ? obj.apiKey : "",
    type: inferProviderType(baseUrl, obj.type),
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : now,
    lastDetectedAt: typeof obj.lastDetectedAt === "string" ? obj.lastDetectedAt : undefined,
  };
}

function normalizeProfiles(value: unknown): ModelProviderProfile[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: ModelProviderProfile[] = [];
  for (const item of raw) {
    const profile = normalizeProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    result.push(profile);
  }
  return result;
}

function normalizeEndpointHistory(value: unknown, profiles: ModelProviderProfile[]): ProviderEndpointHistoryItem[] {
  const raw = Array.isArray(value) ? value : [];
  const now = new Date().toISOString();
  const byUrl = new Map<string, ProviderEndpointHistoryItem>();
  const add = (item: Partial<ProviderEndpointHistoryItem>) => {
    const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl.trim() : "";
    if (!baseUrl) return;
    const key = baseUrl.replace(/\/+$/, "").toLowerCase();
    const existing = byUrl.get(key);
    const next: ProviderEndpointHistoryItem = {
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : createProviderId(baseUrl, item.name),
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : sanitizeIdPart(baseUrl),
      baseUrl,
      type: inferProviderType(baseUrl, item.type),
      lastUsedAt: typeof item.lastUsedAt === "string" ? item.lastUsedAt : now,
    };
    if (!existing || new Date(next.lastUsedAt).getTime() >= new Date(existing.lastUsedAt).getTime()) {
      byUrl.set(key, next);
    }
  };
  for (const item of raw) {
    if (item && typeof item === "object" && !Array.isArray(item)) add(item as Partial<ProviderEndpointHistoryItem>);
  }
  for (const profile of profiles) {
    add({ id: profile.id, name: profile.name, baseUrl: profile.baseUrl, type: profile.type, lastUsedAt: profile.updatedAt || now });
  }
  return Array.from(byUrl.values())
    .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
    .slice(0, 24);
}

function normalizeCapabilityBindings(value: unknown): CapabilityBinding[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: CapabilityBinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const capability = typeof obj.capability === "string" ? obj.capability.trim() : "";
    const providerId = typeof obj.providerId === "string" ? obj.providerId.trim() : "";
    const modelId = typeof obj.modelId === "string" ? obj.modelId.trim() : "";
    if (!capability || !providerId || !modelId) continue;
    const key = `${capability}|${providerId}|${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      capability,
      providerId,
      modelId,
      enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
      showInPicker: typeof obj.showInPicker === "boolean" ? obj.showInPicker : true,
      isDefault: typeof obj.isDefault === "boolean" ? obj.isDefault : false,
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    });
  }
  return result;
}

export function normalizeProviderProfilesStore(value: unknown): ProviderProfilesStore {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const profiles = normalizeProfiles(obj.profiles);
  const activeProviderId = typeof obj.activeProviderId === "string" && profiles.some((profile) => profile.id === obj.activeProviderId) ? obj.activeProviderId : profiles[0]?.id || "";
  return {
    profiles,
    activeProviderId,
    endpointHistory: normalizeEndpointHistory(obj.endpointHistory, profiles),
    capabilityBindings: normalizeCapabilityBindings(obj.capabilityBindings),
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
  };
}

export function readProviderProfilesStore(): ProviderProfilesStore {
  try {
    const file = getStorePath();
    if (!fs.existsSync(file)) return { profiles: [], activeProviderId: "", endpointHistory: [], capabilityBindings: [] };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return normalizeProviderProfilesStore(parsed);
  } catch {
    return { profiles: [], activeProviderId: "", endpointHistory: [], capabilityBindings: [] };
  }
}

export function writeProviderProfilesStore(input: Partial<ProviderProfilesStore>): ProviderProfilesStore {
  const current = readProviderProfilesStore();
  const merged = normalizeProviderProfilesStore({
    profiles: input.profiles ?? current.profiles,
    activeProviderId: input.activeProviderId ?? current.activeProviderId,
    endpointHistory: input.endpointHistory ?? current.endpointHistory,
    capabilityBindings: input.capabilityBindings ?? current.capabilityBindings,
    updatedAt: new Date().toISOString(),
  });
  const file = getStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(merged, null, 2), "utf8");
  fs.renameSync(`${file}.tmp`, file);
  return merged;
}
