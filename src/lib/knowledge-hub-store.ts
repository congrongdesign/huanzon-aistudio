import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

export type KnowledgeSource = 'nas' | 'local' | 'feishu';
export type KnowledgeKind = 'text' | 'image' | 'doc' | 'link';
export type AssetPackSource = KnowledgeSource | 'mixed';

export interface KnowledgeHubConfig {
  nas: {
    enabled: boolean;
    rootPath: string;
    recursive: boolean;
    maxFiles: number;
    includeHidden: boolean;
  };
  feishu: {
    enabled: boolean;
    baseUrl: string;
    appId: string;
    appSecret: string;
    spaceIds: string[];
    maxNodes: number;
    includeDocContent: boolean;
  };
  updatedAt?: string;
}

export interface KnowledgeHubConfigPatch {
  nas?: Partial<KnowledgeHubConfig['nas']>;
  feishu?: Partial<KnowledgeHubConfig['feishu']>;
}

export interface KnowledgeHubItem {
  id: string;
  source: KnowledgeSource;
  kind: KnowledgeKind;
  title: string;
  location: string;
  externalId: string;
  url?: string;
  textSnippet?: string;
  contentPreview?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  size?: number;
  updatedAt?: string;
  createdAt?: string;
}

export interface KnowledgeHubIndex {
  items: KnowledgeHubItem[];
  updatedAt?: string;
}

export interface ProjectAssetPack {
  id: string;
  projectId: string;
  name: string;
  source: AssetPackSource;
  description?: string;
  rootPath?: string;
  folderKey?: string;
  feishuSpaceIds?: string[];
  color?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface ProjectAssetPackInput {
  projectId: string;
  name?: string;
  source?: AssetPackSource;
  description?: string;
  rootPath?: string;
  folderKey?: string;
  feishuSpaceIds?: string[];
  color?: string;
}

interface ProjectAssetPackStore {
  packs: ProjectAssetPack[];
  updatedAt?: string;
}

const APP_NAME = '环中AIStudio';
const CONFIG_FILE = 'knowledge-hub-config.json';
const INDEX_FILE = 'knowledge-hub-index.json';
const PACKS_FILE = 'knowledge-hub-packs.json';

const DEFAULT_CONFIG: KnowledgeHubConfig = {
  nas: {
    enabled: false,
    rootPath: '',
    recursive: true,
    maxFiles: 800,
    includeHidden: false,
  },
  feishu: {
    enabled: false,
    baseUrl: 'https://open.feishu.cn',
    appId: '',
    appSecret: '',
    spaceIds: [],
    maxNodes: 300,
    includeDocContent: true,
  },
};

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) {
    return path.resolve(process.env.LOCAL_DATA_DIR);
  }

  if (process.env.DESKTOP_ENV_PATH) {
    return path.dirname(process.env.DESKTOP_ENV_PATH);
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_NAME);
  }

  const home = process.env.HOME || process.cwd();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  }
  if (process.platform === 'linux') {
    return path.join(home, '.config', APP_NAME);
  }
  return path.join(process.cwd(), '.local-data', APP_NAME);
}

function getStoreRoot(): string {
  return path.join(getBaseDataDir(), 'knowledge-hub');
}

function getConfigPath(): string {
  return path.join(getStoreRoot(), CONFIG_FILE);
}

function getIndexPath(): string {
  return path.join(getStoreRoot(), INDEX_FILE);
}

function getPacksPath(): string {
  return path.join(getStoreRoot(), PACKS_FILE);
}

function ensureStoreDir(): void {
  fs.mkdirSync(getStoreRoot(), { recursive: true });
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(file: string, value: T): void {
  ensureStoreDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function normalizeSpaceIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function normalizeAssetPackSource(input: unknown): AssetPackSource {
  if (input === 'nas' || input === 'local' || input === 'feishu' || input === 'mixed') return input;
  return 'nas';
}

function normalizeAssetPackName(input: unknown, fallback = '项目素材包'): string {
  const value = typeof input === 'string' ? input.trim() : '';
  return value || fallback;
}

function normalizeOptionalString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  return value || undefined;
}

function createPackId(): string {
  try {
    return randomUUID();
  } catch {
    return createHash('sha1').update(`${Date.now()}:${Math.random()}`).digest('hex');
  }
}

export function getDefaultKnowledgeHubConfig(): KnowledgeHubConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as KnowledgeHubConfig;
}

