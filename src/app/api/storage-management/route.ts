import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { getRuntimeBackendMode, getRuntimeLanRole } from '@/lib/runtime-config';
import { storageOverview, scanStorage, cleanStorage, changeStorageDirectory, setCacheLimit } from '@/lib/storage-management';
import { browseStorageDirectory, createStorageDirectory, validateStorageDirectory } from '@/lib/storage-directory-browser';
import { saveBrowserReferences } from '@/lib/storage-lifecycle';
import { drainLocalFileCleanup, localFileCleanupStatus, maintainLocalStorage } from '@/lib/local-backend';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function unavailable() {
  if (!isLocalBackendEnabled()) return '当前为云端储存，请通过云端资产管理维护文件。';
  if (getRuntimeBackendMode() === 'lan' && getRuntimeLanRole() === 'client') return '图片保存在局域网主机，请在主机的设置中管理储存。';
  return '';
}
function guard(request: NextRequest) {
  const origin = request.headers.get('origin');
  // Next can use an internal hostname for nextUrl when the browser connects via
  // a LAN IP or a reverse proxy. Host preserves the address used by the browser.
  const publicHost = request.headers.get('host') || request.nextUrl.host;
  if (origin) {
    let sameOrigin = false;
    try {
      const parsed = new URL(origin);
      sameOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === publicHost;
    } catch { /* An invalid or opaque origin is not a same-origin request. */ }
    if (!sameOrigin) return NextResponse.json({ error: '储存管理仅支持同源请求' }, { status: 403 });
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: '储存管理仅支持同源请求' }, { status: 403 });
  if (request.headers.get('x-hz-lan-proxy') === '1') return NextResponse.json({ error: '请在主机本机管理储存' }, { status: 403 });
  if (!getCurrentUserId(request)) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return null;
}
export async function GET(request: NextRequest) {
  const denied = guard(request); if (denied) return denied;
  const reason = unavailable();
  if (reason) return NextResponse.json({ supported: false, reason });
  try { return NextResponse.json(await storageOverview()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '无法读取储存信息' }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const denied = guard(request); if (denied) return denied;
  const reason = unavailable(); if (reason) return NextResponse.json({ error: reason }, { status: 403 });
  try {
    const body = await request.json();
    const owner = getCurrentUserId(request)!;
    if (body.action === 'browser-references' && typeof body.clientId === 'string' && Array.isArray(body.entries)) {
      saveBrowserReferences(owner, body.clientId, body.entries);
      maintainLocalStorage();
      return NextResponse.json({ success: true });
    }
    if (body.action === 'retry-cleanup') { const result = drainLocalFileCleanup(true); return NextResponse.json({ ...result, cleanup: localFileCleanupStatus() }); }
    if (body.action === 'browse-directory' && (body.directory === undefined || typeof body.directory === 'string')) return NextResponse.json(await browseStorageDirectory(body.directory));
    if (body.action === 'validate-directory' && typeof body.directory === 'string') return NextResponse.json(await validateStorageDirectory(body.directory));
    if (body.action === 'create-directory' && typeof body.directory === 'string' && typeof body.name === 'string') return NextResponse.json(await createStorageDirectory(body.directory, body.name));
    if (body.action === 'scan') return NextResponse.json(await scanStorage(owner));
    if (body.action === 'clean' && typeof body.token === 'string' && Array.isArray(body.ids) && body.ids.every((id: unknown) => typeof id === 'string')) return NextResponse.json(await cleanStorage(owner, body.token, body.ids));
    if (body.action === 'directory' && typeof body.directory === 'string' && typeof body.migrate === 'boolean') return NextResponse.json({ migration: await changeStorageDirectory(body.directory, body.migrate) });
    if (body.action === 'cache-limit') { await setCacheLimit(body.limitMB); return NextResponse.json({ success: true }); }
    return NextResponse.json({ error: '无效的储存操作' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '储存操作失败' }, { status: 400 }); }
}
