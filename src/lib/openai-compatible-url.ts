/** Preserve provider-specific version prefixes (Ark /api/v3, Zhipu /api/paas/v4). */
export function openAICompatibleUrl(baseUrl: string, resource: "models" | "chat/completions") {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(base);
  if (/\/chat\/completions$|\/models$/i.test(url.pathname)) {
    return base.replace(/\/(?:chat\/completions|models)$/i, "/" + resource);
  }
  return `${base}${url.pathname === "/" || !url.pathname ? "/v1" : ""}/${resource}`;
}
