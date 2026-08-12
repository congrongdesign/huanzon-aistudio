import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { findLibreOffice, findPdfInfo, findPdfToPpm, getDocToolPathEnv } from '@/lib/doc-tools';
import { readKnowledgeHubConfig } from '@/lib/knowledge-hub-store';

const execFileAsync = promisify(execFile);

type CapabilityStatus = 'ready' | 'missing' | 'partial' | 'unknown';
type CapabilityKind = 'agent' | 'model' | 'ppt' | 'asset' | 'runtime';

interface LocalCapability {
  id: string;
  label: string;
  kind: CapabilityKind;
  status: CapabilityStatus;
  summary: string;
  command?: string;
  version?: string;
  path?: string;
  nextStep: string;
}

const COMMON_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/Applications/LibreOffice.app/Contents/MacOS',
  '/Applications/ComfyUI.app/Contents/MacOS',
];

function normalizePathEnv(): string {
  return Array.from(new Set([...getDocToolPathEnv().split(path.delimiter), ...COMMON_PATHS].filter(Boolean))).join(path.delimiter);
}

function firstLine(input: string): string {
  return input.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

async function commandExists(command: string, versionArgs: string[] = ['--version']): Promise<{ ok: boolean; path?: string; version?: string }> {
  const env = { ...process.env, PATH: normalizePathEnv() };
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'command';
    const whichArgs = process.platform === 'win32' ? [command] : ['-v', command];
    const located = await execFileAsync(whichCmd, whichArgs, { env, timeout: 2500, shell: process.platform !== 'win32' });
    const binPath = firstLine(`${located.stdout || ''}${located.stderr || ''}`);
    let version = '';
    try {
      const result = await execFileAsync(command, versionArgs, { env, timeout: 3500 });
      version = firstLine(`${result.stdout || ''}${result.stderr || ''}`);
    } catch {
      version = '';
    }
    return { ok: true, path: binPath || command, version };
  } catch {
    return { ok: false };
  }
}

