import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import fs from 'fs';
import sharp from 'sharp';
import {
  createPrompt,
  createReferenceImage,
  ensureDefaultProjectForUser,
  getProjectById,
  isLocalBackendEnabled,
  saveBinaryFile,
  saveRemoteImageToLocal,
  upsertImageRecord,
} from '@/lib/local-backend';
import { getKnowledgeHubItemById } from '@/lib/knowledge-hub-store';

async function getImageDimensions(itemUrl: string): Promise<{ width: number; height: number } | null> {
  try {
    if (itemUrl.startsWith('/') && fs.existsSync(itemUrl)) {
      const meta = await sharp(itemUrl).metadata();
      if (meta.width && meta.height) return { width: meta.width, height: meta.height };
    }

    if (/^https?:\/\//i.test(itemUrl)) {
      const res = await fetch(itemUrl);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buffer).metadata();
      if (meta.width && meta.height) return { width: meta.width, height: meta.height };
    }
  } catch {
    return null;
  }
  return null;
}

function fitCanvasSize(dimensions: { width: number; height: number } | null): { width: number; height: number; size: string } {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { width: 480, height: 480, size: '1:1' };
  }

  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(80, Math.round(dimensions.width * scale));
  const height = Math.max(80, Math.round(dimensions.height * scale));
  return { width, height, size: `${dimensions.width}x${dimensions.height}` };
}

async function ensureImageUrl(itemUrl: string): Promise<{ imageUrl: string; imageKey?: string } | null> {
  if (!itemUrl) return null;
  if (itemUrl.startsWith('/api/local-file/')) {
    return { imageUrl: itemUrl };
  }

  if (itemUrl.startsWith('/')) {
    try {
      const buf = fs.readFileSync(itemUrl);
      const ext = itemUrl.split('.').pop() || 'png';
      const saved = saveBinaryFile(buf, `knowledge_hub_${Date.now()}.${ext}`);
      return { imageUrl: saved.url, imageKey: saved.key };
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(itemUrl)) {
    const saved = await saveRemoteImageToLocal(itemUrl, 'knowledge_hub');
    if (saved) {
      return { imageUrl: saved.url, imageKey: saved.key };
    }
    return { imageUrl: itemUrl };
  }

  return null;
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  if (!isLocalBackendEnabled()) {
    return NextResponse.json({ error: '当前仅本地模式支持知识库导入' }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      itemId?: string;
      action?: 'reference' | 'prompt' | 'canvas';
      projectId?: string;
    };

    const itemId = (body.itemId || '').trim();
    const action = body.action || 'reference';
    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const item = getKnowledgeHubItemById(itemId);
    if (!item) {
      return NextResponse.json({ error: '找不到该知识条目，请先同步' }, { status: 404 });
    }

    const project = body.projectId ? getProjectById(body.projectId, userId) : ensureDefaultProjectForUser(userId);
    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }

    if (action === 'prompt') {
      const promptText = [item.title, item.textSnippet || item.contentPreview || '', item.url || item.externalId]
        .filter(Boolean)
        .join('\n');

      const prompt = createPrompt(userId, {
        project_id: project.id,
        text: promptText,
        category: `knowledge:${item.source}`,
      });

      return NextResponse.json({ success: true, action, prompt, projectId: project.id });
    }

    if (action === 'canvas') {
      if (item.kind !== 'image' || !item.externalId) {
        return NextResponse.json({ error: '该条目不是可导入画布的图片资源' }, { status: 400 });
      }

      const imageRef = await ensureImageUrl(item.externalId);
      if (!imageRef) {
        return NextResponse.json({ error: '图片资源无法读取' }, { status: 400 });
      }

      const canvasSize = fitCanvasSize(await getImageDimensions(item.externalId));
      const recordId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const record = upsertImageRecord({
        id: recordId,
        project_id: project.id,
        user_id: userId,
        prompt: `[知识库导入] ${item.title}`,
        image_url: imageRef.imageUrl,
        image_key: imageRef.imageKey || null,
        reference_images: null,
        canvas_x: 120,
        canvas_y: 120,
        canvas_width: canvasSize.width,
        canvas_height: canvasSize.height,
        size: canvasSize.size,
        model: 'knowledge-hub',
        status: 'completed',
        is_favorite: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        edited_image_key: null,
      });

      return NextResponse.json({ success: true, action, record, projectId: project.id });
    }

    if (item.kind !== 'image' || !item.externalId) {
      return NextResponse.json({ error: '该条目不是可导入参考图的图片资源' }, { status: 400 });
    }

    const imageRef = await ensureImageUrl(item.externalId);
    if (!imageRef) {
      return NextResponse.json({ error: '图片资源无法读取' }, { status: 400 });
    }

    const reference = createReferenceImage(userId, {
      project_id: project.id,
      image_url: imageRef.imageUrl,
      image_key: imageRef.imageKey || null,
      file_name: item.title,
    });

    return NextResponse.json({ success: true, action: 'reference', reference, projectId: project.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '导入失败' },
      { status: 500 },
    );
  }
}
