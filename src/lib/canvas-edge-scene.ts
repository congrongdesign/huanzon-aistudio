import { canvasConnections, routedCanvasConnectionGeometry, type CanvasConnection, type CanvasRect } from './canvas-lineage';
import type { CanvasImage } from './types';
import { isFiniteCanvasRect } from './canvas-view';

export type CanvasView = { x: number; y: number; right: number; bottom: number };
export type EdgeGeometry = ReturnType<typeof routedCanvasConnectionGeometry>;
export type SceneEdge = CanvasConnection & { key: string; active: boolean; geometry: EdgeGeometry };
const intersects = (a: CanvasRect, b: CanvasRect) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const same = (a: CanvasRect | undefined, b: CanvasRect | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const bounds = (g: EdgeGeometry): CanvasRect => ({ x: g.x, y: g.y, width: g.width, height: g.height });

/** A bounded uniform grid. Very long edges are kept once, never expanded into thousands of cells. */
export class CanvasSpatialIndex<T> {
  private cells = new Map<string, { value: T; rect: CanvasRect }[]>();
  private wide: { value: T; rect: CanvasRect }[] = [];
  private all: { value: T; rect: CanvasRect }[] = [];
  constructor(entries: { value: T; rect: CanvasRect }[], private cellSize = 640) {
    this.all = entries.filter(entry => isFiniteCanvasRect(entry.rect));
    for (const entry of this.all) {
      const [x, y, right, bottom] = this.range(entry.rect);
      if (![x, y, right, bottom].every(Number.isSafeInteger) || (right - x + 1) * (bottom - y + 1) > 256) { this.wide.push(entry); continue; }
      for (let cx = x; cx <= right; cx++) for (let cy = y; cy <= bottom; cy++) {
        const key = `${cx}:${cy}`, bucket = this.cells.get(key) || [];
        bucket.push(entry); this.cells.set(key, bucket);
      }
    }
  }
  private range(r: CanvasRect) { return [Math.floor(r.x / this.cellSize), Math.floor(r.y / this.cellSize), Math.floor((r.x + r.width) / this.cellSize), Math.floor((r.y + r.height) / this.cellSize)]; }
  query(rect: CanvasRect): T[] {
    if (!isFiniteCanvasRect(rect)) return [];
    const [x, y, right, bottom] = this.range(rect);
    if (![x, y, right, bottom].every(Number.isSafeInteger) || (right - x + 1) * (bottom - y + 1) > 4096) return this.all.filter(e => intersects(e.rect, rect)).map(e => e.value);
    const seen = new Set<T>();
    for (const entry of this.wide) if (intersects(entry.rect, rect)) seen.add(entry.value);
    for (let cx = x; cx <= right; cx++) for (let cy = y; cy <= bottom; cy++) {
      for (const entry of this.cells.get(`${cx}:${cy}`) || []) if (intersects(entry.rect, rect)) seen.add(entry.value);
    }
    return [...seen];
  }
}

/** World-coordinate cache. Viewport movement and selection are deliberately absent. */
export class CanvasEdgeScene {
  readonly rects = new Map<string, CanvasRect>();
  readonly edges = new Map<string, SceneEdge>();
  readonly connections: CanvasConnection[];
  readonly obstacles: CanvasSpatialIndex<CanvasRect>;
  readonly active = new Set<string>();
  readonly changed: CanvasRect[] = [];
  readonly routingBounds: CanvasRect;
  routeComputations = 0;
  private index: CanvasSpatialIndex<SceneEdge> | undefined;
  constructor(images: readonly CanvasImage[], getSize: (image: CanvasImage) => { w: number; h: number }, private previous?: CanvasEdgeScene) {
    for (const image of images) {
      const s = getSize(image), rect = { x: image.canvas_x, y: image.canvas_y, width: s.w, height: s.h };
      this.rects.set(image.id, rect);
      if (image.isGenerating) this.active.add(image.id);
      const old = previous?.rects.get(image.id);
      if (!same(old, rect)) { this.changed.push(rect); if (old) this.changed.push(old); }
    }
    for (const [id, old] of previous?.rects || []) if (!this.rects.has(id)) this.changed.push(old);
    this.connections = canvasConnections(images);
    this.obstacles = new CanvasSpatialIndex([...this.rects.values()].map(rect => ({ value: rect, rect })));
    const rects = [...this.rects.values()];
    const y = Math.min(0, ...rects.map(r => r.y)) - 48;
    this.routingBounds = { x: 0, y, width: 0, height: Math.max(0, ...rects.map(r => r.y + r.height)) - y + 48 };
  }
  route(connection: CanvasConnection) {
    const key = JSON.stringify([connection.source, connection.target]);
    const source = this.rects.get(connection.source)!, target = this.rects.get(connection.target)!;
    const old = this.previous?.edges.get(key);
    let geometry = old?.geometry;
    // Reuse a route unless an endpoint or an obstacle touching its corridor changed.
    if (!geometry || !same(source, this.previous?.rects.get(connection.source)) || !same(target, this.previous?.rects.get(connection.target)) ||
      this.changed.some(rect => intersects(rect, { x: geometry!.x - 24, y: geometry!.y - 24, width: geometry!.width + 48, height: geometry!.height + 48 }))) {
      const left = Math.min(source.x, target.x) - 48;
      const right = Math.max(source.x + source.width, target.x + target.width) + 48;
      const nearby = this.obstacles.query({ ...this.routingBounds, x: left, width: right - left });
      geometry = routedCanvasConnectionGeometry(source, target, nearby);
      this.routeComputations++;
    }
    const edge = { ...connection, key, active: this.active.has(connection.target), geometry };
    this.edges.set(key, edge);
    return edge;
  }
  finish() {
    this.index = new CanvasSpatialIndex([...this.edges.values()].map(edge => ({ value: edge, rect: bounds(edge.geometry) })));
    // Do not retain every historical scene after incremental edits.
    this.previous = undefined;
    return this;
  }
  visible(view: CanvasView): SceneEdge[] {
    return this.index?.query({ x: view.x, y: view.y, width: view.right - view.x, height: view.bottom - view.y }) || [];
  }
}

/** Selection reuses routed paths. Keep animation bounded and prioritize the selected result's inputs. */
export function flowingCanvasEdges(edges:readonly SceneEdge[],selected:ReadonlySet<string>,interacting=false,budget=12):SceneEdge[]{
  if(interacting||budget<=0)return [];
  const incoming:SceneEdge[]=[],outgoing:SceneEdge[]=[],generating:SceneEdge[]=[];
  for(const edge of edges){
    if(selected.has(edge.target))incoming.push(edge);
    else if(selected.has(edge.source))outgoing.push(edge);
    else if(edge.active)generating.push(edge);
  }
  return [...incoming,...outgoing,...generating].slice(0,budget);
}
