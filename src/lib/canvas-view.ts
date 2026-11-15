import type { CanvasImage } from './types';

export type CanvasRect = { x: number; y: number; width: number; height: number };

export function isFiniteCanvasRect(rect: CanvasRect) {
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) && Number.isFinite(rect.y + rect.height);
}

/** Empty, hidden or invalid geometry must never poison the camera transform. */
export function fitCanvasView(rects: readonly CanvasRect[], viewport: { width: number; height: number }) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 80 || viewport.height <= 80) return null;
  const valid = rects.filter(isFiniteCanvasRect);
  if (!valid.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of valid) {
    left = Math.min(left, rect.x); top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
  }
  const width = right - left, height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.max(0.05, Math.min((viewport.width - 80) / width, (viewport.height - 80) / height, 1.5));
  const offset = { x: (viewport.width - width * scale) / 2 - left * scale, y: (viewport.height - height * scale) / 2 - top * scale };
  return Number.isFinite(offset.x) && Number.isFinite(offset.y) ? { scale, offset } : null;
}

/** Programmatic camera changes take effect in the same render as the new layout. */
export function canvasViewport(size: { width: number; height: number }, offset: { x: number; y: number }, scale: number, overscanPixels = 750) {
  if (![size.width, size.height, offset.x, offset.y, scale].every(Number.isFinite) || size.width <= 0 || size.height <= 0 || scale <= 0) return null;
  const margin = overscanPixels / scale;
  return { x: -offset.x / scale - margin, y: -offset.y / scale - margin, right: (size.width - offset.x) / scale + margin, bottom: (size.height - offset.y) / scale + margin };
}

/** Unknown viewport means defer culling, never hide a valid scene. */
export function canvasRectInView(rect: CanvasRect, view: ReturnType<typeof canvasViewport>) {
  if (!isFiniteCanvasRect(rect)) return false;
  return !view || (rect.x + rect.width >= view.x && rect.y + rect.height >= view.y && rect.x <= view.right && rect.y <= view.bottom);
}

/** The async result owns pixels; the live placeholder owns its current placement. */
export function inheritCanvasPlacement(result: CanvasImage, images: readonly CanvasImage[], placeholderId: string): CanvasImage {
  const live = images.find(image => image.id === placeholderId || image.generationKey === placeholderId) || images.find(image => image.id === result.id);
  if (!live) return result;
  return { ...result, canvas_x: live.canvas_x, canvas_y: live.canvas_y, canvas_width: live.canvas_width, canvas_height: live.canvas_height, canvas_block_id: live.canvas_block_id, block_order: live.block_order };
}
