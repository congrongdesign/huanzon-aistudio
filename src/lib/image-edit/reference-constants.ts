export const MAX_MODEL_REFERENCE_IMAGES = 16;
export const NANO_BANANA_REFERENCE_IMAGES = 14;

export function getReferenceImageLimitForModel(model?: string | null): number {
  const normalized = (model || "").trim().toLowerCase();
  if (normalized.startsWith("nano-banana")) {
    return NANO_BANANA_REFERENCE_IMAGES;
  }
  return MAX_MODEL_REFERENCE_IMAGES;
}
