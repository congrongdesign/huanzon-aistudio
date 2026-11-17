import type { CanvasImage } from './types';

export type CanvasConnection = { source: string; target: string };
export type CanvasRect = { x: number; y: number; width: number; height: number };

/** Old records can contain image ids; current generation records contain original URLs. */
export function canvasConnections(images: readonly CanvasImage[]): CanvasConnection[] {
  const ids = new Map(images.filter(image => !image.deleted_at).map(image => [image.id, image]));
  const urls = new Map<string, CanvasImage[]>();
  for (const image of ids.values()) {
    if (!image.image_url) continue;
    const key = `${image.project_id}\n${image.image_url}`;
    const group = urls.get(key) || [];
    group.push(image); urls.set(key, group);
  }
  const timestamp = (image: CanvasImage) => Date.parse(image.created_at) || 0;
  for (const group of urls.values()) group.sort((a,b) => timestamp(b)-timestamp(a) || a.id.localeCompare(b.id));
  const edges: CanvasConnection[] = [];
  for (const target of ids.values()) {
    if (!target.reference_images) continue;
    let refs: unknown;
    try { refs = JSON.parse(target.reference_images); } catch { continue; }
    if (!Array.isArray(refs)) continue;
    const seen = new Set<string>();
    for (const reference of refs) {
      if (typeof reference !== 'string' || !reference) continue;
      const explicit = ids.get(reference) || ids.get(`ref-${reference}`);
      const source = explicit || urls.get(`${target.project_id}\n${reference}`)?.find(candidate => candidate.id !== target.id && timestamp(candidate) <= timestamp(target));
      if (!source || source.id === target.id || source.project_id !== target.project_id || source.deleted_at || seen.has(source.id)) continue;
      seen.add(source.id); edges.push({ source: source.id, target: target.id });
    }
  }
  return edges;
}

/** Port positions and a cubic in the same coordinate system as the canvas images. */
export function canvasConnectionGeometry(source: CanvasRect, target: CanvasRect) {
  const sx = source.x + source.width/2, sy = source.y + source.height/2;
  const tx = target.x + target.width/2, ty = target.y + target.height/2;
  const horizontal = Math.abs(tx-sx) > (source.width+target.width)/2 || Math.abs(tx-sx) >= Math.abs(ty-sy);
  const direction = horizontal ? Math.sign(tx-sx) || 1 : Math.sign(ty-sy) || 1;
  const a = horizontal ? {x:sx+direction*source.width/2,y:sy} : {x:sx,y:sy+direction*source.height/2};
  const b = horizontal ? {x:tx-direction*target.width/2,y:ty} : {x:tx,y:ty-direction*target.height/2};
  // A small margin gives straight connections a nonzero SVG height and room for glow.
  const x = Math.min(a.x,b.x)-16, y = Math.min(a.y,b.y)-16;
  const width = Math.max(32,Math.abs(b.x-a.x)+32), height = Math.max(32,Math.abs(b.y-a.y)+32);
  const ax=a.x-x, ay=a.y-y, bx=b.x-x, by=b.y-y;
  const d = horizontal ? `M ${ax} ${ay} C ${(ax+bx)/2} ${ay} ${(ax+bx)/2} ${by} ${bx} ${by}` : `M ${ax} ${ay} C ${ax} ${(ay+by)/2} ${bx} ${(ay+by)/2} ${bx} ${by}`;
  return {x,y,width,height,d,axis:horizontal?'x' as const:'y' as const,reverse:horizontal?bx<ax:by<ay};
}

type Point = { x: number; y: number };
const segmentBlocked = (a: Point, b: Point, rect: CanvasRect, padding = 8) => {
  const left = rect.x - padding, right = rect.x + rect.width + padding;
  const top = rect.y - padding, bottom = rect.y + rect.height + padding;
  return a.x === b.x
    ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
    : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
};

