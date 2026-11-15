import type { CanvasImage } from './types';

type Layout = Pick<CanvasImage, 'canvas_x' | 'canvas_y' | 'canvas_width' | 'canvas_height'>;
const key = (project: string) => `hz_canvas_reference_layouts_v1:${project}`;

export function restoreReferenceLayouts(images: CanvasImage[]): CanvasImage[] {
  const project = images[0]?.project_id;
  if (!project || typeof localStorage === 'undefined') return images;
  try {
    const saved = JSON.parse(localStorage.getItem(key(project)) || '{}') as Record<string, Layout>;
    return images.map(image => {
      const layout = saved[image.id] || saved[image.image_url];
      return layout && Object.values(layout).every(Number.isFinite) && layout.canvas_width > 0 && layout.canvas_height > 0
        ? { ...image, ...layout } : image;
    });
  } catch { return images; }
}

export function saveReferenceLayouts(project: string, images: readonly CanvasImage[]) {
  try {
    const layouts: Record<string, Layout> = {};
    for (const image of images) {
      if (!image.is_reference || image.project_id !== project || !image.image_url || image.isUploading) continue;
      const layout = { canvas_x: image.canvas_x, canvas_y: image.canvas_y, canvas_width: image.canvas_width, canvas_height: image.canvas_height };
      layouts[image.id] = layout;
      layouts[image.image_url] = layout;
    }
    localStorage.setItem(key(project), JSON.stringify(layouts));
  } catch { /* Existing database images and the active canvas remain available. */ }
}
