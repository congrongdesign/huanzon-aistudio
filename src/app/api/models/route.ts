import { NextRequest, NextResponse } from 'next/server';

type PricingModelInfo = {
  name?: string;
  displayName?: string;
  supplier?: string;
  owner?: string;
  tags?: unknown;
  illustrate?: string;
  show_order?: number;
};

type PricingPayload = {
  model_info?: Record<string, PricingModelInfo>;
  owner_by?: Record<string, { name?: string; illustrate?: string; src?: string; show_order?: number }>;
  group_special?: Record<string, unknown>;
};

type ModelRecord = Record<string, unknown>;
type ProviderType = 'yunwu' | 'grsai' | 'codia' | 'codiaz' | 'custom';

type GrsaiModelPageRecord = {
  cost_type?: number;
  credits?: number;
  desc?: string;
  document?: string;
  errorReturn?: boolean;
  feature?: string;
  id?: string;
  maintenance?: string;
  max_token?: number;
  model?: string;
  name?: string;
  priceExample?: string;
  violationReturn?: boolean;
};

const GRSAI_MODEL_PAGE_URLS = [
  'https://grsai.ai/zh/dashboard/models',
  'https://grsai.ai/dashboard/models',
];

const GRSAI_FALLBACK_MODELS: GrsaiModelPageRecord[] = [
  {
    name: 'gpt-image-2-vip',
    credits: 1300,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K、4K',
    desc: 'GPT Image 2 绘画模型，支持 1K、2K、4K。',
    document: 'https://grsai.ai/dashboard/documents/gpt-image',
    errorReturn: true,
    violationReturn: true,
    maintenance: '维护中',
  },
  {
    name: 'gpt-image-2',
    credits: 600,
    cost_type: 0,
    feature: '文生图、图生图、1K',
    desc: 'GPT Image 2 绘画模型。',
    document: 'https://grsai.ai/dashboard/documents/gpt-image',
    errorReturn: true,
    violationReturn: true,
  },
  {
    name: 'nano-banana-pro',
    model: 'gemini-3.1-flash-image-preview',
    credits: 1800,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K、4K',
    desc: 'Nano Banana Pro 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: true,
    violationReturn: true,
  },
  {
    name: 'nano-banana-2',
    model: 'gemini-3.1-flash-image-preview',
    credits: 1200,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K、4K',
    desc: 'Nano Banana 2 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: true,
    violationReturn: true,
  },
  {
    name: 'nano-banana-pro-vt',
    model: 'gemini-3-pro-image-preview',
    credits: 1800,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K、4K',
    desc: 'Nano Banana Pro VT 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: true,
    violationReturn: true,
  },
  {
    name: 'nano-banana-fast',
    model: 'gemini-2.5-flash-image',
    credits: 440,
    cost_type: 0,
    feature: '文生图、图生图',
    desc: 'Nano Banana 快速版。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: true,
    violationReturn: true,
  },
  {
    name: 'nano-banana-2-cl',
    model: 'gemini-3.1-flash-image-preview',
    credits: 1600,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K',
    desc: 'Nano Banana 2 CL 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: false,
    violationReturn: true,
  },
  {
    name: 'nano-banana-pro-cl',
    model: 'gemini-3-pro-image-preview',
    credits: 6000,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K、4K',
    desc: 'Nano Banana Pro CL 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: false,
    violationReturn: true,
  },
  {
    name: 'nano-banana-pro-vip',
    model: 'gemini-3-pro-image-preview',
    credits: 10000,
    cost_type: 0,
    feature: '文生图、图生图、1K、2K',
    desc: 'Nano Banana Pro VIP 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: false,
    violationReturn: true,
  },
  {
    name: 'nano-banana-2-4k-cl',
    model: 'gemini-3.1-flash-image-preview',
    credits: 3000,
    cost_type: 0,
    feature: '文生图、图生图、4K',
    desc: 'Nano Banana 2 4K CL 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: false,
    violationReturn: true,
  },
  {
    name: 'nano-banana',
    model: 'gemini-2.5-flash-image',
    credits: 1400,
    cost_type: 0,
    feature: '文生图、图生图',
    desc: 'Nano Banana 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: true,
    violationReturn: true,
  },
  {
    name: 'nano-banana-pro-4k-vip',
    model: 'gemini-3-pro-image-preview',
    credits: 16000,
    cost_type: 0,
    feature: '文生图、图生图、4K',
    desc: 'Nano Banana Pro 4K VIP 绘图模型。',
    document: 'https://grsai.ai/dashboard/documents/nano-banana',
    errorReturn: false,
    violationReturn: true,
  },
  { name: 'gpt-5.4', model: 'gpt-5.4', cost_type: 1, feature: '对话', document: 'https://qmy27nhsd9.apifox.cn/452418916e0' },
  { name: 'gpt-5.5', model: 'gpt-5.5', cost_type: 1, feature: '对话', document: 'https://qmy27nhsd9.apifox.cn/452418916e0' },
  { name: 'gemini-3.1-pro', model: 'gemini-3.1-pro-preview', cost_type: 1, feature: '对话、识图、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'gemini-3.1-flash-lite', model: 'gemini-3.1-flash-lite', cost_type: 1, feature: '对话、识图、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'gemini-3.5-flash', model: 'gemini-3.5-flash', cost_type: 1, feature: '对话、识图、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'gemini-3-flash', model: 'gemini-3-flash-preview', cost_type: 1, feature: '对话、识图', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'gemini-3-pro', model: 'gemini-3.1-pro-preview', cost_type: 1, feature: '对话、识图、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'gemini-2.5-flash', model: 'gemini-3-flash-preview', cost_type: 1, feature: '对话、识图', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'gemini-2.5-pro', model: 'gemini-3.1-pro-preview', cost_type: 1, feature: '对话、识图、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'deepseek-chat', model: 'deepseek-chat', cost_type: 1, feature: '对话', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'deepseek-reasoner', model: 'deepseek-reasoner', cost_type: 1, feature: '对话、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
  { name: 'claude-sonnet-4-20250514', model: 'claude-sonnet-4-20250514', cost_type: 1, feature: '对话、推理', document: 'https://grsai.ai/dashboard/documents/chat' },
];

const CODIA_CAPABILITY_ENTRIES: ModelRecord[] = [
  {
    id: 'generate_image',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/generate_image',
    displayName: '文本生图',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['image', 'generate'],
    tags: ['capability', 'image', 'generate'],
    description: '根据提示词生成图片。',
    showOrder: 1,
  },
  {
    id: 'image_to_image',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/image_to_image',
    displayName: '参考图生成',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['image', 'edit'],
    tags: ['capability', 'image', 'edit'],
    description: '基于输入图片进行生成或重绘。',
    showOrder: 2,
  },
  {
    id: 'remove_bg',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/remove_bg',
    displayName: '去背景',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['imageTool', 'remove_bg'],
    tags: ['capability', 'image-tool', 'remove-bg'],
    description: '抠除图片背景。',
    showOrder: 3,
  },
  {
    id: 'upscale',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/upscale',
    displayName: '高清放大',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['imageTool', 'upscale'],
    tags: ['capability', 'image-tool', 'upscale'],
    description: '图片增强与放大。',
    showOrder: 4,
  },
  {
    id: 'layering',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/layering',
    displayName: '图层分离',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['imageTool', 'layering'],
    tags: ['capability', 'image-tool', 'layering'],
    description: '将图片拆分为可编辑图层。',
    showOrder: 5,
  },
  {
    id: 'object_erase',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/object_erase',
    displayName: '智能擦除',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['imageTool', 'erase'],
    tags: ['capability', 'image-tool', 'erase'],
    description: '擦除图片中的指定物体。',
    showOrder: 6,
  },
  {
    id: 'watermark_remove',
    owned_by: 'codia',
    type: 'capability',
    category: 'image',
    endpoint: '/v2/open/image/watermark_remove',
    displayName: '去水印',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['imageTool', 'watermark_remove'],
    tags: ['capability', 'image-tool', 'watermark-remove'],
    description: '去除图片中的水印元素。',
    showOrder: 7,
  },
  {
    id: 'pdf_to_ppt',
    owned_by: 'codia',
    type: 'capability',
    category: 'unknown',
    endpoint: '/v2/open/tasks',
    displayName: 'PDF 转 PPT',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['conversion', 'pdf_to_ppt'],
    tags: ['capability', 'conversion', 'ppt'],
    description: '将 PDF 转为可编辑 PPT 任务。',
    showOrder: 8,
  },
  {
    id: 'image_to_design',
    owned_by: 'codia',
    type: 'capability',
    category: 'unknown',
    endpoint: '/v2/open/image_to_design',
    displayName: '图片转设计稿',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['conversion', 'design'],
    tags: ['capability', 'design', 'image-to-design'],
    description: '将图片转换为结构化设计结果。',
    showOrder: 9,
  },
  {
    id: 'pdf_to_design',
    owned_by: 'codia',
    type: 'capability',
    category: 'unknown',
    endpoint: '/v2/open/pdf_to_design',
    displayName: 'PDF 转设计稿',
    supplier: 'codia',
    supplierName: 'Codia',
    capabilities: ['conversion', 'design'],
    tags: ['capability', 'design', 'pdf-to-design'],
    description: '将 PDF 转换为结构化设计结果。',
    showOrder: 10,
  },
];

function isLocalEndpoint(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function normalizeProviderType(baseUrl: string, type?: string): ProviderType {
  const rawType = String(type || '').toLowerCase();
  const rawUrl = String(baseUrl || '').toLowerCase();
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'api.codia.ai' || host === 'codia.ai' || host.endsWith('.codia.ai')) return 'codia';
    if (host.includes('codiaz')) return 'codiaz';
  } catch {
    // Fall through to string matching below.
  }
  if (rawUrl.includes('codia.ai') && !rawUrl.includes('codiaz')) return 'codia';
  if (rawUrl.includes('codiaz')) return 'codiaz';
  if (rawType === 'yunwu' || rawType === 'grsai' || rawType === 'codia' || rawType === 'codiaz' || rawType === 'custom') {
    return rawType as ProviderType;
  }
  if (rawUrl.includes('grsai') || rawUrl.includes('dakka')) return 'grsai';
  if (rawUrl.includes('yunwu') || rawUrl.includes('wlai')) return 'yunwu';
  return 'custom';
}

