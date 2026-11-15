'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ExportFile = { url: string; filename: string };
type ExportResult = { success: boolean; files: string[]; failures: Array<{ filename: string; error: string }>; error?: string };
export type ExportNotice = { id: string; state: 'saving' | 'success' | 'warning' | 'error'; title: string; detail: string; filePath?: string; retry?: { files: ExportFile[]; zipName?: string } };
type ExportBridge = {
  exportImages?: (request: { id: string; files: ExportFile[]; zipName?: string }) => Promise<ExportResult>;
  onImageExportProgress?: (callback: (progress: { id: string; completed: number; total: number }) => void) => () => void;
  revealExport?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
};
const desktop = () => (window as Window & { electronAPI?: ExportBridge }).electronAPI;

/** Completion means files were saved, not merely that a download link was clicked. */
export function useImageExport() {
  const [notice, setNotice] = useState<ExportNotice | null>(null);
  const jobs = useRef(new Map<string, Promise<void>>());
  const progress = useRef(new Map<string, { completed: number; total: number }>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = desktop()?.onImageExportProgress?.(value => {
      if (!progress.current.has(value.id)) return;
      progress.current.set(value.id, value);
      setNotice(current => current?.state === 'saving' ? { ...current, title: progress.current.size > 1 ? `正在保存 ${progress.current.size} 个任务` : '正在保存图片', detail: value.total > 1 ? `已读取 ${value.completed}/${value.total} 张 · 可继续创作` : '正在写入原图 · 可继续创作' } : current);
    });
    return () => { mounted.current = false; unsubscribe?.(); };
  }, []);

  const exportImages = useCallback(async (files: ExportFile[], zipName?: string): Promise<boolean> => {
    const bridge = desktop();
    if (!bridge?.exportImages) return false;
    const key = JSON.stringify({ files, zipName });
    const existing = jobs.current.get(key);
    if (existing) { await existing; return true; }
    const id = crypto.randomUUID();
    progress.current.set(id, { completed: 0, total: files.length });
    setNotice({ id, state: 'saving', title: zipName ? '正在打包图片' : '正在保存图片', detail: `${files.length} 张原图 · 可继续创作` });
    const task = (async () => {
      try {
        // Blob URLs belong to the renderer; transfer their bytes before crossing IPC.
        const resolved = await Promise.all(files.map(async file => {
          if (!file.url.startsWith('blob:')) return file;
          const blob = await (await fetch(file.url)).blob();
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(blob);
          });
          return { ...file, url };
        }));
        const result = await bridge.exportImages!({ id, files: resolved, zipName });
        if (!result.success || !result.files.length) throw new Error(result.error || result.failures[0]?.error || '图片未保存');
        const leaf = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() || value;
        const failed = new Set(result.failures.map(file => file.filename));
        if (mounted.current) setNotice({ id, state: result.failures.length ? 'warning' : 'success',
          title: result.failures.length ? `已保存 ${result.files.length} 张，${result.failures.length} 张未完成` : zipName ? '压缩包已保存' : result.files.length > 1 ? `${result.files.length} 张图片已保存` : '图片已保存',
          detail: result.failures.length ? result.failures[0].error : result.files.length === 1 ? leaf(result.files[0]) : `原图已存入「${leaf(result.files[0].replace(/[\\/][^\\/]+$/, ''))}」`,
          filePath: result.files[0], ...(result.failures.length ? { retry: { files: files.filter(file => failed.has(file.filename)), zipName } } : {}) });
      } catch (error) {
        if (mounted.current) setNotice({ id, state: 'error', title: '图片未能保存', detail: error instanceof Error ? error.message : '请检查网络或储存位置后重试', retry: { files, zipName } });
      } finally {
        jobs.current.delete(key); progress.current.delete(id);
      }
    })();
    jobs.current.set(key, task);
    await task;
    return true;
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const revealFile = useCallback(async (filePath: string) => {
    const result = await desktop()?.revealExport?.(filePath);
    if (!result?.success) throw new Error(result?.error || '无法打开保存位置');
  }, []);
  return { exportImages, notice, dismissNotice, revealFile };
}
