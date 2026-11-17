import type { CanvasEdgeScene, CanvasView, SceneEdge, EdgeGeometry } from './canvas-edge-scene';
import type { CanvasRect } from './canvas-lineage';

export type CanvasEdgeMode = 'smart' | 'all' | 'hidden';
const inView = (r: CanvasRect, v: CanvasView) => r.x + r.width > v.x && r.x < v.right && r.y + r.height > v.y && r.y < v.bottom;
const related = (e: SceneEdge, ids: ReadonlySet<string>) => ids.has(e.source) || ids.has(e.target);

/** Screen-space thresholds change presentation only, never positions or stored relationships. */
export function presentCanvasEdges(scene: CanvasEdgeScene, view: CanvasView, scale: number, selected: ReadonlySet<string>, mode: CanvasEdgeMode) {
  if (mode === 'hidden') return { edges: [] as SceneEdge[], remote: [] as SceneEdge[] };
  const remote: SceneEdge[] = [], edges: SceneEdge[] = [];
  const candidates = new Map(scene.visible(view).map(edge => [edge.key, edge]));
  // A partly visible selected image can have its connection port outside the viewport.
  if (selected.size) for (const edge of scene.edges.values()) if (related(edge, selected)) candidates.set(edge.key, edge);
  for (const edge of candidates.values()) {
    const source = scene.rects.get(edge.source)!, target = scene.rects.get(edge.target)!;
    const sourceVisible = inView(source, view), targetVisible = inView(target, view);
    if (sourceVisible !== targetVisible && related(edge, selected)) remote.push(edge);
    if (mode === 'all') { edges.push(edge); continue; }
    // A path with neither endpoint visible gives no useful context, even when it crosses the screen.
    if (!sourceVisible || !targetVisible) continue;
    const gapX = Math.max(0, source.x - target.x - target.width, target.x - source.x - source.width);
    const gapY = Math.max(0, source.y - target.y - target.height, target.y - source.y - source.height);
    if (!related(edge, selected) && !edge.active && (Math.hypot(gapX, gapY) * scale > 720)) continue;
    edges.push(edge);
  }
  return { edges, remote };
}

export type CanvasEdgeBundle = { key: string; keys: string[]; geometry: EdgeGeometry };

/** Merge siblings into a bus only when every straight segment has a clear gutter. */
export function bundleCanvasEdges(scene: CanvasEdgeScene, edges: readonly SceneEdge[]): CanvasEdgeBundle[] {
  const groups = new Map<string, SceneEdge[]>();
  for (const edge of edges) {
    const s = scene.rects.get(edge.source)!, t = scene.rects.get(edge.target)!;
    const direction = t.x >= s.x + s.width + 48 ? 1 : t.x + t.width <= s.x - 48 ? -1 : 0;
    if (!direction) continue;
    const key = `${edge.source}:${direction}:${direction > 0 ? t.x : t.x + t.width}`;
    const group = groups.get(key) || []; group.push(edge); groups.set(key, group);
  }
  const bundles: CanvasEdgeBundle[] = [];
  for (const [key, group] of groups) {
    if (group.length < 3) continue;
    const s = scene.rects.get(group[0].source)!;
    const targets = group.map(e => scene.rects.get(e.target)!);
    const direction = targets[0].x > s.x ? 1 : -1;
    const sx = direction > 0 ? s.x + s.width : s.x, sy = s.y + s.height / 2;
    const tx = direction > 0 ? targets[0].x : targets[0].x + targets[0].width;
    const busX = sx + (tx - sx) / 2;
    type Segment = { ax: number; ay: number; bx: number; by: number; exclude?: CanvasRect };
    const ys = [sy, ...targets.map(t => t.y + t.height / 2)];
    const segments: Segment[] = [
      { ax: sx, ay: sy, bx: busX, by: sy, exclude: s },
      { ax: busX, ay: Math.min(...ys), bx: busX, by: Math.max(...ys) },
      ...targets.map(t => ({ ax: busX, ay: t.y + t.height / 2, bx: tx, by: t.y + t.height / 2, exclude: t })),
    ];
    const nearby = scene.obstacles.query({ x: Math.min(sx, tx) - 12, y: Math.min(...ys) - 12, width: Math.abs(tx - sx) + 24, height: Math.max(...ys) - Math.min(...ys) + 24 });
    if (segments.some(l => nearby.some(r => r !== l.exclude && (l.ax === l.bx
      ? l.ax > r.x - 12 && l.ax < r.x + r.width + 12 && Math.max(l.ay, l.by) > r.y - 12 && Math.min(l.ay, l.by) < r.y + r.height + 12
      : l.ay > r.y - 12 && l.ay < r.y + r.height + 12 && Math.max(l.ax, l.bx) > r.x - 12 && Math.min(l.ax, l.bx) < r.x + r.width + 12)))) continue;
    const x = Math.min(sx, tx) - 16, y = Math.min(...ys) - 16;
    bundles.push({ key, keys: group.map(e => e.key), geometry: {
      x, y, width: Math.abs(tx - sx) + 32, height: Math.max(...ys) - y + 16,
      d: segments.map(l => `M ${l.ax - x} ${l.ay - y} L ${l.bx - x} ${l.by - y}`).join(' '), axis: 'x', reverse: direction < 0,
    } });
  }
  return bundles;
}

export type CanvasRemoteHint = { key: string; ids: string[]; x: number; y: number; label: string; direction: string };
export function canvasRemoteHints(scene: CanvasEdgeScene, edges: readonly SceneEdge[], view: CanvasView, scale: number, selected: ReadonlySet<string>): CanvasRemoteHint[] {
  const groups = new Map<string, { anchor: CanvasRect; ids: Set<string>; incoming: boolean; direction: string }>();
  for (const edge of edges) {
    const s = scene.rects.get(edge.source)!, t = scene.rects.get(edge.target)!;
    const incoming = selected.has(edge.target) && inView(t, view) && !inView(s, view);
    const outgoing = selected.has(edge.source) && inView(s, view) && !inView(t, view);
    if (!incoming && !outgoing) continue;
    const anchor = incoming ? t : s, remote = incoming ? s : t;
    const dx = remote.x + remote.width / 2 - anchor.x - anchor.width / 2;
    const dy = remote.y + remote.height / 2 - anchor.y - anchor.height / 2;
    const direction = Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? '←' : '→' : dy < 0 ? '↑' : '↓';
    const key = `${incoming ? edge.target : edge.source}:${incoming}:${direction}`;
    const group = groups.get(key) || { anchor, ids: new Set<string>(), incoming, direction };
    group.ids.add(incoming ? edge.source : edge.target); groups.set(key, group);
  }
  // Only selected nodes get navigation badges; cap them to protect dense multi-selection.
  const anchorSlots = new Map<CanvasRect, number>();
  return [...groups].slice(0, 8).map(([key, group]) => {
    const slot = anchorSlots.get(group.anchor) || 0;
    anchorSlots.set(group.anchor, slot + 1);
    return {
    key, ids: [...group.ids], direction: group.direction,
    x: Math.max(view.x + 12 / scale, Math.min(group.anchor.x, view.right - 142 / scale)),
    y: Math.max(view.y + 12 / scale, Math.min(group.anchor.y + group.anchor.height + (12 + slot * 30) / scale, view.bottom - (36 + slot * 30) / scale)),
    label: `${group.incoming ? '来源' : '衍生'} · ${group.ids.size} 张`,
  }; });
}
