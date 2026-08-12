import fs from 'fs';
import path from 'path';
import {
  createKnowledgeItemId,
  KnowledgeHubConfig,
  KnowledgeHubItem,
  normalizeSnippet,
  replaceKnowledgeItemsBySource,
} from '@/lib/knowledge-hub-store';

const NAS_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif']);
const NAS_TEXT_EXT = new Set(['.txt', '.md', '.json', '.csv', '.log', '.xml', '.yaml', '.yml', '.html']);
interface SyncResult {
  success: boolean;
  source: 'nas' | 'feishu';
  syncedCount: number;
  skippedCount: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

interface FeishuAccessTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuSpaceItem {
  space_id?: string;
  name?: string;
}

interface FeishuSpaceListResponse {
  code: number;
  msg?: string;
  data?: {
    items?: FeishuSpaceItem[];
    page_token?: string;
    has_more?: boolean;
  };
}

interface FeishuNodeItem {
  node_token?: string;
  obj_token?: string;
  obj_type?: string;
  title?: string;
  has_child?: boolean;
  origin_node_token?: string;
}

interface FeishuNodeListResponse {
  code: number;
  msg?: string;
  data?: {
    items?: FeishuNodeItem[];
    page_token?: string;
    has_more?: boolean;
  };
}

interface FeishuDocRawContentResponse {
  code: number;
  msg?: string;
  data?: {
    content?: string;
  };
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

function classifyNasKind(filePath: string): 'image' | 'text' | 'doc' {
  const ext = path.extname(filePath).toLowerCase();
  if (NAS_IMAGE_EXT.has(ext)) return 'image';
  if (NAS_TEXT_EXT.has(ext)) return 'text';
  return 'doc';
}

function readTextPreview(filePath: string, maxBytes = 4096): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytes = fs.readSync(fd, buffer, 0, maxBytes, 0);
    fs.closeSync(fd);
    const text = buffer.subarray(0, bytes).toString('utf8');
    return normalizeSnippet(text, 280);
  } catch {
    return '';
  }
}

function collectNasFiles(rootPath: string, recursive: boolean, includeHidden: boolean, maxFiles: number): string[] {
  const results: string[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0 && results.length < maxFiles) {
    const current = queue.shift();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!includeHidden && isHiddenName(entry.name)) continue;
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (recursive) queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      results.push(fullPath);
      if (results.length >= maxFiles) break;
    }
  }

  return results;
}

function buildNasItem(rootPath: string, filePath: string): KnowledgeHubItem {
  const stat = fs.statSync(filePath);
  const rel = path.relative(rootPath, filePath);
  const kind = classifyNasKind(filePath);
  const snippet = kind === 'text' ? readTextPreview(filePath) : '';

  const externalKey = filePath;
  const id = createKnowledgeItemId('nas', externalKey);

  return {
    id,
    source: 'nas',
    kind,
    title: path.basename(filePath),
    location: rootPath,
    externalId: filePath,
    url: undefined,
    textSnippet: snippet || undefined,
    contentPreview: snippet || undefined,
    metadata: {
      relativePath: rel,
      ext: path.extname(filePath).toLowerCase(),
      mtimeMs: stat.mtimeMs,
    },
    size: stat.size,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
  };
}

