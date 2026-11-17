export type PromptMetadata = {
  subcategory?: string;
  key?: string;
  previewKind?: 'example' | 'reference' | 'schematic';
  referencePreviewUrl?: string;
  language?: string;
  author?: string;
  url?: string;
  collection?: string;
  collectionUrl?: string;
  note?: string;
  referenceRequired?: boolean;
  historyImageId?: string;
  projectName?: string;
  collectedAt?: string;
  batch?: string;
};

export function promptMetadata(source?: string): PromptMetadata {
  if (!source) return {};
  try {
    const value: unknown = JSON.parse(source);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as PromptMetadata;
  } catch { /* Earlier records store a plain source URL. */ }
  return { url: source };
}

export function promptTags(tags?: string): string[] {
  if (!tags) return [];
  try {
    const value: unknown = JSON.parse(tags);
    if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim());
  } catch { /* Support comma-separated tags from older libraries. */ }
  return tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
}

export function promptSourceUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function matchesPrompt(item: { text: string; name?: string; tags?: string; source?: string }, query: string): boolean {
  const metadata = promptMetadata(item.source);
  const haystack = [item.text, item.name, ...promptTags(item.tags), metadata.subcategory, metadata.author, metadata.collection].join(' ').toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => haystack.includes(word));
}
