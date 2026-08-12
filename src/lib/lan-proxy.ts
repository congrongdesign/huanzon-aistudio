import { getRuntimeBackendMode, getRuntimeLanHostUrl, getRuntimeLanRole } from '@/lib/runtime-config';
import { isCozeCloudRuntime } from '@/lib/deploy-mode';

function safeJoinUrl(base: string, path: string): string {
  const cleanedBase = base.replace(/\/+$/, '');
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanedBase}${cleanedPath}`;
}

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

export function shouldUseLanProxy(pathname: string): boolean {
  if (isCozeCloudRuntime()) return false;
  const mode = getRuntimeBackendMode();
  if (mode !== 'lan') return false;
  if (getRuntimeLanRole() !== 'client') return false;
  if (!pathname.startsWith('/api/')) return false;
  if (isReservedLocalPath(pathname)) return false;
  return Boolean(getRuntimeLanHostUrl());
}

export function buildLanProxyTarget(pathname: string, queryString: string): string | null {
  const hostUrl = getRuntimeLanHostUrl();
  if (!hostUrl) return null;
  const pathWithQuery = queryString ? `${pathname}?${queryString}` : pathname;
  return safeJoinUrl(hostUrl, pathWithQuery);
}
