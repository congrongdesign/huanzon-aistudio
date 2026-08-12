import type { LocalDesignAssetRecord, LocalImageRecord } from "@/lib/local-backend";
import type { AssetIndexEntry, DesignAssetKind } from "@/lib/types";

type SearchTagMode = "any" | "all";

export type AssetSearchFilters = {
  projectId?: string | null;
  sourceType?: "design_asset" | "image_record" | null;
  kinds?: string[];
  models?: string[];
  sizes?: string[];
  tags?: string[];
  tagMode?: SearchTagMode;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function splitByDelimiters(value: string): string[] {
  return value
    .split(/[,\s，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return splitByDelimiters(value);
  }
  return [];
}

function parseJsonArrayString(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((item) => item.toLowerCase()));
}

function parseTagsFromMetadata(metadata: Record<string, unknown>): string[] {
  const directTags = parseStringArray(metadata.tags);
  const aliasTags = parseStringArray(metadata.tag);
  const labels = parseStringArray(metadata.labels);
  const all = [...directTags, ...aliasTags, ...labels]
    .map((tag) => tag.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

function parseKeywordsFromMetadata(metadata: Record<string, unknown>): string[] {
  const keywords = parseStringArray(metadata.keywords);
  return [...new Set(keywords.map((item) => item.trim()).filter(Boolean))];
}

function inferPrompt(metadata: Record<string, unknown>): string {
  return (
    asString(metadata.prompt) ||
    asString(metadata.originalPrompt) ||
    asString(metadata.instruction) ||
    asString(metadata.description)
  );
}

function inferModel(metadata: Record<string, unknown>): string {
  return (
    asString(metadata.model) ||
    asString(metadata.providerModel) ||
    asString(metadata.sourceModel)
  );
}

function inferSize(metadata: Record<string, unknown>, width: number, height: number): string {
  const fromMeta = asString(metadata.size) || asString(metadata.aspectRatio);
  if (fromMeta) return fromMeta;
  if (width > 0 && height > 0) return `${width}x${height}`;
  return "";
}

function inferCaption(prompt: string, metadata: Record<string, unknown>): string {
  const fromMeta = asString(metadata.caption) || asString(metadata.summary);
  if (fromMeta) return fromMeta;
  if (!prompt) return "";
  return prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt;
}

function inferOcrText(metadata: Record<string, unknown>): string {
  return asString(metadata.ocr_text) || asString(metadata.ocrText) || asString(metadata.text);
}

function inferDominantColor(metadata: Record<string, unknown>): string | null {
  const color = asString(metadata.dominant_color) || asString(metadata.dominantColor);
  return color || null;
}

function tokenizeText(text: string): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]+/g);
  if (!matches) return [];
  return matches.filter((token) => token.length > 1 || /[\u4e00-\u9fa5]/.test(token));
}

function buildKeywords(parts: string[], extra: string[] = []): string[] {
  const merged = [...extra];
  for (const part of parts) {
    merged.push(...tokenizeText(part));
  }
  return [...new Set(merged.map((item) => item.trim()).filter(Boolean))];
}

function safeKind(kind: string): DesignAssetKind {
  const allowed: DesignAssetKind[] = ["image", "mask", "layer", "reference", "export", "ppt_page"];
  return allowed.includes(kind as DesignAssetKind) ? (kind as DesignAssetKind) : "image";
}

export function buildAssetIndexEntryFromDesignAsset(asset: LocalDesignAssetRecord): AssetIndexEntry {
  const metadata = asObject(asset.metadata);
  const prompt = inferPrompt(metadata);
  const model = inferModel(metadata);
  const size = inferSize(metadata, asset.width, asset.height);
  const tags = parseTagsFromMetadata(metadata);
  const caption = inferCaption(prompt, metadata);
  const ocrText = inferOcrText(metadata);
  const dominantColor = inferDominantColor(metadata);
  const metadataKeywords = parseKeywordsFromMetadata(metadata);
  const keywords = buildKeywords(
    [prompt, caption, ocrText, model, size, dominantColor || "", ...tags],
    metadataKeywords,
  );

  return {
    id: "",
    user_id: asset.user_id,
    project_id: asset.project_id,
    source_type: "design_asset",
    source_id: asset.id,
    kind: safeKind(asset.kind),
    url: asset.url,
    key: asset.key,
    width: asset.width,
    height: asset.height,
    prompt,
    model,
    size,
    tags,
    caption,
    ocr_text: ocrText,
    dominant_color: dominantColor,
    keywords,
    metadata,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
  };
}

