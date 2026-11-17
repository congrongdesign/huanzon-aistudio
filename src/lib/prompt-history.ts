import { commitHistoryPrompt, getImageRecordById, listImageRecords, listProjects, listPrompts, saveBinaryFile } from './local-backend';
import { loadGenerationRecipe } from './font-library-store';
import { listLocalLibraries } from './prompt-library-store';
export class PromptHistoryError extends Error { constructor(message: string, public status = 400) { super(message); } }
async function retainRemotePreview(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new PromptHistoryError('效果图保存失败，请重试');
  const limit = 50 * 1024 * 1024;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new PromptHistoryError('效果图超过50MB，请先下载后导入');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!size) throw new PromptHistoryError('效果图为空，请重试');
  return saveBinaryFile(Buffer.concat(chunks), 'prompt-history.png', response.headers.get('content-type') || undefined).url;
}
function eligible(image: { status: string; image_url: string; prompt: string; deleted_at?: string | null }) {
  return image.status === 'completed' && !!image.image_url && !!image.prompt.trim() && !/^上传[:：]/.test(image.prompt.trim()) && !image.deleted_at;
}
export function listPromptHistory(owner: string, query: URLSearchParams) {
  const projects = listProjects(owner), names = new Map(projects.map(p => [p.id, p.name]));
  const collected = new Set(listPrompts(owner, undefined, true).map(p => p.history_image_id).filter(Boolean));
  const q = (query.get('q') || '').trim().toLowerCase(), days = Math.max(0, Number(query.get('days')) || 0);
  const { records } = listImageRecords(owner, { projectId: query.get('project') || null, pageSize: 100000 });
  const filtered = records.filter(r => eligible(r) && (!q || r.prompt.toLowerCase().includes(q) || (names.get(r.project_id || '') || '').toLowerCase().includes(q)) && (!days || Date.now() - Date.parse(r.created_at) < days * 86400000));
  const page = Math.max(1, Math.floor(Number(query.get('page')) || 1)), pageSize = 24;
  return { records: filtered.slice((page - 1) * pageSize, page * pageSize).map(r => ({ id: r.id, image_url: r.image_url, prompt: r.prompt.slice(0, 240), projectName: names.get(r.project_id || '') || '原项目', created_at: r.created_at, model: r.model, collected: collected.has(r.id) })), total: filtered.length, pageSize, projects: projects.map(p => ({ id: p.id, name: p.name })) };
}
export async function collectPromptHistory(owner: string, ids: unknown, groupId?: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id)) throw new PromptHistoryError('每次请选择1至100张作品');
  const group = groupId === undefined || groupId === null || groupId === '' ? undefined : listLocalLibraries(owner).find(g => g.id === groupId && g.is_default !== 1);
  if (groupId !== undefined && groupId !== null && groupId !== '' && !group) throw new PromptHistoryError('提示词分组不存在');
  const results: { id: string; promptId?: string; duplicate?: boolean; error?: string }[] = [];
  for (const id of [...new Set(ids)] as string[]) {
    try {
      const image = getImageRecordById(id, owner); if (!image || !eligible(image)) throw new PromptHistoryError('作品未完成、没有生成提示词或已删除', 404);
      const existing = listPrompts(owner, undefined, true).find(p => p.history_image_id === id);
      if (existing) { results.push({ id, promptId: existing.id, duplicate: true }); continue; }
      const recipe = await loadGenerationRecipe(owner, id);
      const text = recipe?.prompt?.trim() || image.prompt.trim();
      if (text.length > 30000) throw new PromptHistoryError('原提示词超过30000字符，请手动整理后保存');
      let imageUrl = image.image_url;
      if (/^https?:\/\//i.test(imageUrl) && !new URL(imageUrl).pathname.startsWith('/api/local-file/')) {
        imageUrl = await retainRemotePreview(imageUrl);
      }
      const projectName = listProjects(owner).find(p => p.id === image.project_id)?.name || '原项目';
      const referenceRequired = !!recipe?.referenceImages?.length || !!(image.reference_images && image.reference_images !== '[]');
      const result = commitHistoryPrompt(owner, id, { project_id: image.project_id, name: text.replace(/\s+/g, ' ').slice(0, 48), text, content: text, image_url: imageUrl, library_id: group?.id || null, category: group ? `group:${group.id}` : 'general', model: recipe?.parameters.model || image.model, aspect_ratio: recipe?.parameters.size || image.size, source: JSON.stringify({ previewKind: 'example', historyImageId: id, projectName, collectedAt: new Date().toISOString(), referenceRequired, note: `从历史作品收录 · ${projectName}。保留生成提示词与效果图${referenceRequired ? '；复用时请补充原参考图' : ''}。` }) });
      results.push({ id, promptId: result.prompt.id, duplicate: result.duplicate });
    } catch (error) { results.push({ id, error: error instanceof Error ? error.message : '收录失败，请重试' }); }
  }
  return { results, added: results.filter(r => !r.error && !r.duplicate).length, duplicates: results.filter(r => r.duplicate).length, failed: results.filter(r => r.error).length };
}