async function validateCodiaConnection(baseUrl: string, cleanApiKey: string) {
  if (!cleanApiKey) throw new Error('Codia API Key 未配置');
  const base = normalizeBaseUrl(baseUrl).replace(/\/v1$/i, '').replace(/\/v2\/open.*$/i, '');
  const endpoint = `${base}/v2/open/credits`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${cleanApiKey}` },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    throw new Error(`无法连接 Codia Open API: ${error instanceof Error ? error.message : '请求失败'}`);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Codia 连接失败 (${res.status})${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  if (text) {
    try {
      const payload = JSON.parse(text);
      if (typeof payload?.code === 'number' && payload.code !== 0) {
        throw new Error(`Codia 返回错误: ${payload.message || `code=${payload.code}`}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Codia')) throw error;
    }
  }
  return { endpoint };
}

function getPricingUrl(baseUrl?: string): string | null {
  if (!baseUrl || isLocalEndpoint(baseUrl)) return null;
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('yunwu') && !host.includes('wlai')) return null;
    return `${parsed.protocol}//${parsed.host}/api/pricing`;
  } catch {
    return null;
  }
}

async function fetchPricingMetadata(baseUrl?: string): Promise<PricingPayload | null> {
  const pricingUrl = getPricingUrl(baseUrl);
  if (!pricingUrl) return null;
  try {
    const res = await fetch(pricingUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data && typeof json.data === 'object' ? json.data : null;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim())
    : [];
}

function getSupportedGroups(value: unknown): string[] {
  return asStringArray(value);
}

function splitFeatureTags(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[、,，/|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function inferGrsaiModelCategory(record: GrsaiModelPageRecord): string {
  const id = String(record.name || record.model || '').toLowerCase();
  const text = `${record.feature || ''} ${record.desc || ''}`.toLowerCase();
  if (
    record.cost_type === 0 ||
    /gpt-image|nano-banana|banana|image|绘画|生图|图生图|文生图|图片/.test(id) ||
    /绘画|生图|图生图|文生图|图片|图像/.test(text)
  ) {
    return 'image';
  }
  if (/识图|vision|视觉/.test(text)) return 'vision';
  return 'chat';
}

function normalizeGrsaiModelRecord(record: GrsaiModelPageRecord, index: number): ModelRecord | null {
  const id = String(record.name || record.model || '').trim();
  if (!id) return null;
  const featureTags = splitFeatureTags(record.feature);
  const category = inferGrsaiModelCategory(record);
  const billingTags = record.cost_type === 0 ? ['per-image'] : ['token-billing'];
  const statusTags = record.maintenance ? ['maintenance'] : ['available'];
  const descriptionParts = [
    record.desc,
    typeof record.credits === 'number' && record.credits > 0 ? `积分消耗：${record.credits}/次` : '',
    record.priceExample ? `价格示例：${record.priceExample}` : '',
  ].filter(Boolean);
  return {
    id,
    owned_by: 'grsai',
    created: 0,
    type: 'model',
    category,
    endpoint: category === 'image' ? '/v1/api/generate' : '/v1/chat/completions',
    capabilities: featureTags,
    displayName: id,
    supplier: 'grsai',
    supplierName: 'GRSAI',
    tags: Array.from(new Set(['grsai', ...billingTags, ...statusTags, ...featureTags])),
    description: descriptionParts.join('\n'),
    supportedGroups: featureTags,
    showOrder: index + 1,
    document: record.document || '',
    billing: typeof record.credits === 'number' && record.credits > 0 ? `${record.credits} credits` : 'token',
  };
}

function extractBalancedJsonArray(text: string, arrayStart: number): string | null {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = arrayStart; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === '\\') {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(arrayStart, i + 1);
    }
  }
  return null;
}

function extractGrsaiModelsFromHtml(html: string): GrsaiModelPageRecord[] {
  const decoded = html.replace(/\\"/g, '"');
  const marker = '"models":';
  const markerIndex = decoded.indexOf(marker);
  if (markerIndex < 0) return [];
  const arrayStart = decoded.indexOf('[', markerIndex + marker.length);
  if (arrayStart < 0) return [];
  const arrayText = extractBalancedJsonArray(decoded, arrayStart);
  if (!arrayText) return [];
  try {
    const parsed = JSON.parse(arrayText);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is GrsaiModelPageRecord => Boolean(item) && typeof item === 'object' && typeof item.name === 'string')
      : [];
  } catch {
    return [];
  }
}

async function fetchGrsaiModelCatalog(): Promise<{ models: ModelRecord[]; endpoint: string; metadataSource: string }> {
  for (const url of GRSAI_MODEL_PAGE_URLS) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/html', 'Cache-Control': 'no-store' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const records = extractGrsaiModelsFromHtml(html);
      const models = records
        .map((record, index) => normalizeGrsaiModelRecord(record, index))
        .filter((model): model is ModelRecord => Boolean(model));
      if (models.length > 0) {
        return { models, endpoint: url, metadataSource: 'grsai-model-page' };
      }
    } catch {
      // Fall back to the embedded catalog below.
    }
  }

  return {
    models: GRSAI_FALLBACK_MODELS
      .map((record, index) => normalizeGrsaiModelRecord(record, index))
      .filter((model): model is ModelRecord => Boolean(model)),
    endpoint: 'built-in:grsai-model-catalog',
    metadataSource: 'grsai-fallback-catalog',
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

function stripKnownApiOperation(baseUrl: string) {
  return baseUrl
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/images\/generations$/i, '')
    .replace(/\/images\/edits$/i, '')
    .replace(/\/embeddings$/i, '')
    .replace(/\/rerank$/i, '')
    .replace(/\/audio\/speech$/i, '')
    .replace(/\/audio\/transcriptions$/i, '');
}