async function syncNas(config: KnowledgeHubConfig): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  if (!config.nas.enabled) {
    return {
      success: true,
      source: 'nas',
      syncedCount: 0,
      skippedCount: 0,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const rootPath = config.nas.rootPath.trim();
  if (!rootPath) {
    return {
      success: false,
      source: 'nas',
      syncedCount: 0,
      skippedCount: 0,
      errors: ['NAS 根目录未配置'],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  if (!fs.existsSync(rootPath)) {
    return {
      success: false,
      source: 'nas',
      syncedCount: 0,
      skippedCount: 0,
      errors: [`NAS 路径不存在: ${rootPath}`],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  let filePaths: string[] = [];
  try {
    filePaths = collectNasFiles(
      rootPath,
      config.nas.recursive,
      config.nas.includeHidden,
      config.nas.maxFiles,
    );
  } catch (err) {
    return {
      success: false,
      source: 'nas',
      syncedCount: 0,
      skippedCount: 0,
      errors: [err instanceof Error ? err.message : '扫描 NAS 失败'],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const items: KnowledgeHubItem[] = [];
  let skippedCount = 0;

  for (const filePath of filePaths) {
    try {
      const item = buildNasItem(rootPath, filePath);
      items.push(item);
    } catch {
      skippedCount += 1;
    }
  }

  replaceKnowledgeItemsBySource('nas', items);

  return {
    success: true,
    source: 'nas',
    syncedCount: items.length,
    skippedCount,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function trimBaseUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  return cleaned || 'https://open.feishu.cn';
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
  });

  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`飞书接口返回非 JSON: ${url}`);
  }

  if (!res.ok) {
    const msg = (parsed as { msg?: string }).msg || `HTTP ${res.status}`;
    throw new Error(`飞书接口请求失败: ${msg}`);
  }

  return parsed as T;
}

async function getFeishuTenantToken(baseUrl: string, appId: string, appSecret: string): Promise<string> {
  const tokenRes = await fetchJson<FeishuAccessTokenResponse>(
    `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );

  if (tokenRes.code !== 0 || !tokenRes.tenant_access_token) {
    throw new Error(tokenRes.msg || '获取飞书 tenant_access_token 失败');
  }

  return tokenRes.tenant_access_token;
}

async function listFeishuSpaces(baseUrl: string, token: string): Promise<FeishuSpaceItem[]> {
  const all: FeishuSpaceItem[] = [];
  let pageToken = '';

  for (let i = 0; i < 20; i += 1) {
    const query = new URLSearchParams({ page_size: '50' });
    if (pageToken) query.set('page_token', pageToken);

    const data = await fetchJson<FeishuSpaceListResponse>(
      `${baseUrl}/open-apis/wiki/v2/spaces?${query.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (data.code !== 0) {
      throw new Error(data.msg || '读取飞书知识库空间失败');
    }

    const items = data.data?.items || [];
    all.push(...items);

    if (!data.data?.has_more || !data.data.page_token) break;
    pageToken = data.data.page_token;
  }

  return all;
}

async function listFeishuSpaceNodes(
  baseUrl: string,
  token: string,
  spaceId: string,
  maxNodes: number,
): Promise<FeishuNodeItem[]> {
  const all: FeishuNodeItem[] = [];
  const queue: Array<{ parentNodeToken?: string }> = [{}];

  while (queue.length > 0 && all.length < maxNodes) {
    const current = queue.shift() || {};
    let pageToken = '';

    for (let i = 0; i < 20 && all.length < maxNodes; i += 1) {
      const query = new URLSearchParams({ page_size: '50' });
      if (current.parentNodeToken) query.set('parent_node_token', current.parentNodeToken);
      if (pageToken) query.set('page_token', pageToken);

      const data = await fetchJson<FeishuNodeListResponse>(
        `${baseUrl}/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?${query.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (data.code !== 0) {
        throw new Error(data.msg || `读取飞书节点失败(space: ${spaceId})`);
      }

      const items = data.data?.items || [];
      for (const item of items) {
        all.push(item);
        if (all.length >= maxNodes) break;
        if (item.has_child && item.node_token) {
          queue.push({ parentNodeToken: item.node_token });
        }
      }

      if (!data.data?.has_more || !data.data.page_token) break;
      pageToken = data.data.page_token;
    }
  }

  return all.slice(0, maxNodes);
}

function stripRichTextMarkup(input: string): string {
  const withoutMdLink = input.replace(/\[[^\]]+\]\([^\)]+\)/g, (m) => m.replace(/\([^\)]*\)/g, ''));
  const withoutBackticks = withoutMdLink.replace(/`+/g, '');
  const withoutBlocks = withoutBackticks.replace(/[>#*_~-]/g, ' ');
  return normalizeSnippet(withoutBlocks, 320);
}

async function fetchFeishuDocPreview(baseUrl: string, token: string, docToken: string): Promise<string> {
  try {
    const data = await fetchJson<FeishuDocRawContentResponse>(
      `${baseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(docToken)}/raw_content`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (data.code !== 0) return '';
    return stripRichTextMarkup(data.data?.content || '');
  } catch {
    return '';
  }
}

function buildFeishuNodeUrl(spaceId: string, nodeToken: string): string {
  return `https://feishu.cn/wiki/${spaceId}/${nodeToken}`;
}

async function syncFeishu(config: KnowledgeHubConfig): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  if (!config.feishu.enabled) {
    return {
      success: true,
      source: 'feishu',
      syncedCount: 0,
      skippedCount: 0,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const baseUrl = trimBaseUrl(config.feishu.baseUrl);
  const appId = config.feishu.appId.trim();
  const appSecret = config.feishu.appSecret.trim();

  if (!appId || !appSecret) {
    return {
      success: false,
      source: 'feishu',
      syncedCount: 0,
      skippedCount: 0,
      errors: ['飞书 App ID / App Secret 未配置'],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  try {
    const tenantToken = await getFeishuTenantToken(baseUrl, appId, appSecret);

    const configuredSpaceIds = config.feishu.spaceIds;
    let targetSpaces = configuredSpaceIds;

    if (targetSpaces.length === 0) {
      const spaces = await listFeishuSpaces(baseUrl, tenantToken);
      targetSpaces = spaces.map((space) => space.space_id || '').filter(Boolean);
    }

    const items: KnowledgeHubItem[] = [];
    let skippedCount = 0;

    for (const spaceId of targetSpaces) {
      const nodes = await listFeishuSpaceNodes(baseUrl, tenantToken, spaceId, config.feishu.maxNodes);

      for (const node of nodes) {
        const nodeToken = node.node_token || node.origin_node_token;
        if (!nodeToken) {
          skippedCount += 1;
          continue;
        }

        const objType = (node.obj_type || '').toLowerCase();
        const title = (node.title || '').trim() || '未命名文档';
        const externalDocToken = node.obj_token || nodeToken;
        const id = createKnowledgeItemId('feishu', `${spaceId}:${nodeToken}:${externalDocToken}`);
        const isText = objType === 'docx' || objType === 'doc';

        let preview = '';
        if (isText && config.feishu.includeDocContent) {
          preview = await fetchFeishuDocPreview(baseUrl, tenantToken, externalDocToken);
        }

        items.push({
          id,
          source: 'feishu',
          kind: isText ? 'text' : 'link',
          title,
          location: `飞书知识库 ${spaceId}`,
          externalId: `${spaceId}:${nodeToken}`,
          url: buildFeishuNodeUrl(spaceId, nodeToken),
          textSnippet: preview || undefined,
          contentPreview: preview || undefined,
          metadata: {
            spaceId,
            nodeToken,
            objType,
            objToken: externalDocToken,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    replaceKnowledgeItemsBySource('feishu', items);

    return {
      success: true,
      source: 'feishu',
      syncedCount: items.length,
      skippedCount,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      source: 'feishu',
      syncedCount: 0,
      skippedCount: 0,
      errors: [err instanceof Error ? err.message : '飞书同步失败'],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

export async function syncKnowledgeHub(config: KnowledgeHubConfig): Promise<{
  success: boolean;
  results: SyncResult[];
}> {
  const nasResult = await syncNas(config);
  const feishuResult = await syncFeishu(config);

  return {
    success: nasResult.success && feishuResult.success,
    results: [nasResult, feishuResult],
  };
}
