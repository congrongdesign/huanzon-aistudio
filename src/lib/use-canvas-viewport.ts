'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { canvasViewport } from './canvas-view';

export function useCanvasViewport(containerRef: RefObject<HTMLDivElement | null>, offset: { x: number; y: number }, scale: number, active: boolean) {
  // A mutable ref is not a mount notification. Auth/navigation can replace the
  // canvas while its ref object and the camera remain unchanged.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setNode(element);
  }, [containerRef]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ source: offset, value: offset });
  const panRef = useRef(offset);
  const committedOffset = useRef(offset);
  useLayoutEffect(() => {
    if (!node || !active) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = { x: 0, y: 0 };
    const onPan = (event: Event) => {
      latest = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (!timer) timer = setTimeout(() => { timer = undefined; // Overscan already contains nearby images. Reconcile React only after
        // crossing a substantial screen-space distance, not every 80ms of panning.
        const previous = panRef.current;
        if (Math.abs(latest.x - previous.x) >= 480 || Math.abs(latest.y - previous.y) >= 480) {
          panRef.current = latest; setPan({ source: committedOffset.current, value: latest });
        } }, 80);
    };
    observer.observe(node);
    node.addEventListener('canvas-pan', onPan);
    return () => { observer.disconnect(); node.removeEventListener('canvas-pan', onPan); if (timer) clearTimeout(timer); };
  }, [node, active]); // pan events follow the direct DOM transform during dragging
  useEffect(() => { committedOffset.current = offset; panRef.current = offset; }, [offset]);
  // Do not cull the new layout against the previous camera for one render.
  const visibleOffset = pan.source === offset ? pan.value : offset;
  const viewport = useMemo(() => {
    return canvasViewport(size, visibleOffset, scale);
  }, [size, visibleOffset, scale]);
  const contentViewport = useMemo(() => canvasViewport(size, visibleOffset, scale, 0), [size, visibleOffset, scale]);
  return { viewport, contentViewport, attach, node };
}
