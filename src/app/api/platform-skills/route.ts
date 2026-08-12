import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { PLATFORM_SKILL_LIBRARY, getPlatformSkill } from '@/lib/platform-skill-library';
import { createSkill, getProjectById, isLocalBackendEnabled } from '@/lib/local-backend';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function skillInstallPath(skillId: string) {
  const home = process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), '.codex');
  return path.join(home, 'skills', skillId, 'SKILL.md');
}

async function canAccessProject(projectId: string, userId: string) {
  if (!projectId) return false;
  if (isLocalBackendEnabled()) return Boolean(getProjectById(projectId, userId));
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', userId).single();
  return Boolean(data);
}

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const skills = PLATFORM_SKILL_LIBRARY.map((skill) => ({
    ...skill,
    installed: fs.existsSync(skillInstallPath(skill.id)),
    installPath: fs.existsSync(skillInstallPath(skill.id)) ? skillInstallPath(skill.id) : undefined,
  }));

  return NextResponse.json({ skills });
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { projectId?: string; skillId?: string };
    const projectId = (body.projectId || '').trim();
    const skill = getPlatformSkill(body.skillId || '');
    if (!projectId || !skill) {
      return NextResponse.json({ error: 'projectId and valid skillId are required' }, { status: 400 });
    }
    if (!(await canAccessProject(projectId, userId))) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }

    if (isLocalBackendEnabled()) {
      const created = createSkill(userId, {
        project_id: projectId,
        name: skill.name,
        description: `${skill.subtitle}\n来源：${skill.sourceRepo}`,
        steps: JSON.stringify(skill.customSkillSteps),
      });
      return NextResponse.json({ success: true, skill: created });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('custom_skills')
      .insert({
        project_id: projectId,
        name: skill.name,
        description: `${skill.subtitle}\n来源：${skill.sourceRepo}`,
        steps: JSON.stringify(skill.customSkillSteps),
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, skill: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '安装技能失败' }, { status: 500 });
  }
}