/** Route across the gutters when the direct curve would pass through another image. */
export function routedCanvasConnectionGeometry(source: CanvasRect, target: CanvasRect, obstacles: readonly CanvasRect[]): ReturnType<typeof canvasConnectionGeometry> {
  const fallback = canvasConnectionGeometry(source, target);
  const horizontal = fallback.axis === 'x';
  if (!horizontal) {
    // Reuse the same gutter search after transposing the scene, including negative coordinates.
    const transpose = (r: CanvasRect): CanvasRect => ({ x: r.y, y: r.x, width: r.height, height: r.width });
    const a = transpose(source), b = transpose(target);
    const route = routedCanvasConnectionGeometry(a, b, obstacles.map(r => r === source ? a : r === target ? b : transpose(r)));
    const number = '-?(?:\\d*\\.)?\\d+(?:e[+-]?\\d+)?';
    return { ...route, x: route.y, y: route.x, width: route.height, height: route.width,
      d: route.d.replace(new RegExp(`(${number}) (${number})`, 'gi'), '$2 $1'), axis: 'y' as const };
  }
  const direction = fallback.reverse ? -1 : 1;
  const a = { x: direction > 0 ? source.x + source.width : source.x, y: source.y + source.height / 2 };
  const b = { x: direction > 0 ? target.x : target.x + target.width, y: target.y + target.height / 2 };
  const between = obstacles.filter(r => r !== source && r !== target && r.x < Math.max(a.x, b.x) + 24 && r.x + r.width > Math.min(a.x, b.x) - 24);
  const boxHits = between.some(r => r.x < fallback.x + fallback.width - 16 && r.x + r.width > fallback.x + 16 && r.y < fallback.y + fallback.height - 16 && r.y + r.height > fallback.y + 16);
  if (!boxHits) return fallback;
  // Use the centre of the actual gap beside each port. A fixed 24-unit
  // lead enters a neighbouring image when compact rows have a 24-unit gutter.
  const leadAt = (port: Point, sign: number) => {
    const distances = between.filter(r => port.y > r.y - 8 && port.y < r.y + r.height + 8)
      .map(r => sign > 0 ? r.x - port.x : port.x - r.x - r.width).filter(d => d > 0);
    return Math.min(24, Math.abs(b.x - a.x) / 4, ...distances.map(d => d / 2));
  };
  const start = { x: a.x + direction * leadAt(a, direction), y: a.y };
  const end = { x: b.x - direction * leadAt(b, -direction), y: b.y };
  const lanes = new Set([target.y - 12, target.y + target.height + 12, source.y - 12, source.y + source.height + 12]);
  for (const rect of between) { lanes.add(rect.y - 12); lanes.add(rect.y + rect.height + 12); }
  const clear = (points: Point[]) => points.slice(1).every((point, index) => between.every(rect => !segmentBlocked(points[index], point, rect)));
  const candidates = [...lanes].map(y => [a, start, { x: start.x, y }, { x: end.x, y }, end, b]);
  candidates.sort((p, q) => {
    const length = (points: Point[]) => points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y), 0);
    return length(p) - length(q);
  });
  const points = candidates.find(clear);
  if (!points) return fallback;
  const x = Math.min(...points.map(p => p.x)) - 16, y = Math.min(...points.map(p => p.y)) - 16;
  const width = Math.max(...points.map(p => p.x)) - x + 16, height = Math.max(...points.map(p => p.y)) - y + 16;
  const local = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y).map(p => ({ x: p.x - x, y: p.y - y }));
  let d = `M ${local[0].x} ${local[0].y}`;
  for (let i = 1; i < local.length - 1; i++) {
    const previous = local[i - 1], point = local[i], next = local[i + 1];
    const beforeLength = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const afterLength = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const radius = Math.min(12, beforeLength / 2, afterLength / 2);
    const before = { x: point.x - Math.sign(point.x - previous.x) * radius, y: point.y - Math.sign(point.y - previous.y) * radius };
    const after = { x: point.x + Math.sign(next.x - point.x) * radius, y: point.y + Math.sign(next.y - point.y) * radius };
    d += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
  }
  const last = local.at(-1)!;
  return { x, y, width, height, d: d + ` L ${last.x} ${last.y}`, axis: 'x' as const, reverse: direction < 0 };
}
