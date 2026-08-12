import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUserId } from '@/lib/auth';
import { S3Storage, S3Config } from 'coze-coding-dev-sdk';
import {
  createArchivedImageRecord,
  deleteArchivedImageRecord,
  isLocalBackendEnabled,
  listArchivedImages,
  updateArchivedImageRecord,
} from '@/lib/local-backend';

export async function GET(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  const folderId = searchParams.get('folderId');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.max(1, Math.min(200, parseInt(searchParams.get('pageSize') || '80', 10)));

  if (isLocalBackendEnabled()) {
    const allArchived = listArchivedImages(userId, {
      projectId: projectId || undefined,
      folderId: folderId || undefined,
    });
    const total = allArchived.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return NextResponse.json({
      records: allArchived.slice(start, end),
      total,
      page,
      pageSize,
      hasMore: end < total,
    });
  }

  const supabase = getSupabaseClient();

  let query = supabase
    .from('archived_images')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }
  if (folderId) {
    query = query.eq('folder_id', folderId);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const s3 = new S3Storage(new S3Config());
  const records = await Promise.all(
    (data || []).map(async (record: Record<string, unknown>) => {
      if (record.image_key) {
        try {
          const freshUrl = await s3.generatePresignedUrl({ key: record.image_key as string });
          record.image_url = freshUrl;
        } catch {
          // Keep original URL
        }
      }
      return record;
    })
  );

  const total = count || 0;
  return NextResponse.json({
    records,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json();
  const { projectId, imageUrl, imageKey, prompt, originalPrompt, model, size, originalImageId, tags } = body;
  if (!projectId || !imageUrl) return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const record = await createArchivedImageRecord({
      project_id: projectId,
      user_id: userId,
      prompt: prompt || '',
      image_url: imageUrl,
      image_key: imageKey || null,
      model: model || '',
      size: size || '1:1',
      original_image_id: originalImageId || null,
      folder_id: null,
      original_prompt: originalPrompt || '',
      tags: tags || '',
    });

    return NextResponse.json({
      id: record.id,
      user_id: record.user_id,
      project_id: record.project_id,
      folder_id: record.folder_id,
      image_url: record.image_url,
      image_key: record.image_key || '',
      prompt: record.prompt,
      original_prompt: record.original_prompt,
      model: record.model,
      size: record.size,
      original_image_id: record.original_image_id || record.id,
      tags: record.tags,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });
  }

  const supabase = getSupabaseClient();
  const s3 = new S3Storage(new S3Config());
  let archivedImageUrl = imageUrl;
  let archivedImageKey = imageKey || '';

  if (imageUrl) {
    try {
      archivedImageKey = await s3.uploadFromUrl({ url: imageUrl, timeout: 30000 });
      archivedImageUrl = await s3.generatePresignedUrl({ key: archivedImageKey });
    } catch {
      archivedImageKey = imageKey || '';
      archivedImageUrl = imageUrl;
    }
  }

  const { data, error } = await supabase.from('archived_images').insert({
    user_id: userId,
    project_id: projectId,
    image_url: archivedImageUrl,
    image_key: archivedImageKey,
    prompt: prompt || '',
    original_prompt: originalPrompt || '',
    model: model || '',
    size: size || '',
    original_image_id: originalImageId || null,
    tags: tags || '',
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少id' }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const ok = deleteArchivedImageRecord(id, userId);
    if (!ok) return NextResponse.json({ error: '记录不存在或无权限' }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  const supabase = getSupabaseClient();
  const { data: record } = await supabase
    .from('archived_images')
    .select('image_key')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  const { error } = await supabase.from('archived_images').delete().eq('id', id).eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (record?.image_key) {
    const { data: stillReferenced } = await supabase
      .from('archived_images')
      .select('id')
      .eq('user_id', userId)
      .eq('image_key', record.image_key)
      .limit(1);
    if (!stillReferenced || stillReferenced.length === 0) {
      try {
        const s3 = new S3Storage(new S3Config());
        await s3.deleteFile({ fileKey: record.image_key });
      } catch {
        // Ignore storage cleanup failures; DB state is authoritative for the UI.
      }
    }
  }
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json();
  const { id, folder_id } = body;
  if (!id) return NextResponse.json({ error: '缺少id' }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const updates: Record<string, unknown> = {};
    if (folder_id !== undefined) updates.folder_id = folder_id || null;
    const updated = updateArchivedImageRecord(id, userId, updates as never);
    if (!updated) return NextResponse.json({ error: '记录不存在或无权限' }, { status: 404 });
    return NextResponse.json(updated);
  }

  const supabase = getSupabaseClient();
  const updates: Record<string, unknown> = {};
  if (folder_id !== undefined) updates.folder_id = folder_id || null;
  const { data, error } = await supabase.from('archived_images').update(updates).eq('id', id).eq('user_id', userId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