export function buildAssetIndexEntryFromImageRecord(record: LocalImageRecord): AssetIndexEntry {
  const prompt = asString(record.prompt);
  const model = asString(record.model);
  const size = asString(record.size);
  const caption = prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt;
  const referenceImages = parseJsonArrayString(asString(record.reference_images));
  const tags: string[] = [];
  if (record.is_favorite) tags.push("favorite");
  const keywords = buildKeywords([prompt, model, size, ...tags], referenceImages);
  const metadata: Record<string, unknown> = {
    imageRecordId: record.id,
    status: record.status,
    isFavorite: record.is_favorite,
    reference_images: record.reference_images,
    deleted_at: record.deleted_at,
    referenceCount: referenceImages.length,
  };

  return {
    id: "",
    user_id: record.user_id,
    project_id: record.project_id,
    source_type: "image_record",
    source_id: record.id,
    kind: "image_record",
    url: record.image_url,
    key: record.image_key,
    width: Math.max(0, Math.round(record.canvas_width || 0)),
    height: Math.max(0, Math.round(record.canvas_height || 0)),
    prompt,
    model,
    size,
    tags,
    caption,
    ocr_text: "",
    dominant_color: null,
    keywords,
    metadata,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function includesAny(text: string, values: string[]): boolean {
  if (values.length === 0) return true;
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(value.toLowerCase()));
}

function equalsAny(text: string, values: string[]): boolean {
  if (values.length === 0) return true;
  const lower = text.toLowerCase();
  return values.some((value) => lower === value.toLowerCase());
}

function matchTags(tags: string[], filters: string[], mode: SearchTagMode): boolean {
  if (filters.length === 0) return true;
  const tagSet = lowerSet(tags);
  const matched = filters.filter((filterTag) => tagSet.has(filterTag.toLowerCase())).length;
  if (mode === "all") return matched === filters.length;
  return matched > 0;
}

export function matchesAssetSearchFilters(entry: AssetIndexEntry, filters: AssetSearchFilters): boolean {
  if (filters.projectId && entry.project_id !== filters.projectId) return false;
  if (filters.sourceType && entry.source_type !== filters.sourceType) return false;
  if (filters.kinds?.length) {
    const allowed = lowerSet(filters.kinds);
    if (!allowed.has(entry.kind.toLowerCase())) return false;
  }
  if (filters.models?.length && !includesAny(entry.model, filters.models)) return false;
  if (filters.sizes?.length && !equalsAny(entry.size, filters.sizes)) return false;
  if (!matchTags(entry.tags || [], filters.tags || [], filters.tagMode || "any")) return false;
  return true;
}

export function scoreAssetIndexEntry(entry: AssetIndexEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const tokens = tokenizeText(q);
  const prompt = (entry.prompt || "").toLowerCase();
  const caption = (entry.caption || "").toLowerCase();
  const ocr = (entry.ocr_text || "").toLowerCase();
  const model = (entry.model || "").toLowerCase();
  const size = (entry.size || "").toLowerCase();
  const tags = (entry.tags || []).map((item) => item.toLowerCase());
  const keywords = (entry.keywords || []).map((item) => item.toLowerCase());

  let score = 0;
  if (prompt.includes(q)) score += 10;
  if (caption.includes(q)) score += 8;
  if (ocr.includes(q)) score += 7;
  if (tags.some((item) => item.includes(q))) score += 9;
  if (keywords.some((item) => item.includes(q))) score += 6;
  if (model.includes(q)) score += 4;
  if (size.includes(q)) score += 3;

  let matchedTokenCount = 0;
  for (const token of tokens) {
    let matched = false;
    if (prompt.includes(token)) { score += 3; matched = true; }
    if (caption.includes(token)) { score += 2; matched = true; }
    if (ocr.includes(token)) { score += 2; matched = true; }
    if (tags.some((item) => item.includes(token))) { score += 3; matched = true; }
    if (keywords.some((item) => item.includes(token))) { score += 1; matched = true; }
    if (model.includes(token)) { score += 1; matched = true; }
    if (size.includes(token)) { score += 1; matched = true; }
    if (matched) matchedTokenCount += 1;
  }

  if (tokens.length > 1 && matchedTokenCount >= tokens.length) {
    score += 4;
  }

  return score;
}

export function extractSearchHighlights(entry: AssetIndexEntry, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const highlights: string[] = [];
  if ((entry.prompt || "").toLowerCase().includes(q)) highlights.push("prompt");
  if ((entry.caption || "").toLowerCase().includes(q)) highlights.push("caption");
  if ((entry.ocr_text || "").toLowerCase().includes(q)) highlights.push("ocr");
  if ((entry.tags || []).some((item) => item.toLowerCase().includes(q))) highlights.push("tags");
  if ((entry.keywords || []).some((item) => item.toLowerCase().includes(q))) highlights.push("keywords");
  if ((entry.model || "").toLowerCase().includes(q)) highlights.push("model");
  return highlights;
}

export function topFacet(values: string[], limit = 10): Array<{ value: string; count: number }> {
  const counter = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counter.set(normalized, (counter.get(normalized) || 0) + 1);
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}
