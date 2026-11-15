export type ComposerSize = { width?: number; height?: number };
export type ComposerLimits = { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };
export type ComposerResizeEdge = 'n' | 'w' | 'e' | 'nw' | 'ne';

export function readComposerSize(raw: string | null): ComposerSize {
  try {
    const value = JSON.parse(raw || '{}');
    return Object.fromEntries(['width', 'height'].flatMap(key =>
      typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0 ? [[key, value[key]]] : []));
  } catch { return {}; }
}

export function clampComposerSize(size: ComposerSize, limits: ComposerLimits): ComposerSize {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.max(Math.min(min, max), Math.min(max, value)));
  return {
    ...(size.width === undefined ? {} : { width: clamp(size.width, limits.minWidth, limits.maxWidth) }),
    ...(size.height === undefined ? {} : { height: clamp(size.height, limits.minHeight, limits.maxHeight) }),
  };
}

/** A centred dock grows equally on both sides and stays anchored at the bottom. */
export function resizeComposer(start: { width: number; height: number }, saved: ComposerSize, edge: ComposerResizeEdge, dx: number, dy: number, limits: ComposerLimits) {
  return { ...saved, ...clampComposerSize({
    ...(edge.includes('w') ? { width: start.width - dx * 2 } : edge.includes('e') ? { width: start.width + dx * 2 } : {}),
    ...(edge.includes('n') ? { height: start.height - dy } : {}),
  }, limits) };
}
