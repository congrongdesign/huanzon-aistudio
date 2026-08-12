import fs from 'fs';
import path from 'path';

export type BackendMode = 'local' | 'lan';
type LegacyBackendMode = BackendMode | 'supabase';
export type LanRole = 'host' | 'client';

export interface RuntimeConfig {
  backendMode?: LegacyBackendMode;
  lanRole?: LanRole;
  lanHostUrl?: string;
  downloadDirectory?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  updatedAt?: string;
}

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) {
    return path.resolve(process.env.LOCAL_DATA_DIR);
  }

  if (process.env.DESKTOP_ENV_PATH) {
    return path.dirname(process.env.DESKTOP_ENV_PATH);
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, '环中AIStudio');
  }

  const home = process.env.HOME || process.cwd();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', '环中AIStudio');
  }
  if (process.platform === 'linux') {
    return path.join(home, '.config', '环中AIStudio');
  }
  return path.join(process.cwd(), '.local-data', '环中AIStudio');
}

function getRuntimeConfigPath(): string {
  if (process.env.RUNTIME_CONFIG_PATH) {
    return path.resolve(process.env.RUNTIME_CONFIG_PATH);
  }
  return path.join(getBaseDataDir(), 'runtime-config.json');
}

function ensureConfigDir(): void {
  fs.mkdirSync(path.dirname(getRuntimeConfigPath()), { recursive: true });
}

export function readRuntimeConfig(): RuntimeConfig {
  try {
    const file = getRuntimeConfigPath();
    if (!fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(text) as RuntimeConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRuntimeConfig(input: RuntimeConfig): RuntimeConfig {
  const current = readRuntimeConfig();
  const merged: RuntimeConfig = {
    ...current,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  ensureConfigDir();
  const file = getRuntimeConfigPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return merged;
}

export function getRuntimeBackendMode(): BackendMode | null {
  const mode = readRuntimeConfig().backendMode;
  if (mode === 'local' || mode === 'lan') return mode;
  // Migrate legacy "supabase" mode to "lan"
  if (mode === 'supabase') return 'lan';
  return null;
}

export function getRuntimeLanRole(): LanRole {
  const role = readRuntimeConfig().lanRole;
  return role === 'client' ? 'client' : 'host';
}

export function getRuntimeLanHostUrl(): string {
  const raw = (readRuntimeConfig().lanHostUrl || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(cleaned)) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

export function getRuntimeDownloadDirectory(): string {
  const raw = (readRuntimeConfig().downloadDirectory || '').trim();
  if (!raw) return '';
  return path.resolve(raw);
}

export function getRuntimeSupabaseCredentials(): {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
} | null {
  const cfg = readRuntimeConfig();
  const url = (cfg.supabaseUrl || '').trim();
  const anonKey = (cfg.supabaseAnonKey || '').trim();
  const serviceRoleKey = (cfg.supabaseServiceRoleKey || '').trim();

  if (!url || !anonKey) return null;
  return {
    url,
    anonKey,
    serviceRoleKey: serviceRoleKey || undefined,
  };
}
