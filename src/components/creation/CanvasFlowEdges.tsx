'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FlowEdge } from '@/components/ui/motif/flow-edge';
import { flowingCanvasEdges, CanvasEdgeScene, type CanvasView } from '@/lib/canvas-edge-scene';
import { presentCanvasEdges, bundleCanvasEdges, canvasRemoteHints, type CanvasEdgeMode } from '@/lib/canvas-edge-presentation';
import type { CanvasImage } from '@/lib/types';

export const CanvasFlowEdges = memo(function CanvasFlowEdges({ images, viewport, getSize, selectedIds, scale = 1, interacting = false, mode = 'smart', onLocate }: {
  images: CanvasImage[];
  viewport: CanvasView | null;
  getSize: (image: CanvasImage) => { w: number; h: number };
  selectedIds: string[];
  scale?: number;
  interacting?: boolean;
  mode?: CanvasEdgeMode;
  onLocate?: (ids: string[]) => void;
}) {
  const [scene, setScene] = useState<CanvasEdgeScene>();
  const cache = useRef<CanvasEdgeScene | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let next: CanvasEdgeScene | undefined;
    let cursor = 0;
    // Geometry work is cancellable and time-sliced; it never runs on viewport updates.
    const work = () => {
      if (cancelled) return;
      next ??= new CanvasEdgeScene(images, getSize, cache.current);
      const start = performance.now();
      while (cursor < next.connections.length) {
        next.route(next.connections[cursor++]);
        if (performance.now() - start >= 4) break;
      }
      if (cursor < next.connections.length) timer = setTimeout(work, 0);
      else { cache.current = next.finish(); setScene(next); }
    };
    timer = setTimeout(work, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [images, getSize]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const presentation = useMemo(() => scene && viewport ? presentCanvasEdges(scene, viewport, scale, selected, mode) : { edges: [], remote: [] }, [scene, viewport, scale, selected, mode]);
  const overview = mode === 'smart' && scale < 0.3 && (scene?.edges.size || 0) > 60;
  const bundles = useMemo(() => scene && overview ? bundleCanvasEdges(scene, presentation.edges.filter(edge => !edge.active && !selected.has(edge.source) && !selected.has(edge.target))) : [], [scene, presentation, selected, overview]);
  const bundled = useMemo(() => new Set(bundles.flatMap(bundle => bundle.keys)), [bundles]);
  const details = presentation.edges.filter(edge => !bundled.has(edge.key) && (!overview || edge.active || selected.has(edge.source) || selected.has(edge.target)));
  const hints = useMemo(() => scene && viewport ? canvasRemoteHints(scene, presentation.remote, viewport, scale, selected) : [], [scene, presentation, viewport, scale, selected]);
  if (!viewport || !scene) return null;
  const active = flowingCanvasEdges(details,selected,interacting);
  return <div className="pointer-events-none absolute inset-0" data-canvas-flow-edges data-flowing-edges={active.length} data-routes={scene.edges.size} data-route-computations={scene.routeComputations} data-edge-overview={overview} data-edge-mode={mode}>
    <svg aria-hidden="true" className="absolute left-0 top-0 overflow-visible" width="1" height="1" fill="none" data-static-edges>
      {bundles.map(bundle => { const g = bundle.geometry; return <path key={`bus:${bundle.key}`} data-edge-bundle={bundle.keys.length} d={g.d} transform={`translate(${g.x} ${g.y})`} className="canvas-static-edge is-bundle" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round"/>; })}
      {details.map(edge => {
        const g = edge.geometry, emphasized = selected.has(edge.source) || selected.has(edge.target);
        return <path key={edge.key} d={g.d} transform={`translate(${g.x} ${g.y})`} className={`canvas-static-edge ${emphasized ? 'is-selected' : ''}`} strokeWidth={emphasized ? 2 : 1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round"/>;
      })}
    </svg>
    {active.map(edge => { const g = edge.geometry; return <FlowEdge key={edge.key} d={g.d} axis={g.axis} reverse={g.reverse} viewBox={`0 0 ${g.width} ${g.height}`} active strokeWidth={2} glow={1} className="motif-canvas-flow-edge is-selected" style={{ position: 'absolute', left: g.x, top: g.y, width: g.width, height: g.height }}/>; })}
    {!interacting && onLocate && hints.map(hint => <button key={hint.key} type="button" data-edge-remote={hint.key} className="canvas-remote-hint pointer-events-auto absolute flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm hover:bg-muted" style={{ left: hint.x, top: hint.y, transform: `scale(${1 / scale})`, transformOrigin: 'top left' }} title="定位屏幕外的关联图片" onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onLocate(hint.ids); }}><span aria-hidden="true">{hint.direction}</span>{hint.label}<span className="text-muted-foreground">定位</span></button>)}
  </div>;
});
