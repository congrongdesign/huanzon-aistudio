import type { CanvasRect } from './canvas-lineage';
/** Choose the closest free slot around a source, rather than ten columns to the right. */
export function nearbyCanvasPosition(source: CanvasRect, width: number, height: number, obstacles: readonly CanvasRect[]) {
  const gap = 24;
  const blocked = (x: number, y: number) => obstacles.some(r => x < r.x + r.width + 24 && x + width + 24 > r.x && y < r.y + r.height + 24 && y + height + 24 > r.y);
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let ring = 0; ring < 30; ring++) {
    const dy = ring * (height + gap), dx = ring * (width + gap);
    for (const sign of ring ? [1, -1] : [1]) {
      for (const point of [
        { x: source.x + source.width + gap, y: source.y + sign * dy },
        { x: source.x - width - gap, y: source.y + sign * dy },
        { x: source.x + sign * dx, y: source.y + source.height + gap },
        { x: source.x + sign * dx, y: source.y - height - gap },
      ]) {
        const horizontal = Math.max(0, source.x - (point.x + width), point.x - (source.x + source.width));
        const vertical = Math.max(0, source.y - (point.y + height), point.y - (source.y + source.height));
        candidates.push({ ...point, score: horizontal * horizontal + vertical * vertical + (point.x < source.x ? 1600 : 0) });
      }
    }
  }
  candidates.sort((a,b)=>a.score-b.score);
  const point=candidates.find(p=>!blocked(p.x,p.y));
  if (point) return { x: Math.round(point.x), y: Math.round(point.y) };
  // A completely occupied neighbourhood still gets a guaranteed empty outer slot.
  return { x: Math.max(source.x + source.width, ...obstacles.map(r=>r.x+r.width)) + gap, y: source.y };
}
