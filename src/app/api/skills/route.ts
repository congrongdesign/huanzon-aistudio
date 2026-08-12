import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUserId } from '@/lib/auth';
import {
  createSkill,
  deleteSkill,
  getProjectById,
  isLocalBackendEnabled,
  listSkills,
  updateSkill,
} from '@/lib/local-backend';

// GET - List custom skills
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const project = getProjectById(projectId, userId);
      if (!project) {
        return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
      }
      const skills = listSkills(userId, projectId);
      return NextResponse.json({ skills });
    }

    const supabase = getSupabaseClient();

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('custom_skills')
      .select('*')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching skills:', error);
      return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 });
    }

    return NextResponse.json({ skills: data || [] });
  } catch (err) {
    console.error('Skills GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create a new skill
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, name, description, steps } = body;

    if (!projectId || !name) {
      return NextResponse.json({ error: 'projectId and name are required' }, { status: 400 });
    }

    if (!steps || !Array.isArray(steps)) {
      return NextResponse.json({ error: 'steps must be an array' }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const project = getProjectById(projectId, userId);
      if (!project) {
        return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
      }
      const skill = createSkill(userId, {
        project_id: projectId,
        name,
        description: description || '',
        steps: JSON.stringify(steps),
      });
      return NextResponse.json({ skill });
    }

    const supabase = getSupabaseClient();

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('custom_skills')
      .insert({
        project_id: projectId,
        name,
        description: description || '',
        steps: JSON.stringify(steps),
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating skill:', error);
      return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 });
    }

    return NextResponse.json({ skill: data });
  } catch (err) {
    console.error('Skills POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update a skill
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, description, steps } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const skill = updateSkill(id, userId, {
        name,
        description,
        steps: steps !== undefined ? JSON.stringify(steps) : undefined,
      });
      if (!skill) {
        return NextResponse.json({ error: '无权限修改' }, { status: 403 });
      }
      return NextResponse.json({ skill });
    }

    const supabase = getSupabaseClient();

    // Verify ownership via project
    const { data: skill } = await supabase
      .from('custom_skills')
      .select('id, projects!inner(user_id)')
      .eq('id', id)
      .single();

    if (!skill || (skill.projects as unknown as { user_id: string }[])[0]?.user_id !== userId) {
      return NextResponse.json({ error: '无权限修改' }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (steps !== undefined) updates.steps = JSON.stringify(steps);

    const { data, error } = await supabase
      .from('custom_skills')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating skill:', error);
      return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
    }

    return NextResponse.json({ skill: data });
  } catch (err) {
    console.error('Skills PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete a skill
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const ok = deleteSkill(id, userId);
      if (!ok) {
        return NextResponse.json({ error: '无权限删除' }, { status: 403 });
      }
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // Verify ownership via project
    const { data: skill } = await supabase
      .from('custom_skills')
      .select('id, projects!inner(user_id)')
      .eq('id', id)
      .single();

    if (!skill || (skill.projects as unknown as { user_id: string }[])[0]?.user_id !== userId) {
      return NextResponse.json({ error: '无权限删除' }, { status: 403 });
    }

    const { error } = await supabase
      .from('custom_skills')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting skill:', error);
      return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Skills DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
