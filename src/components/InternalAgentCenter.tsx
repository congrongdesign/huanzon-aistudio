'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, AlertTriangle, RefreshCw, Wand2, Search, MessageSquareText, ClipboardCheck, LayoutDashboard, PackageCheck, Database, Settings, MonitorCog, ExternalLink } from 'lucide-react';

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

interface CapabilityResponse {
  checkedAt: string;
  platform: string;
  capabilities: LocalCapability[];
  groups: Record<string, { ready: number; total: number }>;
  summary: {
    agentReady: boolean;
    localModelReady: boolean;
    pptReady: boolean;
    assetReady: boolean;
  };
}

type AgentAction = 'ppt' | 'assets' | 'settings' | 'canvas';

type CapabilityGuide = {
  purpose: string;
  steps: string[];
  downloadUrl?: string;
  downloadLabel?: string;
  secondaryUrl?: string;
  secondaryLabel?: string;
  configAction?: AgentAction;
  configLabel?: string;
  tip?: string;
};

interface InternalAgentCenterProps {
  onNavigate: (target: AgentAction) => void;
  onClose?: () => void;
}

const AGENTS = [
  {
    id: 'ppt-director',
    name: 'PPT 美化导演',
    icon: Wand2,
    desc: '上传 PPT 后自动拆解任务、定风格、分批生成、组织审核与导出。',
    requires: ['libreoffice', 'nas', 'feishu', 'ollama'],
    optional: ['codex', 'claude'],
    action: 'ppt' as AgentAction,
    actionLabel: '进入 PPT 导入',
  },
  {
    id: 'asset-researcher',
    name: '资产检索员',
    icon: Search,
    desc: '从 NAS、本地文件夹、飞书知识库里查找参考图、品牌资料和过往项目。',
    requires: ['nas', 'feishu'],
    optional: [],
    action: 'assets' as AgentAction,
    actionLabel: '打开资产库',
  },
  {
    id: 'prompt-engineer',
    name: '提示词工程师',
    icon: MessageSquareText,
    desc: '把简单想法拆成可执行提示词，生成风格提示、页面提示和反向约束。',
    requires: ['ollama'],
    optional: ['codex', 'claude', 'gemini', 'qwen'],
    action: 'settings' as AgentAction,
    actionLabel: '检查模型配置',
  },
  {
    id: 'design-reviewer',
    name: '设计评审员',
    icon: ClipboardCheck,
    desc: '检查文字完整、风格统一、排版层级、清晰度和生成风险。',
    requires: ['ollama'],
    optional: ['gemini', 'qwen'],
    action: 'ppt' as AgentAction,
    actionLabel: '去审核 PPT',
  },
  {
    id: 'canvas-operator',
    name: '画布执行员',
    icon: LayoutDashboard,
    desc: '把生成图整理到画布，辅助多方案布局、引用、收藏和交付前整理。',
    requires: [],
    optional: ['codex'],
    action: 'canvas' as AgentAction,
    actionLabel: '返回画布',
  },
  {
    id: 'delivery-packer',
    name: '交付打包员',
    icon: PackageCheck,
    desc: '在审核完成后整理高清图片包、图片版 PPT 和项目交付说明。',
    requires: ['libreoffice'],
    optional: ['poppler'],
    action: 'ppt' as AgentAction,
    actionLabel: '去导出交付',
  },
];

function statusLabel(status: CapabilityStatus): string {
  if (status === 'ready') return '可用';
  if (status === 'partial') return '需处理';
  if (status === 'missing') return '未配置';
  return '未知';
}

function statusClass(status: CapabilityStatus): string {
  if (status === 'ready') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20';
  if (status === 'partial') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
  if (status === 'missing') return 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20';
  return 'bg-muted text-muted-foreground border-border';
}

function kindLabel(kind: CapabilityKind): string {
  return {
    agent: '可选 AI 工具',
    model: '模型服务',
    ppt: 'PPT 工具',
    asset: '资料来源',
    runtime: '运行环境',
  }[kind];
}

