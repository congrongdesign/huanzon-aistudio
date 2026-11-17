export type FontFile = { key: string; url: string; width?: number; height?: number; label: string; role: 'sample' | 'reference'; missing?: boolean; importItemId?: string };
export type FontParameters = { model?: string; size?: string; imageSize?: string; quality?: string; background?: string; outputFormat?: string; moderation?: string };
export type GenerationRecipe = { schemaVersion: 1; prompt: string; userPrompt?: string; referenceImages: string[]; referenceLabels?: string[]; parameters: FontParameters; sourceFontCardId?: string; assistantMessageId?: string; operationId?: string; createdAt: string };
export type FontAnalysis = { status: 'running' | 'completed' | 'failed'; model: string; analyzedAt?: string; error?: string; confidence?: number; previous?: { title: string; sampleText: string; groupId: string | null; prompt: string; style?: string; tags?: string[]; description?: string } };
export type FontCard = { importItemId?: string; importManual?: string[]; importAppliedId?: string; shareOrigin?: string; shareRevision?: string; shareContentHash?: string; shareStateHash?: string; id: string; ownerId: string; version: number; title: string; sampleText: string; groupId: string | null; favorite: boolean; style?: string; tags?: string[]; description?: string; analysis?: FontAnalysis; cover: FontFile; references: FontFile[]; prompt: string; originalPrompt: string; parameters: FontParameters; source: { imageId?: string; projectId?: string | null; projectName?: string; createdAt?: string; fontCardId?: string; operationId?: string; type: 'upload' | 'history' }; warnings: string[]; createdAt: string; updatedAt: string; lastUsedAt?: string; deletedAt?: string | null; purgeAfter?: string | null };
export type FontSummary = Pick<FontCard, 'id' | 'version' | 'title' | 'sampleText' | 'groupId' | 'favorite' | 'cover' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'style' | 'tags' | 'description'> & { referenceCount: number; warningCount: number; analysisStatus?: FontAnalysis['status']; analysisError?: string };
export type FontGroup = { id: string; name: string };
export type FontUseRequest = { card: FontCard; mode: 'append' | 'replace' | 'image'; useSize?: boolean };
export type FontComposerRef = { url: string; label: string };

// Preserve original records. Only the copy inserted into the composer is renumbered.
export function stripReferenceLegend(text: string) {
  return text.replace(/\n*参考图说明（(?:按顺序|本次输入顺序)）：[\s\S]*$/u, '').replace(/\u00a0/g, ' ').trim();
}
// Remove provenance commentary from reusable instructions, keeping design constraints.
export function cleanFontStylePrompt(text: string) {
  return text.replace(/\u00a0/g, ' ').split(/(?<=[。！？!?；;\n])/u).filter(part => {
    const sentence = part.trim().replace(/^(?:[-*>#]+\s*)?(?:[（(【\[]?(?:说明|备注|注|提示)[）)】\]]?[：:]\s*)?/u, '');
    return !(
      /^(?:以下|下面|以上|上述|本段|这段|本提示词|该提示词|这些建议|这里).{0,20}(?:根据|基于|参考).{0,35}(?:整理|提炼|推导|反推|归纳).{0,30}(?:建议|提示词|描述|参考)/u.test(sentence) ||
      /^(?:(?:本|该|此|以上|以下|这些).{0,15})?(?:并非|不是|不代表|不等同于|非)(?:原作者|作者|原始|原图作者|原作).{0,20}(?:提示词|生成指令)/u.test(sentence) ||
      /^(?:无法|不能|未能)(?:获取|确认|得知|还原|验证)(?:到)?(?:原作者|作者|原始|原图).{0,15}提示词/u.test(sentence) ||
      /^(?:仅供|只供)(?:字体)?(?:风格复用|风格参考|参考复用)(?:参考|使用)?[。；;！!]?$/u.test(sentence)
    );
  }).join('').replace(/\n{3,}/g, '\n\n').trim();
}
export function fontStylePromptFromCard(card: Pick<FontCard, 'prompt' | 'originalPrompt'>) {
  return cleanFontStylePrompt(card.prompt) || cleanFontStylePrompt(card.originalPrompt);
}
export function buildFontComposer(request: FontUseRequest, existingText: string, existingRefs: FontComposerRef[], selectedUrls?: string[]) {
  const { card, mode } = request;
  const refs: FontComposerRef[] = mode === 'replace' ? [] : existingRefs.filter(r => !selectedUrls || selectedUrls.includes(r.url)).map(r => ({ ...r }));
  const include = (url: string) => !selectedUrls || selectedUrls.includes(url);
  const add = (file: FontFile) => {
    if (file.missing || !file.url || !include(file.url)) return null;
    const found = refs.findIndex(r => r.url === file.url);
    if (found >= 0) { if (!refs[found].label.includes(file.label)) refs[found].label += ` / ${file.label}`; return found + 1; }
    refs.push({ url: file.url, label: file.label }); return refs.length;
  };
  const sample = add({ ...card.cover, label: `字体样式 · ${card.title}` });
  const mapping = mode === 'image' ? [] : card.references.map(add);
  const original = stripReferenceLegend(fontStylePromptFromCard(card));
  const prompt = original.replace(/\[@图(\d+)\]|\[图(\d+)\]|第(\d+)张图|图(\d+)(?!\d)/g, (_, a, b, c, d) => {
    const n = Number(a || b || c || d); const mapped = mapping[n - 1];
    return mapped ? `图${mapped}` : `【原参考图${n}未带入，请补充】`;
  }).replace(/\[@[^\]]+\]/g, '');
  const prefix = mode === 'replace' ? '' : stripReferenceLegend(existingText).replace(/\[@图\d+\]/g, '').replace(/第(\d+)张图|图(\d+)(?!\d)/g, (_, a, b) => {
    const original = existingRefs[Number(a || b) - 1];
    const mapped = original ? refs.findIndex(r => r.url === original.url) + 1 : 0;
    return mapped ? `图${mapped}` : `【草稿参考图${a || b}未带入】`;
  }).trim();
  const body = mode === 'image' ? '' : (prompt || '请参考字体样式设计新的文字，请在此填写目标文字和要求。');
  const section = [`字体案例：${card.title}`, sample ? `字体风格参考：图${sample}。` : '', body].filter(Boolean).join('\n');
  return { text: [prefix, section].filter(Boolean).join('\n\n'), refs };
}
