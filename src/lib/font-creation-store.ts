import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getLocalDataDirectory, createImageRecord, saveBinaryFile, listProjects } from './local-backend';
import { fontOwnerKey, fontFilePath, getFont, FontStoreError, saveGenerationRecipe } from './font-library-store';
import { DEFAULT_FONT_SETTINGS, compileFontCreation, fontReferenceCandidates, styleFromCard, withFontStyleInput } from './font-creation-types';
import type { FontCreationSession, FontCreationDraft, FontCreationSettings, FontCreationRun, FontActiveStyle } from './font-creation-types';
import type { FontParameters, FontFile } from './font-library-types';
import { cleanFontStylePrompt } from './font-library-types';
import { getReferenceImageLimitForModel } from './image-edit/reference-constants';

const root = (owner: string) => path.join(getLocalDataDirectory(), 'font-creation', fontOwnerKey(owner));
const valid = (id: string) => /^[a-f0-9-]{36}$/.test(id);
const filePath = (owner: string, id: string) => { if (!valid(id)) throw new FontStoreError('字体设计不存在', 404); return path.join(root(owner), id + '.json'); };
async function write(session: FontCreationSession) {
  const target = filePath(session.ownerId, session.id); await fs.mkdir(path.dirname(target), { recursive: true }); const temporary = target + '.' + randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, JSON.stringify(session)); await fs.rename(temporary, target); } finally { await fs.unlink(temporary).catch(() => {}); }
}
export async function getFontSession(owner: string, id: string): Promise<FontCreationSession> {
  try { const value: FontCreationSession = JSON.parse(await fs.readFile(filePath(owner, id), 'utf8')); if (value.ownerId !== owner || value.schemaVersion !== 1) throw new FontStoreError('字体设计不可读取', 404);
    value.draft.stylePrompt = cleanFontStylePrompt(value.draft.stylePrompt);
    if (value.activeStyle) value.activeStyle.prompt = cleanFontStylePrompt(value.activeStyle.prompt);
    for (const previous of value.styleUndo) { previous.prompt = cleanFontStylePrompt(previous.prompt); if (previous.style) previous.style.prompt = cleanFontStylePrompt(previous.style.prompt); }
    return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FontStoreError('字体设计不存在', 404); throw error; }
}
async function mutate<T>(owner: string, id: string, fn: (session: FontCreationSession) => T | Promise<T>): Promise<T> {
  const folder = root(owner); await fs.mkdir(folder, { recursive: true }); filePath(owner, id); const lock = path.join(folder, id + '.lock');
  for (let n = 0; ; n++) { try { await fs.mkdir(lock); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const stat = await fs.stat(lock).catch(() => null); if (stat && Date.now() - stat.mtimeMs > 120000) { await fs.rm(lock, { recursive: true, force: true }); continue; } if (n > 300) throw new FontStoreError('设计正在保存，请稍后重试', 503); await new Promise(resolve => setTimeout(resolve, 20)); } }
  try { const session = await getFontSession(owner, id); const result = await fn(session); await write(session); return result; } finally { await fs.rmdir(lock).catch(() => {}); }
}
export async function listFontSessions(owner: string) {
  const names = await fs.readdir(root(owner)).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  const summaries = [];
  for (const name of names.filter(n => n.endsWith('.json'))) { const session = await getFontSession(owner, name.slice(0, -5)); summaries.push({ id: session.id, title: session.title, updatedAt: session.updatedAt }); }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function settings(input: Partial<FontCreationSettings> = {}): FontCreationSettings {
  return { model: String(input.model || DEFAULT_FONT_SETTINGS.model).slice(0, 300), size: String(input.size || DEFAULT_FONT_SETTINGS.size).slice(0, 30), count: Math.min(4, Math.max(1, Math.round(Number(input.count) || 1))), quality: ['auto','low','medium','high','xhigh','max','standard','hd'].includes(input.quality || '') ? input.quality! : 'high', imageSize: ['auto','1K','2K','4K'].includes(input.imageSize || '') || /^\d{3,5}x\d{3,5}$/.test(input.imageSize || '') ? input.imageSize! : DEFAULT_FONT_SETTINGS.imageSize, background: input.background === 'transparent' ? 'transparent' : 'auto', outputFormat: ['png','jpeg','webp'].includes(input.outputFormat || '') ? input.outputFormat! : 'png', moderation: input.moderation === 'low' ? 'low' : 'auto' };
}
export async function createFontSession(owner: string, initial?: Partial<FontCreationSettings>) {
  const now = new Date().toISOString(); const session: FontCreationSession = { schemaVersion: 1, id: randomUUID(), ownerId: owner, title: '未命名字体设计', revision: 1, activeStyle: null, styleUndo: [], draft: { userText: '', userReferences: [], settings: settings(initial), stylePrompt: '', excludedReferenceIds: [] }, runs: [], createdAt: now, updatedAt: now }; await write(session); return session;
}
const checkRevision = (session: FontCreationSession, revision: unknown) => { if (revision !== session.revision) throw new FontStoreError('此设计已在其他窗口更新。当前输入已保留，请重新载入后继续。', 409); };
async function validateFile(owner: string, file: FontFile) { if (typeof file?.key !== 'string') throw new FontStoreError('图片资料无效'); await fs.access(fontFilePath(file.key, owner)).catch(() => { throw new FontStoreError('参考图文件已缺失，请重新上传'); }); return { key: file.key, url: `/api/font-file/${file.key}`, width: file.width, height: file.height, label: String(file.label || '个人参考图').slice(0, 160), role: 'reference' as const }; }
export async function saveFontDraft(owner: string, id: string, revision: number, draft: FontCreationDraft, styleRevision: string | null, title?: string) {
  if (!draft || typeof draft.userText !== 'string' || draft.userText.length > 30000 || typeof draft.stylePrompt !== 'string' || draft.stylePrompt.length > 30000 || !Array.isArray(draft.userReferences) || draft.userReferences.length > 16) throw new FontStoreError('输入过长或参考图超过16张');
  const refs: FontCreationDraft['userReferences'] = []; for (const ref of draft.userReferences) refs.push({ ...await validateFile(owner, ref), referenceId: typeof ref.referenceId === 'string' ? ref.referenceId.slice(0, 100) : randomUUID() });
  return mutate(owner, id, session => { checkRevision(session, revision); if ((session.activeStyle?.revision || null) !== styleRevision) throw new FontStoreError('当前风格已改变，请重新载入', 409);
    const candidate = { userText: draft.userText, userReferences: refs, settings: settings(draft.settings), stylePrompt: cleanFontStylePrompt(draft.stylePrompt), stylePromptInInput: draft.stylePromptInInput === true, excludedReferenceIds: Array.isArray(draft.excludedReferenceIds) ? draft.excludedReferenceIds.filter(v => typeof v === 'string').slice(0, 64) : [] };
    session.draft = candidate; if (title) session.title = String(title).trim().slice(0, 100) || session.title; session.revision++; session.updatedAt = new Date().toISOString(); return session;
  });
}
export async function selectFontStyle(owner: string, id: string, revision: number, input: { cardId?: string; action?: string; mode?: string; prompt?: string; useSize?: boolean; selectedIds?: string[]; styleRevision?: string }, actualModel: string) {
  const card = input.cardId ? await getFont(owner, input.cardId) : null;
  return mutate(owner, id, async session => { checkRevision(session, revision);
    if (card && session.activeStyle?.cardId === card.id && session.activeStyle.mode === (input.mode === 'image' ? 'image' : 'recipe')) {
      if (session.activeStyle.mode === 'recipe' && (!session.draft.stylePromptInInput || !session.draft.userText.trim())) {
        session.draft = withFontStyleInput(session.draft, session.draft.stylePrompt || session.activeStyle.prompt);
        session.revision++; session.updatedAt = new Date().toISOString();
      }
      return session;
    }
    if (input.action === 'undo') { const previous = session.styleUndo.at(-1); if (!previous) return session; const candidate = {...withFontStyleInput(session.draft, previous.prompt), excludedReferenceIds: previous.excluded}; for(const item of fontReferenceCandidates(previous.style,candidate)) if(!item.file.missing) await validateFile(owner,item.file); if(compileFontCreation(previous.style,candidate).files.length > getReferenceImageLimitForModel(actualModel)) throw new FontStoreError('恢复风格后参考图将超出模型上限，请先减少个人参考图'); session.styleUndo.pop(); session.activeStyle = previous.style; session.draft = candidate; }
    else {
      const next: FontActiveStyle | null = card ? styleFromCard(card, input.mode === 'image' ? 'image' : 'append', input.styleRevision && valid(input.styleRevision) ? input.styleRevision : randomUUID()) : null;
      const candidate: FontCreationDraft = { ...withFontStyleInput(session.draft, next?.mode === 'image' ? '' : cleanFontStylePrompt(typeof input.prompt === 'string' ? input.prompt.slice(0, 30000) : '') || next?.prompt || ''), excludedReferenceIds: [] };
      if (candidate.userText.length > 30000) throw new FontStoreError('带入风格后输入超过30000字，请先精简输入');
      const candidates = fontReferenceCandidates(next, candidate);
      for (const item of candidates) if (!item.file.missing) await validateFile(owner, item.file);
      if (input.selectedIds) candidate.excludedReferenceIds = candidates.filter(c => !input.selectedIds!.includes(c.id)).map(c => c.id);
      if (compileFontCreation(next, candidate).files.length > getReferenceImageLimitForModel(actualModel)) throw new FontStoreError('参考图超出当前模型上限，请先选择');
      session.styleUndo.push({ style: session.activeStyle, prompt: session.draft.stylePrompt, excluded: session.draft.excludedReferenceIds }); session.styleUndo = session.styleUndo.slice(-8);
      session.activeStyle = next; session.draft = candidate;
      if (input.useSize && card?.parameters.size) session.draft.settings.size = card.parameters.size;
    }
    session.revision++; session.updatedAt = new Date().toISOString(); return session;
  });
}
export async function createFontRun(owner: string, id: string, revision: number, requestId: string, parameters: FontParameters) {
  return mutate(owner, id, session => {
    const existing = session.runs.find(run => run.requestId === requestId); if (existing) return existing;
    checkRevision(session, revision); if (!session.draft.userText.trim()) throw new FontStoreError('请填写本次要生成的文字或要求');
    const compiled = compileFontCreation(session.activeStyle, session.draft); if (compiled.files.length > getReferenceImageLimitForModel(parameters.model)) throw new FontStoreError('参考图超过模型上限，请先调整选择');
    const now = new Date().toISOString(); const run: FontCreationRun = { id: randomUUID(), requestId, status: 'queued', prompt: compiled.prompt, userPrompt: session.draft.userText, style: structuredClone(session.activeStyle), references: compiled.files, parameters, createdAt: now, updatedAt: now }; session.runs.push(run); session.updatedAt = now; return run;
  });
}
export async function updateFontRun(owner: string, sessionId: string, runId: string, changes: Partial<Pick<FontCreationRun, 'jobId' | 'status' | 'result' | 'error'>>) {
  return mutate(owner, sessionId, session => { const run = session.runs.find(r => r.id === runId); if (!run) throw new FontStoreError('任务不存在', 404); if (['completed','failed','cancelled'].includes(run.status) && changes.status && changes.status !== run.status) return run; Object.assign(run, changes); run.updatedAt = new Date().toISOString(); return run; });
}
// Keep the snapshot and shared image files so removal can be undone without
// changing the draft revision or breaking references and exported copies.
export async function setFontRunDeleted(owner: string, sessionId: string, runId: string, deleted: boolean) {
  return setFontRunsDeleted(owner, sessionId, [runId], deleted);
}
export async function setFontRunsDeleted(owner: string, sessionId: string, runIds: string[], deleted: boolean) {
  if (!Array.isArray(runIds) || !runIds.length || runIds.some(id => typeof id !== 'string' || !id.trim())) throw new FontStoreError('请选择要操作的作品');
  return mutate(owner, sessionId, session => {
    const byId = new Map(session.runs.map(run => [run.id, run]));
    const runs = [...new Set(runIds)].map(id => {
      const run = byId.get(id);
      if (!run) throw new FontStoreError('作品不存在', 404);
      if (['queued', 'running'].includes(run.status)) throw new FontStoreError('请先取消生成，再删除记录');
      return run;
    });
    // Validate the whole batch before changing anything, then persist once.
    const now = new Date().toISOString();
    for (const run of runs) {
      if (deleted && !run.deletedAt) { run.deletedAt = now; run.purgeAfter = new Date(Date.now() + 30 * 86400_000).toISOString(); }
      if (!deleted) { delete run.deletedAt; delete run.purgeAfter; }
    }
    return session;
  });
}
export async function exportFontResult(owner: string, id: string, runId: string, projectId: string) {
  if (!listProjects(owner).some(p => p.id === projectId)) throw new FontStoreError('目标项目不存在', 404);
  return mutate(owner, id, async session => { const run = session.runs.find(r => r.id === runId); if (!run?.result || run.status !== 'completed') throw new FontStoreError('作品尚未完成'); if (run.exports?.[projectId]) return { imageId: run.exports[projectId], duplicate: true };
    const extension = run.result.key.split('.').pop() || 'png'; const saved = saveBinaryFile(await fs.readFile(fontFilePath(run.result.key, owner)), `font-design.${extension}`, extension === 'jpg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png');
    const record = createImageRecord({ project_id: projectId, user_id: owner, prompt: run.prompt, image_url: saved.url, image_key: saved.key, model: run.parameters.model || '', size: run.parameters.size || '', status: 'completed', reference_images: JSON.stringify(run.references.map(r => r.url)) });
    await saveGenerationRecipe(owner, record.id, { schemaVersion: 1, prompt: run.prompt, userPrompt: run.userPrompt, referenceImages: run.references.map(r => r.url), referenceLabels: run.references.map(r => r.label), parameters: run.parameters, sourceFontCardId: run.style?.cardId, createdAt: run.createdAt });
    (run.exports ||= {})[projectId] = record.id; return { imageId: record.id, duplicate: false };
  });
}
