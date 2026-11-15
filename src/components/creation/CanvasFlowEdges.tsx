'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FlowEdge } from '@/components/ui/motif/flow-edge';
import { canvasConnectionGeometry } from '@/lib/canvas-lineage';
import { flowingCanvasEdges, CanvasEdgeScene, type CanvasView, type SceneEdge } from '@/lib/canvas-edge-scene';
import type { CanvasImage } from '@/lib/types';

export const CanvasFlowEdges = memo(function CanvasFlowEdges({ images, viewport, getSize, selectedIds, scale = 1, interacting = false }: {
  images: CanvasImage[];
  viewport: CanvasView | null;
  getSize: (image: CanvasImage) => { w: number; h: number };
  selectedIds: string[];
  scale?: number;
  interacting?: boolean;
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

  const visible = useMemo(() => scene && viewport ? scene.visible(viewport) : [], [scene, viewport]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const overview = scale < 0.4 && (scene?.edges.size || 0) > 60;
  const { details, summaries } = useMemo(() => {
    if (!overview || !scene) return { details: visible, summaries: [] as SceneEdge[] };
    const groups = new Map<string, SceneEdge[]>();
    const details: SceneEdge[] = [];
    for (const edge of visible) {
      if (edge.active || selected.has(edge.source) || selected.has(edge.target)) { details.push(edge); continue; }
      const source = scene.rects.get(edge.source)!;
      const target = scene.rects.get(edge.target)!;
      const key = `${edge.source}:${Math.floor((target.x - source.x) / 2400)}:${Math.floor((target.y - source.y) / 1600)}`;
      const group = groups.get(key) || []; group.push(edge); groups.set(key, group);
    }
    const summaries: SceneEdge[] = [];
    for (const [key, edges] of groups) {
      if (edges.length < 3) { details.push(...edges); continue; }
      const targets = edges.map(e => scene.rects.get(e.target)!);
      const x = Math.min(...targets.map(t => t.x)), y = Math.min(...targets.map(t => t.y));
      const right = Math.max(...targets.map(t => t.x + t.width)), bottom = Math.max(...targets.map(t => t.y + t.height));
      summaries.push({ ...edges[0], key: `group:${key}`, geometry: canvasConnectionGeometry(scene.rects.get(edges[0].source)!, { x, y, width: right - x, height: bottom - y }) });
    }
    return { details, summaries };
  }, [overview, scene, visible, selected]);
  if (!viewport || !scene) return null;
  const active = flowingCanvasEdges(details,selected,interacting);
  return <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-canvas-flow-edges data-flowing-edges={active.length} data-routes={scene.edges.size} data-route-computations={scene.routeComputations} data-edge-overview={overview}>
    <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" fill="none" data-static-edges>
      {[...summaries, ...details].map(edge => {
        const g = edge.geometry, emphasized = selected.has(edge.source) || selected.has(edge.target);
        return <path key={edge.key} d={g.d} transform={`translate(${g.x} ${g.y})`} className={`canvas-static-edge ${emphasized ? 'is-selected' : ''}`} strokeWidth={emphasized ? 2 : 1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round"/>;
      })}
    </svg>
    {active.map(edge => { const g = edge.geometry; return <FlowEdge key={edge.key} d={g.d} axis={g.axis} reverse={g.reverse} viewBox={`0 0 ${g.width} ${g.height}`} active strokeWidth={2} glow={1} className="motif-canvas-flow-edge is-selected" style={{ position: 'absolute', left: g.x, top: g.y, width: g.width, height: g.height }}/>; })}
  </div>;
});
