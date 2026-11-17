import type { ReferenceAsset } from './case-library-types';

export type ComposerReference = { url: string; id?: string; label?: string };
export const casePrompt = (item: ReferenceAsset) => (item.prompt || item.analysis?.prompt || '').trim();

/** Build the whole draft before navigating so images and instructions travel together. */
export function composeCaseReferences(content: string, references: ComposerReference[], items: ReferenceAsset[], withPrompt: boolean, limit: number) {
  const unique = [...new Map(items.map(item => [item.url, item])).values()];
  if (!unique.length || unique.some(item => !item.url || item.deletedAt)) throw new Error('请选择可用的参考图');
  if (withPrompt && unique.some(item => !casePrompt(item))) throw new Error('部分图片尚无提示词，请先智能解析，或选择「仅作参考图」');
  const merged = [...new Map(references.map(item => [item.url, item])).values()];
  for (const item of unique) if (!merged.some(ref => ref.url === item.url)) merged.push({ url: item.url, id: item.id, label: item.title });
  if (merged.length > limit) throw new Error(`一次最多使用 ${limit} 张参考图，请减少选择`);
  let text = content.trimEnd();
  if (withPrompt) for (const item of unique) {
    const prompt = casePrompt(item);
    if (text.includes(prompt)) continue;
    const section = unique.length > 1 ? `参考图${merged.findIndex(ref => ref.url === item.url) + 1}（${item.title}）：\n${prompt}` : prompt;
    text += (text.trim() ? '\n\n' : '') + section;
  }
  // Give new chips a predictable position, including when the previous draft had no tokens.
  const tokenCount = [...text.matchAll(/\[@[^\]]+\]/g)].length;
  const tokens = merged.slice(tokenCount).map((_, i) => `[@图${tokenCount + i + 1}]`).join(' ');
  return { content: text + (tokens ? `${text ? '\n' : ''}${tokens}` : ''), references: merged };
}