export function readKnowledgeHubConfig(): KnowledgeHubConfig {
  const cfg = readJsonFile<Partial<KnowledgeHubConfig>>(getConfigPath(), {});
  return {
    nas: {
      enabled: cfg.nas?.enabled ?? DEFAULT_CONFIG.nas.enabled,
      rootPath: (cfg.nas?.rootPath || DEFAULT_CONFIG.nas.rootPath).trim(),
      recursive: cfg.nas?.recursive ?? DEFAULT_CONFIG.nas.recursive,
      maxFiles: Number.isFinite(cfg.nas?.maxFiles)
        ? Math.max(50, Math.min(5000, Number(cfg.nas?.maxFiles)))
        : DEFAULT_CONFIG.nas.maxFiles,
      includeHidden: cfg.nas?.includeHidden ?? DEFAULT_CONFIG.nas.includeHidden,
    },
    feishu: {
      enabled: cfg.feishu?.enabled ?? DEFAULT_CONFIG.feishu.enabled,
      baseUrl: (cfg.feishu?.baseUrl || DEFAULT_CONFIG.feishu.baseUrl).trim() || DEFAULT_CONFIG.feishu.baseUrl,
      appId: (cfg.feishu?.appId || '').trim(),
      appSecret: (cfg.feishu?.appSecret || '').trim(),
      spaceIds: normalizeSpaceIds(cfg.feishu?.spaceIds),
      maxNodes: Number.isFinite(cfg.feishu?.maxNodes)
        ? Math.max(50, Math.min(3000, Number(cfg.feishu?.maxNodes)))
        : DEFAULT_CONFIG.feishu.maxNodes,
      includeDocContent: cfg.feishu?.includeDocContent ?? DEFAULT_CONFIG.feishu.includeDocContent,
    },
    updatedAt: cfg.updatedAt,
  };
}

export function writeKnowledgeHubConfig(patch: KnowledgeHubConfigPatch): KnowledgeHubConfig {
  const current = readKnowledgeHubConfig();
  const next: KnowledgeHubConfig = {
    nas: {
      ...current.nas,
      ...(patch.nas || {}),
      rootPath: ((patch.nas?.rootPath ?? current.nas.rootPath) || '').trim(),
      maxFiles: Number.isFinite(patch.nas?.maxFiles)
        ? Math.max(50, Math.min(5000, Number(patch.nas?.maxFiles)))
        : current.nas.maxFiles,
    },
    feishu: {
      ...current.feishu,
      ...(patch.feishu || {}),
      baseUrl: ((patch.feishu?.baseUrl ?? current.feishu.baseUrl) || '').trim() || DEFAULT_CONFIG.feishu.baseUrl,
      appId: ((patch.feishu?.appId ?? current.feishu.appId) || '').trim(),
      appSecret: ((patch.feishu?.appSecret ?? current.feishu.appSecret) || '').trim(),
      spaceIds: patch.feishu?.spaceIds ? normalizeSpaceIds(patch.feishu.spaceIds) : current.feishu.spaceIds,
      maxNodes: Number.isFinite(patch.feishu?.maxNodes)
        ? Math.max(50, Math.min(3000, Number(patch.feishu?.maxNodes)))
        : current.feishu.maxNodes,
      includeDocContent: patch.feishu?.includeDocContent ?? current.feishu.includeDocContent,
    },
    updatedAt: new Date().toISOString(),
  };

  writeJsonFile(getConfigPath(), next);
  return next;
}

export function readKnowledgeHubIndex(): KnowledgeHubIndex {
  const raw = readJsonFile<Partial<KnowledgeHubIndex>>(getIndexPath(), {});
  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    updatedAt: raw.updatedAt,
  };
}

function readProjectAssetPackStore(): ProjectAssetPackStore {
  const raw = readJsonFile<Partial<ProjectAssetPackStore>>(getPacksPath(), {});
  const packs = Array.isArray(raw.packs)
    ? raw.packs
        .filter((pack) => pack && typeof pack === 'object')
        .map((pack) => {
          const item = pack as Partial<ProjectAssetPack>;
          const now = new Date().toISOString();
          return {
            id: normalizeOptionalString(item.id) || createPackId(),
            projectId: normalizeOptionalString(item.projectId) || 'default',
            name: normalizeAssetPackName(item.name),
            source: normalizeAssetPackSource(item.source),
            description: normalizeOptionalString(item.description),
            rootPath: normalizeOptionalString(item.rootPath),
            folderKey: normalizeOptionalString(item.folderKey),
            feishuSpaceIds: normalizeSpaceIds(item.feishuSpaceIds),
            color: normalizeOptionalString(item.color),
            createdAt: normalizeOptionalString(item.createdAt) || now,
            updatedAt: normalizeOptionalString(item.updatedAt) || now,
            lastOpenedAt: normalizeOptionalString(item.lastOpenedAt),
          } satisfies ProjectAssetPack;
        })
    : [];

  return {
    packs,
    updatedAt: raw.updatedAt,
  };
}

