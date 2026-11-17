import type { FontCard, FontFile, FontParameters, FontUseRequest } from './font-library-types';
import { cleanFontStylePrompt, fontStylePromptFromCard, stripReferenceLegend } from './font-library-types';
import { applyFontTargetText, extractFontTargetText } from './font-style-text';

export type GenerationDestination = { kind: 'canvas'; projectId: string } | { kind: 'font'; sessionId: string };
export type FontCreationSettings = { model: string; size: string; count: number; quality: string; imageSize: string; background: string; outputFormat: string; moderation: string };
export type FontUserReference = FontFile & { referenceId: string };
export type FontActiveStyle = { cardId: string; cardVersion: number; revision: string; title: string; cover: FontFile; references: FontFile[]; prompt: string; originalPrompt: string; mode: 'recipe' | 'image' };
export type FontCreationDraft = { userText: string; userReferences: FontUserReference[]; settings: FontCreationSettings; stylePrompt: string; stylePromptInInput?: boolean; excludedReferenceIds: string[] };
export type FontCreationRun = { id: string; requestId: string; jobId?: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; prompt: string; userPrompt: string; style: FontActiveStyle | null; references: FontFile[]; parameters: FontParameters; result?: FontFile; error?: string; createdAt: string; updatedAt: string; deletedAt?: string; purgeAfter?: string; exports?: Record<string, string> };
export type FontCreationSession = { schemaVersion: 1; id: string; ownerId: string; title: string; revision: number; activeStyle: FontActiveStyle | null; styleUndo: Array<{ style: FontActiveStyle | null; prompt: string; excluded: string[] }>; draft: FontCreationDraft; runs: FontCreationRun[]; createdAt: string; updatedAt: string };
export type FontSessionSummary = Pick<FontCreationSession, 'id' | 'title' | 'updatedAt'>;
export const DEFAULT_FONT_SETTINGS: FontCreationSettings = { model: 'gpt-image-2', size: '16:9', count: 1, quality: 'auto', imageSize: '4K', background: 'auto', outputFormat: 'png', moderation: 'auto' };
export function styleFromCard(card: FontCard, mode: FontUseRequest['mode'] = 'append', revision = ''): FontActiveStyle {
  return { cardId: card.id, cardVersion: card.version, revision, title: card.title, cover: { ...card.cover, label: `字体样式 · ${card.title}` }, references: structuredClone(card.references), prompt: fontStylePromptFromCard(card), originalPrompt: card.originalPrompt, mode: mode === 'image' ? 'image' : 'recipe' };
}
// Replace the old input, transferring only the user's target lettering to the new style.
export function withFontStyleInput(draft: FontCreationDraft, prompt: string): FontCreationDraft {
  const previous = stripReferenceLegend(cleanFontStylePrompt(draft.stylePrompt));
  const next = stripReferenceLegend(cleanFontStylePrompt(prompt));
  const personal = draft.stylePromptInInput && previous && draft.userText.startsWith(previous)
    ? draft.userText.slice(previous.length).replace(/^\n{1,2}/, '') : draft.userText;
  // A legacy composer may contain the untouched sample followed by personal input.
  // Never infer missing personal subtitles from that sample.
  const target = extractFontTargetText(personal || draft.userText);
  const userText = next ? applyFontTargetText(next, target) : target ? [`主标题：${target.title}`, target.subtitle ? `副标题：${target.subtitle}` : ''].filter(Boolean).join('\n') : personal;
  return { ...draft, userText, stylePrompt: next, stylePromptInInput: true };
}
export type FontReferenceCandidate = { id: string; file: FontFile; role: 'user' | 'sample' | 'reference' };
export function fontReferenceCandidates(style: FontActiveStyle | null, draft: FontCreationDraft): FontReferenceCandidate[] {
  const candidates: FontReferenceCandidate[] = draft.userReferences.map(ref => ({ id: ref.referenceId, file: ref, role: 'user' }));
  if (style) { candidates.push({ id: `style:${style.revision}:sample`, file: style.cover, role: 'sample' }); if (style.mode === 'recipe') style.references.forEach((file, index) => candidates.push({ id: `style:${style.revision}:ref:${index}`, file, role: 'reference' })); }
  return candidates;
}
export function compileFontCreation(style: FontActiveStyle | null, draft: FontCreationDraft) {
  const files: FontFile[] = []; const positions = new Map<string, number>();
  for (const candidate of fontReferenceCandidates(style, draft)) {
    const file = candidate.file; if (file.missing || !file.url || draft.excludedReferenceIds.includes(candidate.id)) continue;
    let index = files.findIndex(r => r.key === file.key);
    if (index < 0) { files.push({ ...file }); index = files.length - 1; } else if (!files[index].label.includes(file.label)) files[index].label += ` / ${file.label}`;
    positions.set(candidate.id, index + 1);
  }
  const sample = style ? positions.get(`style:${style.revision}:sample`) : undefined;
  const original = draft.stylePromptInInput ? stripReferenceLegend(cleanFontStylePrompt(draft.userText)) : style?.mode === 'image' ? '' : stripReferenceLegend(cleanFontStylePrompt(draft.stylePrompt));
  const prompt = original.replace(/\[@图(\d+)\]|\[图(\d+)\]|第(\d+)张图|图(\d+)(?!\d)/g, (_, a, b, c, d) => {
    const n = Number(a || b || c || d); const position = style ? positions.get(`style:${style.revision}:ref:${n - 1}`) : undefined;
    return position ? `图${position}` : `【原参考图${n}未带入，请勿猜测其内容】`;
  });
  const instructions = [style ? `当前字体风格：${style.title}` : '', sample ? `图${sample}是字体风格样本，用于参考字形设计与笔画气质。` : '', prompt, !draft.stylePromptInInput && draft.userText.trim() ? `用户本次要求（目标文字与明确要求优先）：\n${draft.userText.trim()}` : '', files.length ? `参考图说明（本次输入顺序）：\n${files.map((f, i) => `图${i + 1}：${f.label}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  return { prompt: instructions, files, positions };
}
