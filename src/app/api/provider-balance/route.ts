import { NextRequest, NextResponse } from 'next/server';

type ProviderType = 'yunwu' | 'grsai' | 'codia' | 'codiaz' | 'custom';

type BalanceResult = {
  ok: boolean;
  providerType: ProviderType;
  balance?: string;
  total?: string;
  usage?: string;
  remaining?: string;
  unit?: string;
  raw?: unknown;
  endpoint?: string;
  message?: string;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

function stripKnownApiOperation(baseUrl: string) {
  return baseUrl
    .replace(/\/api\/pricing$/i, '')
    .replace(/\/api\/log\/token$/i, '')
    .replace(/\/v1\/dashboard\/billing\/subscription$/i, '')
    .replace(/\/v1\/dashboard\/billing\/usage$/i, '')
    .replace(/\/v2\/open\/credits$/i, '')
    .replace(/\/v2\/open\/limits$/i, '')
    .replace(/\/client\/openapi\/getAPIKeyCredits$/i, '')
    .replace(/\/client\/openapi\/getCredits$/i, '')
    .replace(/\/client\/common\/getCredits$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/images\/generations$/i, '')
    .replace(/\/images\/edits$/i, '')
    .replace(/\/embeddings$/i, '');
}

function inferProviderType(baseUrl: string, type?: string): ProviderType {
  const rawType = String(type || '').toLowerCase();
  const raw = baseUrl.toLowerCase();
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'api.codia.ai' || host === 'codia.ai' || host.endsWith('.codia.ai')) return 'codia';
    if (host.includes('codiaz')) return 'codiaz';
    if (host.includes('apiplus.org')) return 'yunwu';
  } catch {
    // Fall through to string matching below.
  }
  if (raw.includes('codia.ai') && !raw.includes('codiaz')) return 'codia';
  if (raw.includes('apiplus.org')) return 'yunwu';
  if (rawType === 'yunwu' || rawType === 'grsai' || rawType === 'codia' || rawType === 'codiaz' || rawType === 'custom') return rawType as ProviderType;
  if (raw.includes('codiaz')) return 'codiaz';
  if (raw.includes('grsai') || raw.includes('dakka')) return 'grsai';
  if (raw.includes('yunwu') || raw.includes('wlai')) return 'yunwu';
  return 'custom';
}

function withBearer(apiKey: string) {
  const clean = apiKey.replace(/^Bearer\s+/i, '').trim();
  return clean ? `Bearer ${clean}` : '';
}

function pickNumberLike(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatAmount(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/\.?0+$/, '');
}

function getCurrentBillingRange() {
  const now = new Date();
  return {
    start_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    end_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  };
}