const CAPABILITY_GUIDES: Record<string, CapabilityGuide> = {
  codex: {
    purpose: '开发维护平台时使用，右侧设计 Agent 不依赖它。',
    steps: ['安装 Node.js 后安装 Codex CLI。', '在终端登录 Codex。', '回到这里点击“重新检测”。'],
    downloadUrl: 'https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started',
    downloadLabel: 'OpenAI Codex CLI 说明',
    secondaryUrl: 'https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt',
    secondaryLabel: 'Codex 登录说明',
    tip: '普通设计工作不用配置 Codex。',
  },
  claude: {
    purpose: '可选代码助手，适合后续维护平台或检查代码。',
    steps: ['打开 Anthropic 官方安装说明。', '按系统安装 Claude Code。', '登录后回到这里重新检测。'],
    downloadUrl: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
    downloadLabel: 'Claude Code 安装说明',
    tip: '不是设计 Agent 的必需项。',
  },
  gemini: {
    purpose: '可选长上下文 CLI 工具，用于资料分析或开发辅助。',
    steps: ['打开 Gemini CLI 官方仓库。', '按 README 安装并登录。', '重新检测确认命令可用。'],
    downloadUrl: 'https://github.com/google-gemini/gemini-cli',
    downloadLabel: 'Gemini CLI 官方仓库',
  },
  qwen: {
    purpose: '可选中文 CLI 工具，用于中文资料整理和开发辅助。',
    steps: ['打开 Qwen Code 官方文档。', '按文档安装并配置账号或 API Key。', '重新检测确认 qwen 命令可用。'],
    downloadUrl: 'https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/qwen-code',
    downloadLabel: 'Qwen Code 官方文档',
  },
  ollama: {
    purpose: '在本机运行大语言模型，可作为本地模型服务。',
    steps: ['下载安装 Ollama。', '启动 Ollama。', '下载一个模型，例如 qwen 或 llama。', '在设置里把模型地址填为 http://127.0.0.1:11434/v1。'],
    downloadUrl: 'https://ollama.com/download',
    downloadLabel: '下载 Ollama',
    configAction: 'settings',
    configLabel: '打开模型设置',
    tip: '如果你只用 grsai API，Ollama 可以暂时不装。',
  },
  comfyui: {
    purpose: '本地生图工作流工具，适合以后接入本地 Stable Diffusion / Flux 工作流。',
    steps: ['优先下载安装 ComfyUI Desktop。', '启动后确认服务能访问 8188 端口。', '安装需要的模型和工作流。', '回到这里重新检测。'],
    downloadUrl: 'https://www.comfy.org/download',
    downloadLabel: '下载 ComfyUI Desktop',
    secondaryUrl: 'https://docs.comfy.org/get_started/manual_install',
    secondaryLabel: '手动安装说明',
    tip: '当前平台主要用 grsai 生图，本地 ComfyUI 是增强项。',
  },
  libreoffice: {
    purpose: 'PPTX 拆页必需工具，用来把 PPT 原稿转换为图片供导入流程处理。',
    steps: ['下载安装 LibreOffice。', '安装完成后重新打开本平台。', '回到这里点击“重新检测”。', '检测通过后即可上传 PPTX。'],
    downloadUrl: 'https://www.libreoffice.org/download/download-libreoffice/',
    downloadLabel: '下载 LibreOffice',
    configAction: 'ppt',
    configLabel: '打开 PPT 导入',
    tip: '如果暂时不装，也可以先把 PPT 导出为图片包上传。',
  },
  poppler: {
    purpose: 'PDF / 图片转换辅助工具，用于更稳定地处理 PDF 或部分预览转换。',
    steps: ['macOS 推荐用 Homebrew 安装。', '安装命令：brew install poppler。', '安装后重新检测。'],
    downloadUrl: 'https://formulae.brew.sh/formula/poppler',
    downloadLabel: 'Homebrew Poppler',
    secondaryUrl: 'https://poppler.freedesktop.org/',
    secondaryLabel: 'Poppler 官方网站',
    tip: 'PPTX 优先依赖 LibreOffice，Poppler 是辅助项。',
  },
  nas: {
    purpose: '连接你的 NAS 或本地图片文件夹，让资产库能读取参考图。',
    steps: ['先在系统里确认 NAS 文件夹能打开。', '进入资产库。', '填写 NAS 或本地文件夹路径。', '点击同步或刷新文件夹。'],
    configAction: 'assets',
    configLabel: '打开资产库配置',
    tip: '路径配置好后，Agent 和画布都能从资产库选择参考图。',
  },
  feishu: {
    purpose: '连接飞书知识库，用于读取团队资料、品牌规范、项目文档。',
    steps: ['进入飞书开放平台。', '创建企业自建应用。', '复制 App ID 和 App Secret。', '回到资产库配置飞书。'],
    downloadUrl: 'https://open.feishu.cn/document',
    downloadLabel: '飞书开放平台文档',
    secondaryUrl: 'https://open.feishu.cn/app',
    secondaryLabel: '飞书开发者后台',
    configAction: 'assets',
    configLabel: '打开飞书配置',
    tip: '需要企业管理员或有权限的人创建应用并授权知识库相关权限。',
  },
  node: {
    purpose: '开发和构建运行环境。桌面安装包通常会内置，开发机需要安装。',
    steps: ['下载 Node.js LTS。', '安装后重新打开终端。', '回到这里重新检测。'],
    downloadUrl: 'https://nodejs.org/en/download',
    downloadLabel: '下载 Node.js',
    tip: '普通使用桌面版通常不用管。',
  },
  pnpm: {
    purpose: '项目开发和构建用的包管理器。',
    steps: ['先安装 Node.js。', '按 pnpm 官方文档安装。', '回到这里重新检测。'],
    downloadUrl: 'https://pnpm.io/installation',
    downloadLabel: 'pnpm 安装说明',
    tip: '普通使用桌面版通常不用管。',
  },
};