function buildModelEndpointCandidates(baseUrl: string): string[] {
  const trimmed = normalizeBaseUrl(baseUrl);
  const candidates = new Set<string>();
  if (!trimmed) return [];

  const baseVariants = Array.from(new Set([
    trimmed,
    stripKnownApiOperation(trimmed),
  ].filter(Boolean)));

  for (const base of baseVariants) {
    if (/\/models$/i.test(base)) {
      candidates.add(base);
      continue;
    }
    if (/\/v1$/i.test(base)) {
      candidates.add(`${base}/models`);
      candidates.add(`${base.replace(/\/v1$/i, '')}/models`);
    } else {
      candidates.add(`${base}/v1/models`);
      candidates.add(`${base}/models`);
      candidates.add(`${base}/v2/open/models`);
      candidates.add(`${base}/api/v1/models`);
      candidates.add(`${base}/openai/v1/models`);
    }
  }
  return Array.from(candidates);
}

function extractModelArray(payload: unknown): ModelRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is ModelRecord => Boolean(item) && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const candidates = [obj.data, obj.models, obj.result, obj.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is ModelRecord => Boolean(item) && typeof item === 'object');
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      for (const nestedCandidate of [nested.data, nested.models, nested.result, nested.items]) {
        if (Array.isArray(nestedCandidate)) return nestedCandidate.filter((item): item is ModelRecord => Boolean(item) && typeof item === 'object');
      }
    }
  }
  return [];
}