function findFirstMatchingValue(payload: unknown, keys: string[], visited = new Set<unknown>(), depth = 0): unknown {
  if (depth > 5 || payload == null || typeof payload !== 'object' || visited.has(payload)) return undefined;
  visited.add(payload);
  const obj = payload as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') return value;
    const nested = findFirstMatchingValue(value, keys, visited, depth + 1);
    if (nested !== undefined) return nested;
  }
  for (const value of Object.values(obj)) {
    if (!value || typeof value !== 'object') continue;
    const nested = findFirstMatchingValue(value, keys, visited, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function extractYunwuBillingSummary(payload: unknown) {
  const hardLimit = toFiniteNumber(
    findFirstMatchingValue(payload, [
      'hard_limit_usd',
      'hardLimitUsd',
      'available_credits',
      'availableCredits',
      'balance',
      'credits',
      'credit',
      'quota',
      'limit',
      'total',
    ]),
  );
  const usage = toFiniteNumber(
    findFirstMatchingValue(payload, ['total_usage', 'totalUsage', 'usage', 'used', 'consumed', 'quota_used', 'usage_amount']),
  );
  const tokenName = findFirstMatchingValue(payload, ['token_name', 'tokenName', 'name']);
  const accessUntil = findFirstMatchingValue(payload, ['access_until', 'accessUntil', 'expire_at', 'expires_at']);
  return {
    hardLimit,
    usage: usage !== undefined ? usage / 100 : undefined,
    tokenName: typeof tokenName === 'string' ? tokenName : undefined,
    accessUntil:
      typeof accessUntil === 'string' || typeof accessUntil === 'number'
        ? String(accessUntil)
        : undefined,
  };
}

function extractBalance(payload: unknown): { balance?: string; unit?: string } {
  const visited = new Set<unknown>();
  const keys = [
    'hard_limit_usd',
    'hardLimitUsd',
    'available_credits',
    'availableCredits',
    'balance',
    'credits',
    'credit',
    'monthly_credits_remaining',
    'topup_credits_remaining',
    'remain',
    'remaining',
    'quota',
    'amount',
    'total',
    'current_credits',
    'currentCredits',
    'api_key_credits',
    'apiKeyCredits',
    'user_credits',
    'userCredits',
    'data',
  ];
  const metaKeys = new Set(['code', 'status', 'success', 'ok', 'message', 'msg', 'error', 'request_id', 'requestId']);
  const walk = (value: unknown, depth = 0, allowPrimitive = false): string | undefined => {
    if (depth > 4 || value == null || visited.has(value)) return undefined;
    const direct = pickNumberLike(value);
    if (direct !== undefined && allowPrimitive) return direct;
    if (typeof value !== 'object') return undefined;
    visited.add(value);
    const obj = value as Record<string, unknown>;
    for (const key of keys) {
      if (key in obj) {
        const found = walk(obj[key], depth + 1, key !== 'data');
        if (found !== undefined) return found;
      }
    }
    for (const [key, item] of Object.entries(obj)) {
      if (metaKeys.has(key)) continue;
      if (!item || typeof item !== 'object') continue;
      const found = walk(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const unit = typeof payload === 'object' && payload ? String((payload as Record<string, unknown>).unit || (payload as Record<string, unknown>).currency || '').trim() || undefined : undefined;
  return { balance: walk(payload), unit };
}

async function readJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function tryFetchBalance(endpoint: string, init: RequestInit): Promise<BalanceResult | null> {
  try {
    const res = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(12000) });
    const payload = await readJson(res);
    if (!res.ok) {
      const message = payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).message || (payload as Record<string, unknown>).error || '').trim()
        : '';
      return { ok: false, providerType: 'custom', raw: payload, endpoint, message: message || `余额接口错误 (${res.status})` };
    }
    if (payload && typeof payload === 'object') {
      const code = (payload as Record<string, unknown>).code;
      const success = (payload as Record<string, unknown>).success;
      if (success === false) {
        return {
          ok: false,
          providerType: 'custom',
          raw: payload,
          endpoint,
          message: String((payload as Record<string, unknown>).message || '余额接口返回失败'),
        };
      }
      if (
        (typeof code === 'number' && code !== 0 && code !== 200) ||
        (typeof code === 'string' && code.trim() && !['0', '200', 'success', 'ok'].includes(code.trim().toLowerCase()))
      ) {
        return {
          ok: false,
          providerType: 'custom',
          raw: payload,
          endpoint,
          message: String((payload as Record<string, unknown>).message || `余额接口返回错误 code=${code}`),
        };
      }
    }
    const { balance, unit } = extractBalance(payload);
    if (!balance) return { ok: true, providerType: 'custom', raw: payload, endpoint, message: '接口成功，但未识别余额字段' };
    return { ok: true, providerType: 'custom', balance, unit, raw: payload, endpoint };
  } catch {
    return null;
  }
}

async function tryFetchYunwuBalance(base: string, apiKey: string): Promise<BalanceResult | null> {
  const cleanKey = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!cleanKey) {
    return {
      ok: false,
      providerType: 'yunwu',
      endpoint: `${base}/v1/dashboard/billing/subscription`,
      message: '请先配置 API Key',
    };
  }

  const headers: Record<string, string> = {
    Authorization: withBearer(cleanKey),
    Accept: 'application/json',
  };
  const subscriptionEndpoint = `${base}/v1/dashboard/billing/subscription`;
  try {
    const subscriptionRes = await fetch(subscriptionEndpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12000),
    });
    const subscriptionPayload = await readJson(subscriptionRes);
    if (!subscriptionRes.ok) {
      const message = subscriptionPayload && typeof subscriptionPayload === 'object'
        ? String((subscriptionPayload as Record<string, unknown>).message || (subscriptionPayload as Record<string, unknown>).error || '').trim()
        : '';
      return {
        ok: false,
        providerType: 'yunwu',
        raw: subscriptionPayload,
        endpoint: subscriptionEndpoint,
        message: message || `余额接口错误 (${subscriptionRes.status})`,
      };
    }
    if (subscriptionPayload && typeof subscriptionPayload === 'object') {
      const code = (subscriptionPayload as Record<string, unknown>).code;
      const success = (subscriptionPayload as Record<string, unknown>).success;
      if (
        success === false ||
        (typeof code === 'number' && code !== 0 && code !== 200) ||
        (typeof code === 'string' && code.trim() && !['0', '200', 'success', 'ok'].includes(code.trim().toLowerCase()))
      ) {
        return {
          ok: false,
          providerType: 'yunwu',
          raw: subscriptionPayload,
          endpoint: subscriptionEndpoint,
          message: String((subscriptionPayload as Record<string, unknown>).message || '云雾余额接口返回失败'),
        };
      }
    }

    const summary = extractYunwuBillingSummary(subscriptionPayload);
    const { start_date, end_date } = getCurrentBillingRange();
    const usageEndpoint = `${base}/v1/dashboard/billing/usage?start_date=${start_date}&end_date=${end_date}`;
    let usagePayload: unknown = null;
    let usageValue = summary.usage;
    try {
      const usageRes = await fetch(usageEndpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12000),
      });
      usagePayload = await readJson(usageRes);
      if (usageRes.ok) {
        const usageParsed = extractYunwuBillingSummary(usagePayload).usage;
        if (usageParsed !== undefined) usageValue = usageParsed;
      }
    } catch {
      // Keep the subscription result even if usage query is unavailable.
    }

    const total = summary.hardLimit ?? toFiniteNumber(extractBalance(subscriptionPayload).balance);
    const remaining = total !== undefined && usageValue !== undefined ? Math.max(0, total - usageValue) : undefined;
    if (total === undefined) {
      return {
        ok: false,
        providerType: 'yunwu',
        raw: { subscription: subscriptionPayload, usage: usagePayload, range: { start_date, end_date } },
        endpoint: usageEndpoint,
        message: '接口成功，但未识别到余额字段',
      };
    }
    return {
      ok: true,
      providerType: 'yunwu',
      balance: formatAmount(total),
      total: total !== undefined ? formatAmount(total) : undefined,
      usage: usageValue !== undefined ? formatAmount(usageValue) : undefined,
      remaining: remaining !== undefined ? formatAmount(remaining) : undefined,
      unit: 'USD',
      message:
        remaining !== undefined && usageValue !== undefined
          ? `总额度 ${formatAmount(total)} USD（已用 ${formatAmount(usageValue)} USD，剩余 ${formatAmount(remaining)} USD）`
          : `总额度 ${formatAmount(total)} USD，已用/剩余暂不可用`,
      raw: {
        subscription: subscriptionPayload,
        usage: usagePayload,
        range: { start_date, end_date },
        tokenName: summary.tokenName,
        accessUntil: summary.accessUntil,
      },
      endpoint: usageEndpoint,
    };
  } catch (error) {
    return {
      ok: false,
      providerType: 'yunwu',
      endpoint: subscriptionEndpoint,
      message: error instanceof Error ? error.message : '云雾余额查询失败',
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey = '', baseUrl = '', type } = await request.json();
    if (!baseUrl) return NextResponse.json({ ok: false, error: '请先配置 Base URL' }, { status: 400 });
    const providerType = inferProviderType(baseUrl, type);
    const cleanKey = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();
    const base = stripKnownApiOperation(normalizeBaseUrl(baseUrl)).replace(/\/v1$/i, '');

    let lastResult: BalanceResult | null = null;

    if (providerType === 'yunwu') {
      const yunwuResult = await tryFetchYunwuBalance('https://api.apiplus.org', cleanKey);
      if (yunwuResult) {
        lastResult = yunwuResult;
        if (yunwuResult.ok && yunwuResult.balance) {
          return NextResponse.json({ ...yunwuResult, providerType, unit: yunwuResult.unit || 'USD' });
        }
      }
    }

    const candidates: Array<{ endpoint: string; init: RequestInit }> = [];
    if (providerType === 'codia') {
      candidates.push({
        endpoint: `${base}/v2/open/credits`,
        init: { method: 'GET', headers: { Authorization: withBearer(cleanKey), Accept: 'application/json' } },
      });
    }
    if (providerType === 'grsai') {
      candidates.push({
        endpoint: `${base}/client/common/getCredits?apikey=${encodeURIComponent(cleanKey)}`,
        init: { method: 'GET', headers: { Accept: 'application/json' } },
      });
      candidates.push({
        endpoint: `${base}/client/common/getCredits?apiKey=${encodeURIComponent(cleanKey)}`,
        init: { method: 'GET', headers: { Accept: 'application/json' } },
      });
      candidates.push({
        endpoint: `${base}/client/common/getCredits`,
        init: { method: 'GET', headers: { Authorization: withBearer(cleanKey), Accept: 'application/json' } },
      });
    }
    if (providerType === 'grsai' || providerType === 'codiaz' || providerType === 'custom') {
      candidates.push({
        endpoint: `${base}/client/openapi/getAPIKeyCredits`,
        init: { method: 'POST', headers: { Authorization: withBearer(cleanKey), 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      });
      candidates.push({
        endpoint: `${base}/client/openapi/getCredits`,
        init: { method: 'POST', headers: { Authorization: withBearer(cleanKey), 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      });
    }

    for (const candidate of candidates) {
      const result = await tryFetchBalance(candidate.endpoint, candidate.init);
      if (result) lastResult = result;
      if (result?.ok && result.balance) return NextResponse.json({ ...result, providerType, unit: result.unit || 'credits' });
      if (result && providerType === 'codia') {
        return NextResponse.json({ ok: false, providerType, error: result.message || 'Codia 余额查询失败', raw: result.raw, endpoint: result.endpoint }, { status: 400 });
      }
    }

    return NextResponse.json({
      ok: false,
      providerType,
      error: lastResult?.message || '当前中转站未找到可用余额接口或余额字段无法识别',
      raw: lastResult?.raw,
      endpoint: lastResult?.endpoint,
    }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : '余额查询失败' }, { status: 500 });
  }
}
