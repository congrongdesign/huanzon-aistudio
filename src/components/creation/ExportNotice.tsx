'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react';
import type { ExportNotice as Notice } from '@/lib/use-image-export';

type Props = { notice: Notice; onDismiss: () => void; onReveal: (path: string) => Promise<void>; onRetry: () => void };

export function ExportNotice({ notice, onDismiss, onReveal, onRetry }: Props) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const remaining = useRef(6000);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => { remaining.current = 6000; setOpenError(''); }, [notice.id, notice.state]);
  useEffect(() => {
    if (notice.state !== 'success' || hovered || focused || opening || openError) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [notice.id, notice.state, hovered, focused, opening, openError]);

  const Icon = notice.state === 'saving' ? Loader2 : notice.state === 'success' ? Check : TriangleAlert;
  return <div className="export-notice-anchor" onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div className="export-notice" data-state={notice.state} data-export-notice="true"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <span className="export-notice-icon" aria-hidden="true"><Icon size={17} strokeWidth={2} /></span>
      <div className="export-notice-copy" role="status" aria-live="polite" aria-atomic="true">
        <p className="export-notice-title">{notice.title}</p>
        <p className="export-notice-detail" title={openError || notice.filePath || notice.detail}>{openError || notice.detail}</p>
      </div>
      <div className="export-notice-actions">
        {notice.filePath && <button type="button" className="export-notice-action" disabled={opening} onClick={async () => {
          setOpening(true); setOpenError('');
          try { await onReveal(notice.filePath!); } catch (error) { setOpenError(error instanceof Error ? error.message : '无法打开保存位置'); } finally { setOpening(false); }
        }}><FolderOpen size={14} aria-hidden="true" /><span>打开文件夹</span></button>}
        {notice.retry && <button type="button" className="export-notice-action" onClick={onRetry}><RotateCcw size={14} aria-hidden="true" /><span>重试</span></button>}
        <button type="button" className="export-notice-close" onClick={onDismiss} aria-label="关闭保存提示"><X size={15} aria-hidden="true" /></button>
      </div>
    </div>
  </div>;
}
