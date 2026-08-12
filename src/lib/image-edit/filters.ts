export interface ImageFilterSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  grayscale: number;
  sepia: number;
  sharpen: number;
  blur: number;
}

export const DEFAULT_IMAGE_FILTER_SETTINGS: ImageFilterSettings = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  temperature: 0,
  hue: 0,
  grayscale: 0,
  sepia: 0,
  sharpen: 0,
  blur: 0,
};

export const IMAGE_FILTER_PRESETS: Array<{ id: string; name: string; settings: Partial<ImageFilterSettings> }> = [
  { id: "clean", name: "清透增强", settings: { brightness: 106, contrast: 108, saturation: 108, sharpen: 18 } },
  { id: "warm", name: "暖调商业", settings: { brightness: 104, contrast: 106, saturation: 112, temperature: 22, sharpen: 12 } },
  { id: "cool", name: "冷调科技", settings: { brightness: 102, contrast: 112, saturation: 96, temperature: -26, sharpen: 18 } },
  { id: "film", name: "胶片柔和", settings: { brightness: 101, contrast: 92, saturation: 92, temperature: 12, sepia: 10 } },
  { id: "mono", name: "高级黑白", settings: { brightness: 104, contrast: 118, saturation: 0, grayscale: 100, sharpen: 8 } },
  { id: "product", name: "产品锐化", settings: { brightness: 103, contrast: 112, saturation: 106, sharpen: 30 } },
];

export function clampFilterSettings(input?: Partial<ImageFilterSettings> | null): ImageFilterSettings {
  const source = { ...DEFAULT_IMAGE_FILTER_SETTINGS, ...(input || {}) };
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return {
    brightness: clamp(source.brightness, 0, 200),
    contrast: clamp(source.contrast, 0, 200),
    saturation: clamp(source.saturation, 0, 200),
    temperature: clamp(source.temperature, -100, 100),
    hue: clamp(source.hue, -180, 180),
    grayscale: clamp(source.grayscale, 0, 100),
    sepia: clamp(source.sepia, 0, 100),
    sharpen: clamp(source.sharpen, 0, 100),
    blur: clamp(source.blur, 0, 20),
  };
}

export function isDefaultFilterSettings(settings: ImageFilterSettings): boolean {
  return Object.entries(DEFAULT_IMAGE_FILTER_SETTINGS).every(([key, value]) => settings[key as keyof ImageFilterSettings] === value);
}

export function buildCssImageFilter(settings?: Partial<ImageFilterSettings> | null): string {
  const f = clampFilterSettings(settings);
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness / 100})`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast / 100})`);
  if (f.saturation !== 100) parts.push(`saturate(${f.saturation / 100})`);
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale / 100})`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia / 100})`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  return parts.join(" ");
}

export function describeFilterSettings(settings: ImageFilterSettings): string {
  const changed = Object.entries(DEFAULT_IMAGE_FILTER_SETTINGS)
    .filter(([key, value]) => settings[key as keyof ImageFilterSettings] !== value)
    .map(([key]) => key);
  return changed.length > 0 ? changed.join(", ") : "default";
}
