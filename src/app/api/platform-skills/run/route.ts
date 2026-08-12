import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getPlatformSkill } from '@/lib/platform-skill-library';
import { createSkillRun, updateSkillRun, refreshSkillRunResults } from '@/lib/skill-run-store';
import { getProjectById, isLocalBackendEnabled, resolveLocalFilePath } from '@/lib/local-backend';
import { getKnowledgeHubItemById } from '@/lib/knowledge-hub-store';

const LOCAL_FILE_PREFIX = '/api/local-file/';
const KH_PREVIEW_PATH = '/api/knowledge-hub/preview';
const ALLOWED_INPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.ppt', '.pptx', '.zip']);

type ParsedRunRequest = {
  skillId?: string;
  projectId?: string;
  prompt?: string;
  imageUrls: string[];
  files: File[];
};

function normalizePathEnv(): string {
  const common = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  return Array.from(new Set([...(process.env.PATH || '').split(path.delimiter), ...common].filter(Boolean))).join(path.delimiter);
}

function skillInstallPath(skillId: string) {
  const home = process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), '.codex');
  return path.join(home, 'skills', skillId, 'SKILL.md');
}

function extensionFromUrl(url: string) {
  const clean = url.split('?')[0];
  const ext = path.extname(clean).toLowerCase();
  return ext && ext.length <= 6 ? ext : '.png';
}

function extensionFromFile(file: File) {
  const ext = path.extname(file.name || '').toLowerCase();
  if (ext) return ext;
  if (file.type === 'application/pdf') return '.pdf';
  if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx';
  if (file.type === 'application/vnd.ms-powerpoint') return '.ppt';
  if (file.type === 'application/zip') return '.zip';
  if (file.type === 'image/jpeg') return '.jpg';
  if (file.type === 'image/webp') return '.webp';
  return '.png';
}