export default function InternalAgentCenter({ onNavigate, onClose }: InternalAgentCenterProps) {
  const [data, setData] = useState<CapabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/local-capabilities', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '检测失败');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '检测失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities]);

  const capabilityMap = useMemo(() => new Map((data?.capabilities || []).map((item) => [item.id, item])), [data]);

  const readiness = useMemo(() => {
    return AGENTS.map((agent) => {
      const required = agent.requires.map((id) => capabilityMap.get(id)).filter(Boolean) as LocalCapability[];
      const requiredReady = required.filter((item) => item.status === 'ready').length;
      const requiredTotal = agent.requires.length;
      const usable = requiredTotal === 0 || requiredReady > 0 || agent.id === 'ppt-director';
      const score = requiredTotal === 0 ? 100 : Math.round((requiredReady / requiredTotal) * 100);
      return { ...agent, required, requiredReady, requiredTotal, usable, score };
    });
  }, [capabilityMap]);

  const grouped = useMemo(() => {
    const groups: Record<CapabilityKind, LocalCapability[]> = { agent: [], model: [], ppt: [], asset: [], runtime: [] };
    for (const item of data?.capabilities || []) groups[item.kind].push(item);
    return groups;
  }, [data]);

  return (
    <div className="agent-center flex-1 h-full overflow-y-auto bg-background text-foreground">
      <div className="min-h-full p-6 lg:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary mb-3">
              <Bot className="w-3.5 h-3.5" />
              团队内部 Agent，不连接公开插件市场
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agent 中心</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground leading-relaxed">
              这里负责检测本机能力，并把复杂工作拆成可执行流程。第一版先服务 PPT 美化、资产检索、提示词、设计评审和交付打包。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadCapabilities} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              重新检测
            </button>
            {onClose && <button onClick={onClose} className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted">返回</button>}
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-6">
          <SummaryCard title="可选 AI 工具" value={data?.summary.agentReady ? '已检测到' : '可选安装'} ready={!!data?.summary.agentReady} icon={<MonitorCog className="w-4 h-4" />} />
          <SummaryCard title="模型服务" value={data?.summary.localModelReady ? '本地可用' : '用 API 配置'} ready={!!data?.summary.localModelReady} icon={<Settings className="w-4 h-4" />} />
          <SummaryCard title="PPT 工具" value={data?.summary.pptReady ? '可拆页' : '建议安装'} ready={!!data?.summary.pptReady} icon={<ClipboardCheck className="w-4 h-4" />} />
          <SummaryCard title="资料来源" value={data?.summary.assetReady ? '已连接' : '待配置'} ready={!!data?.summary.assetReady} icon={<Database className="w-4 h-4" />} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">内部 Agent</h2>
              <span className="text-xs text-muted-foreground">按当前本机能力自动判断可用性</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {readiness.map((agent) => {
                const Icon = agent.icon;
                const missing = agent.requires
                  .map((id) => capabilityMap.get(id))
                  .filter((item): item is LocalCapability => Boolean(item && item.status !== 'ready'));
                return (
                  <div key={agent.id} className="rounded-3xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm text-foreground">{agent.name}</h3>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${agent.score >= 80 ? statusClass('ready') : agent.score > 0 ? statusClass('partial') : statusClass('missing')}`}>
                            {agent.score >= 80 ? '准备充分' : agent.score > 0 ? '可先使用' : '基础可用'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{agent.desc}</p>
                      </div>
                    </div>
                    <div className="mt-4 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-foreground/65 transition-all" style={{ width: `${Math.max(12, agent.score)}%` }} />
                    </div>
                    {missing.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        {missing.slice(0, 2).map((item) => (
                          <div key={item.id} className="flex items-start gap-2 rounded-xl bg-muted/70 px-3 py-2 text-[11px] text-muted-foreground">
                            <AlertTriangle className="mt-0.5 w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>{item.label}：{item.nextStep}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        关键依赖已满足
                      </div>
                    )}
                    <button onClick={() => onNavigate(agent.action)} className="mt-4 inline-flex items-center justify-center rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/15 hover:border-primary/30">
                      {agent.actionLabel}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">本机能力明细</h2>
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  每一项都附带用途、准备步骤和下载链接。先配置 `PPT 工具`、`资料来源`、`模型服务` 这三类即可。
                </p>
              </div>
              {loading && !data ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
                </div>
              ) : (
                <div className="space-y-4">
                  {(Object.keys(grouped) as CapabilityKind[]).map((kind) => grouped[kind].length > 0 && (
                    <div key={kind}>
                      <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{kindLabel(kind)}</div>
                      <div className="space-y-1.5">
                        {grouped[kind].map((item) => {
                          const guide = CAPABILITY_GUIDES[item.id];
                          return (
                            <div key={item.id} className="rounded-2xl border border-border bg-background/60 px-3 py-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-foreground truncate">{item.label}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] shrink-0 ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{item.summary}</p>
                              {item.version && <p className="mt-1 text-[10px] text-muted-foreground/70 truncate">{item.version}</p>}
                              {guide && (
                                <div className="mt-2 rounded-xl border border-border/70 bg-card/70 p-2.5">
                                  <p className="text-[11px] font-medium text-foreground">用途：{guide.purpose}</p>
                                  <ol className="mt-1.5 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                                    {guide.steps.map((step, index) => (
                                      <li key={index} className="flex gap-1.5">
                                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] text-primary">{index + 1}</span>
                                        <span>{step}</span>
                                      </li>
                                    ))}
                                  </ol>
                                  {guide.tip && (
                                    <div className="mt-2 rounded-lg bg-muted/70 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                                      提示：{guide.tip}
                                    </div>
                                  )}
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {guide.downloadUrl && (
                                      <a
                                        href={guide.downloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/15"
                                      >
                                        {guide.downloadLabel || '下载 / 文档'}
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                    {guide.secondaryUrl && (
                                      <a
                                        href={guide.secondaryUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted"
                                      >
                                        {guide.secondaryLabel || '更多说明'}
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                    {guide.configAction && (
                                      <button
                                        onClick={() => onNavigate(guide.configAction!)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted"
                                      >
                                        {guide.configLabel || '打开配置'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-primary/20 bg-primary/10 p-5">
              <h2 className="text-sm font-semibold text-foreground mb-2">推荐下一步</h2>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                先从 PPT 导入开始：上传 PPT 或图片包，填写 Brief，选择风格预设，Agent 会把任务拆成可审核的阶段。
              </p>
              <button onClick={() => onNavigate('ppt')} className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/15">
                开始 PPT 导入
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, ready, icon }: { title: string; value: string; ready: boolean; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${ready ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
          {ready ? '就绪' : '待配置'}
        </span>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
