'use client';

import { useRef, useState } from 'react';
import { Check, FolderOpen, Loader2, Spline } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { FontCreationRun } from '@/lib/font-creation-types';

type TraceResult = { success: boolean; file?: string; paths?: number; live?: boolean; panelOpened?: boolean; error?: string };
type Bridge = { isDesktop?: boolean; platform?: string; traceInIllustrator?: (request: { url: string; title: string; mode: 'black-white' | 'color'; threshold: number; ignoreWhite: boolean; keepEditableTrace: boolean }) => Promise<TraceResult>; revealExport?: (file: string) => Promise<{ success: boolean; error?: string }> };
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted disabled:opacity-40 disabled:pointer-events-none';

export default function IllustratorTraceDialog({ run, onClose }: { run: FontCreationRun; onClose: () => void }) {
  const [mode, setMode] = useState<'black-white' | 'color'>('black-white');
  const [threshold, setThreshold] = useState(128), [ignoreWhite, setIgnoreWhite] = useState(true);
  const [keepEditableTrace, setKeepEditableTrace] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<TraceResult | null>(null);
  const running = useRef(false);
  const bridge = typeof window !== 'undefined' ? (window as Window & { electronAPI?: Bridge }).electronAPI : undefined;
  const available = !!bridge?.traceInIllustrator && ['darwin', 'win32'].includes(bridge.platform || '');
  const unavailableMessage = !bridge?.isDesktop ? '自动描摹需要在 Windows 或 macOS 桌面版环中AIStudio 中使用。' : !bridge.traceInIllustrator ? '桌面描摹组件尚未加载，请完全退出并重新打开环中AIStudio；如仍提示，请更新桌面应用。' : '当前系统暂不支持自动描摹，请使用 Windows 或 macOS。';
  const start = async () => {
    if (running.current || !run.result || !bridge?.traceInIllustrator) return;
    running.current = true; setBusy(true); setError(''); setResult(null);
    try {
      const response = await bridge.traceInIllustrator({ url: run.result.url, title: run.userPrompt.split(/[，,\n]/)[0].trim().slice(0, 60) || '字体作品', mode, threshold, ignoreWhite, keepEditableTrace });
      if (!response.success) throw new Error(response.error || '描摹未完成，请重试');
      setResult(response);
    } catch (e) { setError(e instanceof Error ? e.message : '描摹未完成，请重试'); }
    finally { running.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !running.current) onClose(); }}><DialogContent className="!max-w-lg max-h-[90dvh] overflow-y-auto" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
    <DialogTitle>Illustrator 矢量描摹</DialogTitle>
    <DialogDescription>自动打开 Illustrator 和图像描摹面板，在新文档中完成描摹并保存 AI 文件。</DialogDescription>
    {run.result && <div className="h-36 rounded-lg border border-border bg-muted/30"><img src={run.result.url} alt="待描摹的字体作品" className="h-full w-full object-contain"/></div>}
    {!result && <>
      <fieldset disabled={busy} className="space-y-4"><legend className="mb-2 text-xs font-medium">描摹模式</legend>
        <div className="grid grid-cols-2 gap-2">{([{ value: 'black-white', label: '黑白字稿', detail: '纯色字形、标志与线稿' }, { value: 'color', label: '彩色图稿', detail: '保留颜色，最多 16 色' }] as const).map(option => <label key={option.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${mode === option.value ? 'border-foreground bg-muted/40' : 'border-border'}`}><input type="radio" name="illustrator-mode" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} className="mt-0.5"/><span><span className="block text-xs font-medium">{option.label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{option.detail}</span></span></label>)}</div>
        {mode === 'black-white' && <><label className="block text-xs">黑白阈值 <output className="float-right tabular-nums">{threshold}</output><input aria-label="黑白阈值" type="range" min={1} max={255} value={threshold} onChange={event => setThreshold(Number(event.target.value))} className="mt-3 w-full accent-foreground"/><span className="mt-1 block text-[11px] text-muted-foreground">数值越大，越多浅色细节会变成黑色。</span></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ignoreWhite} onChange={event => setIgnoreWhite(event.target.checked)}/>去除白色背景</label></>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepEditableTrace} onChange={event => setKeepEditableTrace(event.target.checked)}/>保留描摹以便调整</label><p className="text-[11px] leading-5 text-muted-foreground">开启后可在 Illustrator 图像描摹面板调整参数，满意后点击“扩展”。关闭后自动展开为路径。</p>
      </fieldset>
      <p className="text-[11px] leading-5 text-muted-foreground">原图保留在独立图层中。描摹得到字形轮廓，文字内容需通过修改路径调整；渐变、纹理与细小装饰可能需要手动修整。</p>
      {!available && <p role="alert" className="text-xs text-destructive">{unavailableMessage}</p>}
      {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin"/>正在导入、描摹并保存，请留意 Illustrator 或系统的授权弹窗…</p>}
    </>}
    {result && <div role="status" className="space-y-2 rounded-lg border border-border p-3"><p className="flex items-center gap-2 text-sm font-medium"><Check size={16}/>已完成描摹 · {result.paths} 条路径</p><p className="text-xs leading-5 text-muted-foreground">{result.live ? '已选中描摹对象，可在 Illustrator 的图像描摹面板调整参数，满意后点击“扩展”。' : '已展开为路径，可直接调整锚点、填色或取消组合。'}</p>{result.panelOpened === false && <p className="text-xs text-destructive">此版本未能自动打开面板，请在 Illustrator 的“窗口 → 图像描摹”中打开。</p>}<p className="break-all text-[11px] text-muted-foreground">AI 文件：{result.file}</p></div>}
    {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={onClose}>{result ? '完成' : '取消'}</button>{result?.file ? <button type="button" className={button} onClick={async () => { try { const response = await bridge?.revealExport?.(result.file!); if (!response?.success) setError(response?.error || '无法打开文件位置'); } catch { setError('无法打开文件位置'); } }}><FolderOpen size={14}/>查看文件</button> : <button type="button" disabled={busy || !available} className={button + ' bg-foreground text-background hover:bg-foreground/85'} onClick={() => void start()}>{busy ? <Loader2 size={14} className="animate-spin"/> : <Spline size={14}/>} {busy ? '正在描摹…' : '打开 Illustrator 并描摹'}</button>}</div>
  </DialogContent></Dialog>;
}
