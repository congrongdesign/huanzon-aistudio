import { NextRequest, NextResponse } from 'next/server';
import { isCozeCloudRuntime } from '@/lib/deploy-mode';

const LOOP_GUARD_HEADER = 'x-hz-lan-proxy';

type RuntimeConfigResponse = {
  mode?: string;
  lanRole?: string;
  lanHostUrl?: string;
};

function isReservedLocalPath(pathname: string): boolean {
  return (
    pathname === '/api/runtime-config' ||
    pathname === '/api/lan-info' ||
    pathname === '/api/lan-health' ||
    pathname === '/api/save-image-download' ||
    pathname === '/api/ppt-workshop/import' ||
    pathname === '/api/upload' ||
    pathname.startsWith('/api/lan-proxy')
  );
}

function sanitizeHostUrl(value?: string): string {
  const cleaned = (value || '').trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function readRuntimeConfigFromCookies(request: NextRequest): RuntimeConfigResponse {
  return {
    mode: request.cookies.get('hz_runtime_mode')?.value,
    lanRole: request.cookies.get('hz_runtime_lan_role')?.value,
    lanHostUrl: request.cookies.get('hz_runtime_lan_host')?.value,
  };
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (isCozeCloudRuntime()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  if (!pathname.startsWith('/api/') || isReservedLocalPath(pathname)) {
    return NextResponse.next();
  }

  if (request.headers.get(LOOP_GUARD_HEADER) === '1') {
    return NextResponse.json(
      { error: '检测到协作代理循环，请检查主机地址是否填写为对方电脑IP地址。' },
      { status: 508 },
    );
  }

  const runtimeConfig = readRuntimeConfigFromCookies(request);
  const shouldProxy =
    runtimeConfig?.mode === 'lan' &&
    runtimeConfig?.lanRole === 'client';

  if (!shouldProxy) {
    return NextResponse.next();
  }

  const hostUrl = sanitizeHostUrl(runtimeConfig?.lanHostUrl);
  if (!hostUrl) {
    return NextResponse.json({ error: '未配置局域网主机地址' }, { status: 500 });
  }

  const target = new URL(hostUrl);
  const rewriteUrl = new URL(`${pathname}${search}`, `${target.protocol}//${target.host}`);
  const headers = new Headers(request.headers);
  headers.set(LOOP_GUARD_HEADER, '1');

  return NextResponse.rewrite(rewriteUrl, {
    request: {
      headers,
    },
  });
}

export const config = {
  matcher: ['/api/:path*'],
};