async function checkHttp(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function capability(input: LocalCapability): LocalCapability {
  return input;
}

export async function GET() {
  const libreOfficePath = findLibreOffice();
  const pdfInfoPath = findPdfInfo();
  const pdfToPpmPath = findPdfToPpm();
  const [
    codex,
    claude,
    gemini,
    qwen,
    ollama,
    libreOffice,
    pdfInfo,
    pdftoppm,
    node,
    pnpm,
  ] = await Promise.all([
    commandExists('codex', ['--version']),
    commandExists('claude', ['--version']),
    commandExists('gemini', ['--version']),
    commandExists('qwen', ['--version']),
    commandExists('ollama', ['--version']),
    libreOfficePath ? commandExists(libreOfficePath, ['--version']) : commandExists('soffice', ['--version']),
    pdfInfoPath ? commandExists(pdfInfoPath, ['-v']) : commandExists('pdfinfo', ['-v']),
    pdfToPpmPath ? commandExists(pdfToPpmPath, ['-v']) : commandExists('pdftoppm', ['-v']),
    commandExists('node', ['--version']),
    commandExists('pnpm', ['--version']),
  ]);

  const comfyReady = await checkHttp('http://127.0.0.1:8188/system_stats');
  const ollamaReady = ollama.ok && await checkHttp('http://127.0.0.1:11434/api/tags');
  const khConfig = readKnowledgeHubConfig();
  const nasReady = khConfig.nas.enabled && Boolean(khConfig.nas.rootPath) && fs.existsSync(khConfig.nas.rootPath);
  const feishuReady = khConfig.feishu.enabled && Boolean(khConfig.feishu.appId && khConfig.feishu.appSecret);
  const popplerReady = pdfInfo.ok || pdftoppm.ok;

  const capabilities: LocalCapability[] = [
    capability({
      id: 'codex',
      label: 'Codex CLI',
      kind: 'agent',
      status: codex.ok ? 'ready' : 'missing',
      summary: codex.ok ? '已检测到 Codex CLI。右侧设计 Agent 不依赖它，开发维护时可使用。' : '未检测到 Codex 命令行。',
      command: 'codex',
      version: codex.version,
      path: codex.path,
      nextStep: codex.ok ? '设计 Agent 已改为平台内执行，不需要 Codex 参与。' : '可选能力，不影响设计 Agent 使用。',
    }),
    capability({
      id: 'claude',
      label: 'Claude Code',
      kind: 'agent',
      status: claude.ok ? 'ready' : 'missing',
      summary: claude.ok ? '已检测到 Claude Code。' : '未检测到 Claude Code。',
      command: 'claude',
      version: claude.version,
      path: claude.path,
      nextStep: claude.ok ? '可作为可选开发维护工具。' : '可选能力，不影响设计 Agent 使用。',
    }),
    capability({
      id: 'gemini',
      label: 'Gemini CLI',
      kind: 'agent',
      status: gemini.ok ? 'ready' : 'missing',
      summary: gemini.ok ? '已检测到 Gemini CLI。' : '未检测到 Gemini CLI。',
      command: 'gemini',
      version: gemini.version,
      path: gemini.path,
      nextStep: gemini.ok ? '可用于长上下文资料分析。' : '可选能力，不影响设计 Agent 使用。',
    }),
    capability({
      id: 'qwen',
      label: 'Qwen CLI',
      kind: 'agent',
      status: qwen.ok ? 'ready' : 'missing',
      summary: qwen.ok ? '已检测到 Qwen CLI。' : '未检测到 Qwen CLI。',
      command: 'qwen',
      version: qwen.version,
      path: qwen.path,
      nextStep: qwen.ok ? '可用于中文资料整理。' : '可选能力，不影响设计 Agent 使用。',
    }),
    capability({
      id: 'ollama',
      label: 'Ollama 本地模型',
      kind: 'model',
      status: ollamaReady ? 'ready' : ollama.ok ? 'partial' : 'missing',
      summary: ollamaReady ? 'Ollama 已安装且服务可访问。' : ollama.ok ? 'Ollama 已安装，但本地服务未启动。' : '未检测到 Ollama。',
      command: 'ollama',
      version: ollama.version,
      path: ollama.path,
      nextStep: ollamaReady ? '可在模型中心填入 http://127.0.0.1:11434/v1 使用。' : ollama.ok ? '启动 Ollama 后重新检测。' : '如需本地大模型，可安装 Ollama。',
    }),
    capability({
      id: 'comfyui',
      label: 'ComfyUI 本地生图',
      kind: 'model',
      status: comfyReady ? 'ready' : 'missing',
      summary: comfyReady ? 'ComfyUI 服务已在 8188 端口响应。' : '未检测到 ComfyUI 服务。',
      nextStep: comfyReady ? '后续可接入本地生图工作流。' : '如需本地生图，启动 ComfyUI 后重新检测。',
    }),
    capability({
      id: 'libreoffice',
      label: 'LibreOffice PPT 拆页',
      kind: 'ppt',
      status: libreOffice.ok ? 'ready' : 'missing',
      summary: libreOffice.ok ? '已检测到 LibreOffice，可用于 PPTX 转图片。' : '未检测到 LibreOffice，PPTX 拆页可能不可用。',
      command: 'soffice',
      version: libreOffice.version,
      path: libreOffice.path,
      nextStep: libreOffice.ok ? 'PPTX 可直接导入拆页。' : '安装 LibreOffice，或先把 PPT 导出为图片 ZIP 上传。',
    }),
    capability({
      id: 'poppler',
      label: 'Poppler PDF 工具',
      kind: 'ppt',
      status: popplerReady ? 'ready' : 'missing',
      summary: popplerReady ? '已检测到 Poppler 工具。' : '未检测到 Poppler。',
      command: pdfInfo.ok ? 'pdfinfo' : pdftoppm.ok ? 'pdftoppm' : undefined,
      version: pdfInfo.version || pdftoppm.version,
      path: pdfInfo.path || pdftoppm.path,
      nextStep: popplerReady ? '可辅助 PDF/PPT 预览转换。' : '可选能力，PPTX 优先依赖 LibreOffice。',
    }),
    capability({
      id: 'nas',
      label: 'NAS / 本地资产路径',
      kind: 'asset',
      status: nasReady ? 'ready' : khConfig.nas.enabled ? 'partial' : 'missing',
      summary: nasReady ? `已连接：${khConfig.nas.rootPath}` : khConfig.nas.enabled ? 'NAS 已启用，但路径不存在或不可访问。' : 'NAS / 本地资产路径未启用。',
      path: khConfig.nas.rootPath || undefined,
      nextStep: nasReady ? 'Agent 可从资产库选择参考图。' : '到资产库填写 NAS 或本地文件夹路径。',
    }),
    capability({
      id: 'feishu',
      label: '飞书知识库',
      kind: 'asset',
      status: feishuReady ? 'ready' : khConfig.feishu.enabled ? 'partial' : 'missing',
      summary: feishuReady ? '飞书 App ID / Secret 已配置。' : khConfig.feishu.enabled ? '飞书已启用，但 App ID 或 Secret 不完整。' : '飞书知识库未启用。',
      nextStep: feishuReady ? 'Agent 可读取团队知识库资料。' : '到资产库配置飞书 App ID / Secret。',
    }),
    capability({
      id: 'node',
      label: 'Node.js',
      kind: 'runtime',
      status: node.ok ? 'ready' : 'missing',
      summary: node.ok ? 'Node.js 可用。' : '未检测到 Node.js。',
      command: 'node',
      version: node.version,
      path: node.path,
      nextStep: node.ok ? '桌面版内置环境通常无需处理。' : '开发环境需要安装 Node.js。',
    }),
    capability({
      id: 'pnpm',
      label: 'pnpm',
      kind: 'runtime',
      status: pnpm.ok ? 'ready' : 'missing',
      summary: pnpm.ok ? 'pnpm 可用。' : '未检测到 pnpm。',
      command: 'pnpm',
      version: pnpm.version,
      path: pnpm.path,
      nextStep: pnpm.ok ? '可用于本地构建和更新。' : '开发环境需要安装 pnpm。',
    }),
  ];

  const groups = capabilities.reduce<Record<CapabilityKind, { ready: number; total: number }>>((acc, item) => {
    acc[item.kind] ||= { ready: 0, total: 0 };
    acc[item.kind].total += 1;
    if (item.status === 'ready') acc[item.kind].ready += 1;
    return acc;
  }, {} as Record<CapabilityKind, { ready: number; total: number }>);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    capabilities,
    groups,
    summary: {
      agentReady: capabilities.some((item) => item.kind === 'agent' && item.status === 'ready'),
      localModelReady: ollamaReady || comfyReady,
      pptReady: libreOffice.ok,
      assetReady: nasReady || feishuReady,
    },
  });
}
