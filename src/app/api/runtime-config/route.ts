import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeBackendMode,
  getRuntimeDownloadDirectory,
  getRuntimeLanHostUrl,
  getRuntimeLanRole,
  writeRuntimeConfig,
} from '@/lib/runtime-config';
import { isCozeCloudRuntime } from '@/lib/deploy-mode';

function sanitizeUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function attachRuntimeCookies(
  response: NextResponse,
  config: { mode: string; lanRole: string; lanHostUrl?: string },
): NextResponse {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  };
  response.cookies.set('hz_runtime_mode', config.mode, options);
  response.cookies.set('hz_runtime_lan_role', config.lanRole, options);
  response.cookies.set('hz_runtime_lan_host', config.lanHostUrl || '', options);
  return response;
}

export async function GET() {
  if (isCozeCloudRuntime()) {
    return attachRuntimeCookies(
      NextResponse.json({
        mode: 'local',
        lanRole: 'host',
        lanHostUrl: '',
        downloadDirectory: '',
        cloud: true,
      }),
      { mode: 'local', lanRole: 'host', lanHostUrl: '' },
    );
  }

  const mode = getRuntimeBackendMode() || 'local';
  const lanRole = getRuntimeLanRole();
  const lanHostUrl = getRuntimeLanHostUrl();
  const downloadDirectory = getRuntimeDownloadDirectory();
  return attachRuntimeCookies(
    NextResponse.json({ mode, lanRole, lanHostUrl, downloadDirectory }),
    { mode, lanRole, lanHostUrl },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (isCozeCloudRuntime()) {
      if (body.mode === 'lan' || body.lanRole === 'client' || body.lanRole === 'host' || typeof body.lanHostUrl === 'string') {
        return NextResponse.json({ error: '扣子云端版已关闭本地/局域网模式，只支持账号登录。' }, { status: 403 });
      }

      return attachRuntimeCookies(
        NextResponse.json({
          success: true,
          mode: 'local',
          lanRole: 'host',
          lanHostUrl: '',
          downloadDirectory: '',
          cloud: true,
        }),
        { mode: 'local', lanRole: 'host', lanHostUrl: '' },
      );
    }

    const currentMode = getRuntimeBackendMode() || 'local';
    const mode = (body.mode as 'local' | 'lan' | undefined) ?? currentMode;

    if (mode !== 'local' && mode !== 'lan') {
      return NextResponse.json({ error: 'mode must be local or lan' }, { status: 400 });
    }

    let lanRole: 'host' | 'client' = getRuntimeLanRole();
    if (body.lanRole !== undefined) {
      const nextRole = body.lanRole === 'client' ? 'client' : body.lanRole === 'host' ? 'host' : undefined;
      if (!nextRole) {
        return NextResponse.json({ error: 'lanRole must be host or client' }, { status: 400 });
      }
      lanRole = nextRole;
    }

    let lanHostUrl: string | undefined = getRuntimeLanHostUrl();
    if (typeof body.lanHostUrl === 'string') {
      lanHostUrl = sanitizeUrl(body.lanHostUrl);
    }

    let downloadDirectory: string | undefined;
    if (typeof body.downloadDirectory === 'string') {
      const trimmed = body.downloadDirectory.trim();
      downloadDirectory = trimmed || '';
    }

    if (mode === 'lan' && lanRole === 'client') {
      const effectiveHost = lanHostUrl ?? getRuntimeLanHostUrl();
      if (!effectiveHost) {
        return NextResponse.json({ error: '客户端模式需要填写主机地址（http://IP:端口）' }, { status: 400 });
      }
    }

    const saved = writeRuntimeConfig({
      backendMode: mode,
      lanRole,
      ...(typeof lanHostUrl === 'string' ? { lanHostUrl } : {}),
      ...(typeof downloadDirectory === 'string' ? { downloadDirectory } : {}),
    });

    return attachRuntimeCookies(NextResponse.json({
      success: true,
      mode: saved.backendMode || 'local',
      lanRole: saved.lanRole || 'host',
      lanHostUrl: saved.lanHostUrl || '',
      downloadDirectory: saved.downloadDirectory || '',
    }), {
      mode: saved.backendMode || 'local',
      lanRole: saved.lanRole || 'host',
      lanHostUrl: saved.lanHostUrl || '',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