function getModelId(model: ModelRecord): string {
  const raw = model.id || model.model || model.name || model.model_name || model.modelName;
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseErrorMessage(status: number, text: string) {
  let errorMsg = `获取模型列表失败 (${status})`;
  try {
    const errObj = JSON.parse(text);
    errorMsg = errObj.error?.message || errObj.error || errObj.message || errObj.msg || errorMsg;
  } catch {
    if (text.trim()) errorMsg = text.trim().slice(0, 240);
  }
  return errorMsg;
}

async function fetchModelsFromProvider(baseUrl: string, cleanApiKey: string) {
  const endpoints = buildModelEndpointCandidates(baseUrl);
  const errors: string[] = [];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: (() => {
          const headers: Record<string, string> = { Accept: 'application/json' };
          if (cleanApiKey) headers.Authorization = `Bearer ${cleanApiKey}`;
          if (!cleanApiKey && isLocalEndpoint(baseUrl)) headers.Authorization = 'Bearer ollama';
          return headers;
        })(),
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      if (!res.ok) {
        errors.push(`${url}: ${parseErrorMessage(res.status, text)}`);
        continue;
      }
      const payload = text ? JSON.parse(text) : null;
      const models = extractModelArray(payload).filter(model => getModelId(model));
      if (models.length > 0) return { models, endpoint: url };
      errors.push(`${url}: 返回结果里没有可识别模型`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : '请求失败'}`);
    }
  }
  throw new Error(errors[0] || '没有可用的模型列表端点');
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey, baseUrl, type } = await request.json();
    if (!baseUrl) {
      return NextResponse.json({ error: '请先配置 Base URL' }, { status: 400 });
    }

    const cleanApiKey = (apiKey || '').replace(/^Bearer\s+/i, '').trim();
    const providerType = normalizeProviderType(baseUrl, type);
    if (providerType === 'codia') {
      const validation = await validateCodiaConnection(baseUrl, cleanApiKey);
      return NextResponse.json({
        models: CODIA_CAPABILITY_ENTRIES,
        endpoint: validation.endpoint,
        metadataSource: 'codia-openapi',
        providerKind: 'codia-openapi',
        message: 'Codia 返回的是能力目录，不是普通模型列表。',
      });
    }

    if (providerType === 'grsai') {
      const catalog = await fetchGrsaiModelCatalog();
      return NextResponse.json({
        models: catalog.models,
        endpoint: catalog.endpoint,
        metadataSource: catalog.metadataSource,
        providerKind: 'grsai-catalog',
        message: 'GRSAI 暂未提供 OpenAI /v1/models 列表接口，已使用官方模型页目录。',
      });
    }

    const { models: rawModels, endpoint } = await fetchModelsFromProvider(baseUrl, cleanApiKey);
    const pricing = await fetchPricingMetadata(baseUrl);
    const modelInfo = pricing?.model_info || {};
    const ownerBy = pricing?.owner_by || {};
    const groupSpecial = pricing?.group_special || {};

    const models = rawModels
      .map((m) => {
        const id = getModelId(m);
        const info = modelInfo[id] || modelInfo[id.replace(/-all$/, '')] || null;
        const supplier = info?.supplier || info?.owner || (typeof m.supplier === 'string' ? m.supplier : '');
        const owner = supplier ? ownerBy[supplier] : undefined;
        const tags = asStringArray(info?.tags).concat(asStringArray(m.tags));
        const capabilities = Array.isArray(m.capabilities)
          ? m.capabilities
          : Array.isArray(m.modalities)
            ? m.modalities
            : Array.isArray(m.supported_parameters)
              ? m.supported_parameters
              : [];
        return {
          id,
          owned_by: m.owned_by || m.owner || supplier || '',
          created: m.created || 0,
          type: m.type || m.object || '',
          category: m.category || m.model_type || m.kind || '',
          endpoint: m.endpoint || m.path || '',
          capabilities,
          displayName: info?.displayName || info?.name || (typeof m.display_name === 'string' ? m.display_name : typeof m.name === 'string' ? m.name : ''),
          supplier,
          supplierName: owner?.name || supplier || '',
          supplierIcon: owner?.src || '',
          tags: Array.from(new Set(tags)),
          description: info?.illustrate || (typeof m.description === 'string' ? m.description : ''),
          supportedGroups: getSupportedGroups(groupSpecial[id] || groupSpecial[id.replace(/-all$/, '')]),
          showOrder: typeof m.showOrder === 'number' ? m.showOrder : typeof info?.show_order === 'number' ? info.show_order : 999,
        };
      })
      .sort((a, b) => (a.showOrder ?? 999) - (b.showOrder ?? 999) || a.id.localeCompare(b.id));

    return NextResponse.json({
      models,
      endpoint,
      metadataSource: pricing ? 'yunwu-pricing' : 'provider-models',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: `获取模型列表失败: ${msg}` }, { status: 500 });
  }
}
