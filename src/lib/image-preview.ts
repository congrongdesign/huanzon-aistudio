const PREVIEW_SIZES = [128, 256, 512, 1024, 1600];

export function previewImageUrl(source: string, pixels = 512): string {
  // Only our local immutable image store supports previews; preserve remote URLs.
  if (!source.startsWith('/api/local-file/') && !source.startsWith('/api/font-file/')) return source;
  const url = new URL(source, 'http://preview.local');
  url.searchParams.set('w', String(PREVIEW_SIZES.find(size => size >= pixels) || 1600));
  return url.pathname + url.search;
}
