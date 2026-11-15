'use client';

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { clampComposerSize, readComposerSize, resizeComposer, type ComposerLimits, type ComposerResizeEdge, type ComposerSize } from '@/lib/composer-resize';

type Controller = {
  start: (event: React.PointerEvent, edge: ComposerResizeEdge) => void;
  key: (event: React.KeyboardEvent, edge: ComposerResizeEdge) => void;
  reset: () => void;
};

/** Resize only this dock's DOM. Canvas nodes and generation state do not rerender per pixel. */
export function ResizableComposerDock({ children, className, scope, dockRef, canvas = false, hasStyle = false }: {
  children: ReactNode; className: string; scope: 'canvas' | 'font'; dockRef?: RefObject<HTMLDivElement | null>; canvas?: boolean; hasStyle?: boolean;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  useLayoutEffect(() => {
    const dock = localRef.current, workspace = dock?.parentElement;
    const panel = dock?.querySelector<HTMLElement>('.motif-composer');
    if (!dock || !workspace || !panel) return;
    const key = `hz_composer_size_v1:${scope}`;
    let preferred: ComposerSize = {};
    try { preferred = readComposerSize(localStorage.getItem(key)); } catch { /* A blocked store does not prevent resizing. */ }
    let frame: number | undefined;
    let drag: { initial: ComposerSize; width: number; height: number; x: number; y: number; edge: ComposerResizeEdge; pointer: number; cursor: string; selection: string } | undefined;
    const limits = (): ComposerLimits => {
      const parent = workspace.getBoundingClientRect(), css = getComputedStyle(dock);
      const inset = (parseFloat(css.left) || 16) + (parseFloat(css.right) || 16);
      const extra = Math.max(0, dock.getBoundingClientRect().width - panel.getBoundingClientRect().width);
      const footer = panel.querySelector<HTMLElement>('.motif-composer-footer');
      const panelCss = getComputedStyle(panel);
      const padding = (parseFloat(panelCss.paddingTop) || 0) + (parseFloat(panelCss.paddingBottom) || 0);
      return { minWidth: 440 + extra, maxWidth: Math.max(120, parent.width - inset),
        minHeight: Math.max(142, (footer?.getBoundingClientRect().height || 40) + padding + 84),
        maxHeight: Math.max(142, Math.min(parent.height * .68, parent.height - (parseFloat(css.bottom) || 16) - 72)) };
    };
    const apply = () => {
      frame = undefined;
      const bounded = clampComposerSize(preferred, limits());
      dock.style.width = bounded.width === undefined ? '' : `${bounded.width}px`;
      dock.style.maxWidth = bounded.width === undefined ? '' : 'calc(100% - var(--composer-resize-inset, 32px))';
      panel.style.height = bounded.height === undefined ? '' : `${bounded.height}px`;
      dock.dataset.heightCustom = String(bounded.height !== undefined);
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(apply); };
    const save = () => { try { localStorage.setItem(key, JSON.stringify(preferred)); } catch { /* Keep the current size for this session. */ } };
    const finish = (cancel = false) => {
      if (!drag) return;
      if (cancel) preferred = drag.initial;
      document.documentElement.style.cursor = drag.cursor;
      document.documentElement.style.userSelect = drag.selection;
      drag = undefined; delete dock.dataset.resizing;
      if (frame !== undefined) cancelAnimationFrame(frame);
      apply(); if (!cancel) save();
    };
    const reset = () => { finish(true); preferred = {}; apply(); save(); };
    const onMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      event.preventDefault();
      preferred = resizeComposer(drag, drag.initial, drag.edge, event.clientX - drag.x, event.clientY - drag.y, limits());
      schedule();
    };
    const onUp = (event: PointerEvent) => { if (event.pointerId === drag?.pointer) { onMove(event); finish(); } };
    const onCancel = () => finish(true);
    const onEscape = (event: KeyboardEvent) => { if (drag && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(true); } };
    controller.current = {
      reset,
      start: (event, edge) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.stopPropagation(); finish();
        const rect = panel.getBoundingClientRect();
        drag = { initial: { ...preferred }, width: dock.getBoundingClientRect().width, height: rect.height,
          x: event.clientX, y: event.clientY, edge, pointer: event.pointerId,
          cursor: document.documentElement.style.cursor, selection: document.documentElement.style.userSelect };
        event.currentTarget.setPointerCapture(event.pointerId);
        panel.style.animation = 'none';
        dock.dataset.resizing = edge;
        document.documentElement.style.cursor = edge === 'n' ? 'ns-resize' : edge.length === 1 ? 'ew-resize' : edge === 'nw' ? 'nwse-resize' : 'nesw-resize';
        document.documentElement.style.userSelect = 'none';
      },
      key: (event, edge) => {
        if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); reset(); return; }
        const horizontal = edge !== 'n' && ['ArrowLeft', 'ArrowRight'].includes(event.key);
        const vertical = edge.includes('n') && ['ArrowUp', 'ArrowDown'].includes(event.key);
        if (!horizontal && !vertical) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 40 : 12, rect = panel.getBoundingClientRect();
        preferred = resizeComposer({ width: dock.getBoundingClientRect().width, height: rect.height }, preferred,
          horizontal ? edge.includes('w') ? 'w' : 'e' : 'n',
          horizontal ? (event.key === 'ArrowRight' ? step : -step) : 0,
          vertical ? (event.key === 'ArrowDown' ? step : -step) : 0, limits());
        apply(); save();
      },
    };
    apply();
    const observer = new ResizeObserver(schedule);
    observer.observe(workspace);
    const footer = panel.querySelector('.motif-composer-footer'); if (footer) observer.observe(footer);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      finish(true); controller.current = null; observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel); window.removeEventListener('blur', onCancel); window.removeEventListener('keydown', onEscape, true);
    };
  }, [scope, hasStyle]);
  return <div ref={node => { localRef.current = node; if (dockRef) dockRef.current = node; }} className={className}
    data-resizable-composer={scope} data-has-style={scope === 'font' ? String(hasStyle) : undefined} data-canvas-composer={canvas ? 'true' : undefined}>
    {children}
    <div className={`composer-resize-handles composer-resize-handles-${scope}`}>
      {(['n', 'w', 'e', 'nw', 'ne'] as const).map(edge => <button key={edge} type="button" data-composer-resize={edge}
        className={`composer-resize-handle composer-resize-${edge}`} aria-label={`调整${scope === 'font' ? '字体' : '画布'}输入框${edge === 'n' ? '高度' : edge.length === 1 ? '宽度' : '大小'}`}
        title="拖拽调整大小 · 双击恢复默认 · 方向键微调，Home 重置"
        onPointerDown={event => controller.current?.start(event, edge)} onMouseDown={event => event.stopPropagation()}
        onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); controller.current?.reset(); }}
        onKeyDown={event => controller.current?.key(event, edge)}><span aria-hidden="true"/></button>)}
    </div>
  </div>;
}
