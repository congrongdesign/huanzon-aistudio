import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import {
  createProjectAssetPack,
  deleteProjectAssetPack,
  getProjectAssetPackById,
  listProjectAssetPacks,
  ProjectAssetPackInput,
  touchProjectAssetPack,
  updateProjectAssetPack,
} from '@/lib/knowledge-hub-store';
import { getProjectById, isLocalBackendEnabled } from '@/lib/local-backend';

function assertAuth(request: NextRequest): string | null {
  return getCurrentUserId(request);
}

function canAccessProject(projectId: string, userId: string): boolean {
  if (!projectId) return false;
  if (!isLocalBackendEnabled()) return true;
  return Boolean(getProjectById(projectId, userId));
}

export async function GET(request: NextRequest) {
  const userId = assertAuth(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const projectId = (request.nextUrl.searchParams.get('projectId') || '').trim();
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required', packs: [] }, { status: 400 });
  }
  if (!canAccessProject(projectId, userId)) {
    return NextResponse.json({ error: '项目不存在或无权限', packs: [] }, { status: 403 });
  }

  return NextResponse.json({ packs: listProjectAssetPacks(projectId) });
}

export async function POST(request: NextRequest) {
  const userId = assertAuth(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ProjectAssetPackInput;
    const projectId = (body.projectId || '').trim();
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!canAccessProject(projectId, userId)) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }

    const pack = createProjectAssetPack(body);
    return NextResponse.json({ success: true, pack });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '创建素材包失败' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const userId = assertAuth(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Partial<ProjectAssetPackInput> & { id?: string; touch?: boolean };
    const id = (body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = getProjectAssetPackById(id);
    if (!existing) {
      return NextResponse.json({ error: '素材包不存在' }, { status: 404 });
    }
    if (!canAccessProject(existing.projectId, userId)) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }

    const pack = body.touch ? touchProjectAssetPack(id) : updateProjectAssetPack(id, body);
    return NextResponse.json({ success: true, pack });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '更新素材包失败' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const userId = assertAuth(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const existing = getProjectAssetPackById(id);
  if (!existing) {
    return NextResponse.json({ error: '素材包不存在' }, { status: 404 });
  }
  if (!canAccessProject(existing.projectId, userId)) {
    return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
  }

  const deleted = deleteProjectAssetPack(id);
  return NextResponse.json({ success: deleted });
}
