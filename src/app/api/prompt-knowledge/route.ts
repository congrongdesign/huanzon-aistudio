import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUserId } from '@/lib/auth';
import { createPrompt, deletePrompt, isLocalBackendEnabled, listPrompts, updatePrompt } from '@/lib/local-backend';

function toLocalKnowledge(item: ReturnType<typeof listPrompts>[number]) {
  return {
    id: item.id,
    name: item.name || item.content?.slice(0, 32) || item.text.slice(0, 32),
    content: item.content || item.text,
    source: item.source || '',
    source_url: '',
    category: item.category || '',
    tags: item.tags || '',
    project_id: item.project_id,
    library_id: item.library_id ?? null,
    created_at: item.created_at,
    updated_at: item.updated_at || item.created_at,
  };
}

export async function GET(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  const libraryId = searchParams.get('libraryId');
  const keyword = searchParams.get('keyword');
  if (isLocalBackendEnabled()) {
    let data = listPrompts(userId, projectId).filter((item) => item.kind === 'general' && item.category === 'knowledge');
    if (libraryId) data = data.filter((item) => Number(item.library_id || 0) === Number(libraryId));
    if (keyword) data = data.filter((item) => `${item.name || ''} ${item.content || item.text} ${item.tags || ''}`.toLowerCase().includes(keyword.toLowerCase()));
    return NextResponse.json({ data: data.map(toLocalKnowledge) });
  }

  const supabase = getSupabaseClient();
  let query = supabase.from('prompt_knowledge').select('*').order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);
  if (libraryId) query = query.eq('library_id', Number(libraryId));
  if (keyword) query = query.or(`name.ilike.%${keyword}%,content.ilike.%${keyword}%,category.ilike.%${keyword}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json();
  const { name, content, source, source_url, category, tags, project_id, library_id } = body;
  if (!name || !content) return NextResponse.json({ error: '名称和内容必填' }, { status: 400 });
  if (isLocalBackendEnabled()) {
    const data = createPrompt(userId, {
      project_id: project_id || null,
      text: content,
      name,
      content,
      category: 'knowledge',
      source: source || source_url || '',
      tags: tags || '',
      library_id: library_id || null,
      kind: 'general',
    });
    return NextResponse.json({ data: toLocalKnowledge(data) });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('prompt_knowledge')
    .insert({
      name,
      content,
      source: source || '',
      source_url: source_url || '',
      category: category || '',
      tags: tags || '',
      project_id,
      library_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json();
  const { id, name, content, source, source_url, category, tags } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (isLocalBackendEnabled()) {
    const data = updatePrompt(String(id), userId, {
      ...(name !== undefined ? { name } : {}),
      ...(content !== undefined ? { text: content, content } : {}),
      ...(source !== undefined || source_url !== undefined ? { source: source || source_url || '' } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(tags !== undefined ? { tags } : {}),
    });
    if (!data) return NextResponse.json({ error: '知识条目不存在' }, { status: 404 });
    return NextResponse.json({ data: toLocalKnowledge(data) });
  }

  const supabase = getSupabaseClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (content !== undefined) updates.content = content;
  if (source !== undefined) updates.source = source;
  if (source_url !== undefined) updates.source_url = source_url;
  if (category !== undefined) updates.category = category;
  if (tags !== undefined) updates.tags = tags;

  const { data, error } = await supabase.from('prompt_knowledge')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (isLocalBackendEnabled()) {
    return NextResponse.json({ success: deletePrompt(id, userId) });
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('prompt_knowledge').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