function writeProjectAssetPackStore(packs: ProjectAssetPack[]): ProjectAssetPackStore {
  const payload: ProjectAssetPackStore = {
    packs,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(getPacksPath(), payload);
  return payload;
}

export function listProjectAssetPacks(projectId?: string): ProjectAssetPack[] {
  const store = readProjectAssetPackStore();
  const project = (projectId || '').trim();
  const packs = project ? store.packs.filter((pack) => pack.projectId === project) : store.packs;
  return packs.sort((a, b) => {
    const aTime = Date.parse(a.lastOpenedAt || a.updatedAt || a.createdAt || '') || 0;
    const bTime = Date.parse(b.lastOpenedAt || b.updatedAt || b.createdAt || '') || 0;
    return bTime - aTime;
  });
}

export function getProjectAssetPackById(id: string): ProjectAssetPack | null {
  const packId = id.trim();
  if (!packId) return null;
  return readProjectAssetPackStore().packs.find((pack) => pack.id === packId) || null;
}

export function createProjectAssetPack(input: ProjectAssetPackInput): ProjectAssetPack {
  const projectId = input.projectId.trim();
  if (!projectId) throw new Error('projectId is required');

  const now = new Date().toISOString();
  const source = normalizeAssetPackSource(input.source);
  const pack: ProjectAssetPack = {
    id: createPackId(),
    projectId,
    name: normalizeAssetPackName(input.name, source === 'feishu' ? '飞书素材包' : '项目素材包'),
    source,
    description: normalizeOptionalString(input.description),
    rootPath: normalizeOptionalString(input.rootPath),
    folderKey: normalizeOptionalString(input.folderKey),
    feishuSpaceIds: normalizeSpaceIds(input.feishuSpaceIds),
    color: normalizeOptionalString(input.color),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };

  const store = readProjectAssetPackStore();
  writeProjectAssetPackStore([pack, ...store.packs]);
  return pack;
}

export function updateProjectAssetPack(id: string, patch: Partial<ProjectAssetPackInput>): ProjectAssetPack {
  const packId = id.trim();
  if (!packId) throw new Error('id is required');

  const store = readProjectAssetPackStore();
  const index = store.packs.findIndex((pack) => pack.id === packId);
  if (index < 0) throw new Error('素材包不存在');

  const current = store.packs[index];
  const next: ProjectAssetPack = {
    ...current,
    projectId: normalizeOptionalString(patch.projectId) || current.projectId,
    name: patch.name === undefined ? current.name : normalizeAssetPackName(patch.name, current.name),
    source: patch.source === undefined ? current.source : normalizeAssetPackSource(patch.source),
    description: patch.description === undefined ? current.description : normalizeOptionalString(patch.description),
    rootPath: patch.rootPath === undefined ? current.rootPath : normalizeOptionalString(patch.rootPath),
    folderKey: patch.folderKey === undefined ? current.folderKey : normalizeOptionalString(patch.folderKey),
    feishuSpaceIds: patch.feishuSpaceIds === undefined ? current.feishuSpaceIds : normalizeSpaceIds(patch.feishuSpaceIds),
    color: patch.color === undefined ? current.color : normalizeOptionalString(patch.color),
    updatedAt: new Date().toISOString(),
  };

  store.packs[index] = next;
  writeProjectAssetPackStore(store.packs);
  return next;
}

export function touchProjectAssetPack(id: string): ProjectAssetPack | null {
  const packId = id.trim();
  if (!packId) return null;
  const store = readProjectAssetPackStore();
  const index = store.packs.findIndex((pack) => pack.id === packId);
  if (index < 0) return null;
  const now = new Date().toISOString();
  const next: ProjectAssetPack = {
    ...store.packs[index],
    updatedAt: now,
    lastOpenedAt: now,
  };
  store.packs[index] = next;
  writeProjectAssetPackStore(store.packs);
  return next;
}

export function deleteProjectAssetPack(id: string): boolean {
  const packId = id.trim();
  if (!packId) return false;
  const store = readProjectAssetPackStore();
  const next = store.packs.filter((pack) => pack.id !== packId);
  if (next.length === store.packs.length) return false;
  writeProjectAssetPackStore(next);
  return true;
}

export function writeKnowledgeHubIndex(items: KnowledgeHubItem[]): KnowledgeHubIndex {
  const payload: KnowledgeHubIndex = {
    items,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(getIndexPath(), payload);
  return payload;
}

export function replaceKnowledgeItemsBySource(source: KnowledgeSource, nextItems: KnowledgeHubItem[]): KnowledgeHubIndex {
  const current = readKnowledgeHubIndex();
  const kept = current.items.filter((it) => it.source !== source);
  const merged = [...kept, ...nextItems];
  return writeKnowledgeHubIndex(merged);
}

export function upsertKnowledgeItems(nextItems: KnowledgeHubItem[]): KnowledgeHubIndex {
  const current = readKnowledgeHubIndex();
  const map = new Map<string, KnowledgeHubItem>();
  for (const item of current.items) {
    map.set(item.id, item);
  }
  for (const item of nextItems) {
    map.set(item.id, item);
  }
  return writeKnowledgeHubIndex(Array.from(map.values()));
}

export function getKnowledgeHubItemById(id: string): KnowledgeHubItem | null {
  const index = readKnowledgeHubIndex();
  return index.items.find((item) => item.id === id) || null;
}

export function normalizeSnippet(input: string, maxLength = 300): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}...`;
}

export function createKnowledgeItemId(source: KnowledgeSource, externalKey: string): string {
  return createHash('sha1').update(`${source}:${externalKey}`).digest('hex');
}