function safeBaseName(name: string, fallback: string) {
  const base = path.basename(name || fallback, path.extname(name || ''));
  return (base || fallback).replace(/[^\w\u4e00-\u9fa5.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

async function readInputBuffer(url: string): Promise<{ buffer: Buffer; ext: string } | null> {
  try {
    if (url.startsWith(LOCAL_FILE_PREFIX)) {
      const key = decodeURIComponent(url.split('/').pop() || '');
      if (!key) return null;
      const filePath = resolveLocalFilePath(key);
      return { buffer: fs.readFileSync(filePath), ext: path.extname(filePath) || extensionFromUrl(url) };
    }

    let parsed: URL | null = null;
    try {
      parsed = url.startsWith('/') ? new URL(url, 'http://localhost') : new URL(url);
    } catch {
      parsed = null;
    }

    if (parsed?.pathname === KH_PREVIEW_PATH) {
      const id = parsed.searchParams.get('id') || '';
      const item = id ? getKnowledgeHubItemById(id) : null;
      if (item?.externalId && fs.existsSync(item.externalId)) {
        return { buffer: fs.readFileSync(item.externalId), ext: path.extname(item.externalId) || extensionFromUrl(url) };
      }
    }

    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      return { buffer: Buffer.from(await res.arrayBuffer()), ext: extensionFromUrl(url) };
    }

    if (url.startsWith('/') && fs.existsSync(url)) {
      return { buffer: fs.readFileSync(url), ext: path.extname(url) || extensionFromUrl(url) };
    }
  } catch {
    return null;
  }
  return null;
}

async function writeInputFiles(runId: string, outputDir: string, imageUrls: string[]) {
  const inputDir = path.join(outputDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  const files: string[] = [];
  let index = 1;
  for (const url of imageUrls) {
    const input = await readInputBuffer(url);
    if (!input) continue;
    const safeExt = input.ext.replace(/[^a-zA-Z0-9.]/g, '') || '.png';
    const file = path.join(inputDir, `page_${String(index).padStart(3, '0')}${safeExt}`);
    fs.writeFileSync(file, input.buffer);
    files.push(file);
    index += 1;
  }
  fs.writeFileSync(path.join(outputDir, 'input_urls.json'), JSON.stringify({ runId, imageUrls, files }, null, 2), 'utf8');
  return files;
}

async function writeUploadedInputFiles(runId: string, outputDir: string, uploadedFiles: File[], startIndex: number) {
  const inputDir = path.join(outputDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  const files: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let index = startIndex;

  for (const uploaded of uploadedFiles) {
    if (!uploaded || uploaded.size <= 0) continue;
    const ext = extensionFromFile(uploaded).toLowerCase();
    if (!ALLOWED_INPUT_EXTENSIONS.has(ext)) {
      skipped.push({ name: uploaded.name || `file_${index}`, reason: `不支持 ${ext || '未知'} 格式` });
      continue;
    }
    const name = safeBaseName(uploaded.name, `input_${index}`);
    const filePath = path.join(inputDir, `${String(index).padStart(3, '0')}-${name}${ext}`);
    fs.writeFileSync(filePath, Buffer.from(await uploaded.arrayBuffer()));
    files.push(filePath);
    index += 1;
  }

  fs.writeFileSync(
    path.join(outputDir, 'input_uploads.json'),
    JSON.stringify({ runId, files, skipped }, null, 2),
    'utf8'
  );
  return { files, skipped };
}

async function parseRunRequest(request: NextRequest): Promise<ParsedRunRequest> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const imageUrlsRaw = form.getAll('imageUrls');
    const imageUrls = imageUrlsRaw
      .flatMap((value) => {
        if (typeof value !== 'string') return [];
        try {
          const parsed = JSON.parse(value) as unknown;
          return Array.isArray(parsed) ? parsed.map(String) : [value];
        } catch {
          return value.split('\n');
        }
      })
      .map((value) => value.trim())
      .filter(Boolean);
    const files = [...form.getAll('files'), ...form.getAll('file')].filter((value): value is File => value instanceof File);
    return {
      skillId: String(form.get('skillId') || ''),
      projectId: String(form.get('projectId') || ''),
      prompt: String(form.get('prompt') || ''),
      imageUrls,
      files,
    };
  }

  const body = (await request.json()) as { skillId?: string; projectId?: string; prompt?: string; imageUrls?: string[] };
  return {
    skillId: body.skillId,
    projectId: body.projectId,
    prompt: body.prompt,
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter(Boolean) : [],
    files: [],
  };
}

function runCodexSkill(recordId: string, skillId: string, prompt: string, inputFiles: string[], outputDir: string) {
  const finalPrompt = [
    `$${skillId}`,
    prompt,
    '',
    `输入文件：${inputFiles.join('\n')}`,
    `输出目录必须使用：${outputDir}`,
    '请把最终 PPTX、预览和校验报告放到输出目录的 final/ 或当前任务目录内。',
    '当前运行由本地平台后台触发，请不要请求人工确认；遇到不可恢复问题时写入报告并结束。',
  ].join('\n');

  const args = [
    'exec',
    '--cd',
    process.cwd(),
    '--sandbox',
    'danger-full-access',
    finalPrompt,
  ];
  const command = `codex ${args.map((a) => JSON.stringify(a)).join(' ')}`;
  updateSkillRun(recordId, { status: 'running', startedAt: new Date().toISOString(), command });
  fs.appendFileSync(path.join(outputDir, 'run.log'), `${new Date().toISOString()} ${command}\n\n`, 'utf8');

  const child = spawn('codex', args, {
    cwd: process.cwd(),
    env: { ...process.env, PATH: normalizePathEnv() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => fs.appendFileSync(path.join(outputDir, 'run.log'), chunk));
  child.stderr.on('data', (chunk) => fs.appendFileSync(path.join(outputDir, 'run.log'), chunk));
  child.on('error', (err) => {
    fs.appendFileSync(path.join(outputDir, 'run.log'), `\n[error] ${err.message}\n`, 'utf8');
    updateSkillRun(recordId, { status: 'failed', error: err.message, finishedAt: new Date().toISOString() });
  });
  child.on('exit', (code) => {
    const refreshed = refreshSkillRunResults(recordId);
    updateSkillRun(recordId, {
      status: code === 0 ? 'completed' : 'failed',
      error: code === 0 ? undefined : `Codex skill 运行失败，退出码 ${code}`,
      resultFiles: refreshed?.resultFiles || [],
      finishedAt: new Date().toISOString(),
    });
  });
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  try {
    const body = await parseRunRequest(request);
    const skill = getPlatformSkill(body.skillId || '');
    const projectId = (body.projectId || '').trim();
    if (!skill || !projectId) return NextResponse.json({ error: 'skillId and projectId are required' }, { status: 400 });
    if (isLocalBackendEnabled() && !getProjectById(projectId, userId)) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 403 });
    }
    if (!fs.existsSync(skillInstallPath(skill.id))) {
      return NextResponse.json({ error: `本机未安装 ${skill.id}，请重启 Codex 或重新安装 skill。` }, { status: 400 });
    }
    const imageUrls = body.imageUrls.filter(Boolean);
    const uploadedFiles = body.files;
    if (imageUrls.length === 0 && uploadedFiles.length === 0) {
      return NextResponse.json({ error: '请先选择画布图片，或上传图片/PDF/PPT/PPTX 文件。' }, { status: 400 });
    }

    const record = createSkillRun({ skillId: skill.id, projectId, userId, prompt: body.prompt?.trim() || skill.defaultPrompt });
    const inputFiles = [
      ...(await writeInputFiles(record.id, record.outputDir, imageUrls)),
    ];
    const uploaded = await writeUploadedInputFiles(record.id, record.outputDir, uploadedFiles, inputFiles.length + 1);
    inputFiles.push(...uploaded.files);
    if (inputFiles.length === 0) {
      const reason = uploaded.skipped.length > 0 ? uploaded.skipped.map((item) => `${item.name}: ${item.reason}`).join('；') : '输入文件无法读取';
      updateSkillRun(record.id, { status: 'failed', error: reason, finishedAt: new Date().toISOString() });
      return NextResponse.json({ error: reason }, { status: 400 });
    }
    const nextRecord = updateSkillRun(record.id, { inputFiles }) || { ...record, inputFiles };
    runCodexSkill(record.id, skill.id, body.prompt?.trim() || skill.defaultPrompt, inputFiles, record.outputDir);

    return NextResponse.json({ success: true, run: nextRecord });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '运行技能失败' }, { status: 500 });
  }
}
