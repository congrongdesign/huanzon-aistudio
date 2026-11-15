import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { mediaReadPath, mediaWritePath } from './media-storage';
import { getLocalDataDirectory, getImageRecordById, listReferenceImages, listImageRecords, listProjects, resolveLocalFilePath, findGenerationOperationForImage } from './local-backend';
import type { FontCard, FontFile, FontGroup, FontSummary, GenerationRecipe } from './font-library-types';
import { cleanFontStylePrompt } from './font-library-types';

type Index = { schemaVersion: 1; groups: FontGroup[]; cards: FontCard[] };
export class FontStoreError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const fontOwnerKey = (owner: string) => createHash('sha256').update(owner).digest('hex').slice(0, 24);
const root = () => path.join(getLocalDataDirectory(), 'font-library');
const ownerDir = (owner: string) => path.join(root(), fontOwnerKey(owner));
const indexPath = (owner: string) => path.join(ownerDir(owner), 'index.json');
const validKey = /^[a-f0-9]{24}_[a-f0-9]{64}\.(png|jpg|webp)$/;
export function fontFilePath(key: string, owner?: string) {
  if (!validKey.test(key) || (owner && !key.startsWith(fontOwnerKey(owner) + '_'))) throw new FontStoreError('图片不存在', 404);
  return mediaReadPath(key, 'fonts');
}
async function atomic(file: string, data: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await fs.writeFile(temp, data); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => {}); }
}
async function read(owner: string): Promise<Index> {
  try { const value: Index = JSON.parse(await fs.readFile(indexPath(owner), 'utf8')); if (value.schemaVersion !== 1 || !Array.isArray(value.cards)) throw new Error('version');
    for (const card of value.cards) { card.prompt = cleanFontStylePrompt(card.prompt); if (card.analysis?.previous) card.analysis.previous.prompt = cleanFontStylePrompt(card.analysis.previous.prompt); }
    return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, groups: [], cards: [] }; throw new FontStoreError('字体库索引无法读取，请保留文件并检查备份', 500); }
}
async function change<T>(owner: string, mutate: (index: Index) => T): Promise<T> {
  const dir = ownerDir(owner); await fs.mkdir(dir, { recursive: true }); const lock = path.join(dir, '.lock');
  for (let n = 0; ; n++) {
    try { await fs.mkdir(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // A lock left behind by a crashed local server is safe to remove after a minute.
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 60000) { await fs.rm(lock, { recursive: true, force: true }); continue; }
      if (n > 200) throw new FontStoreError('字体库正在保存，请稍后重试', 503);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try { const index = await read(owner); const result = mutate(index); await atomic(indexPath(owner), JSON.stringify(index)); return result; }
  finally { await fs.rmdir(lock).catch(() => {}); }
}
const clean = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const summary = (c: FontCard): FontSummary => ({ id: c.id, version: c.version, title: c.title, sampleText: c.sampleText, groupId: c.groupId, favorite: c.favorite, style: c.style, tags: c.tags, description: c.description, analysisStatus: c.analysis?.status, analysisError: c.analysis?.error, cover: c.cover, createdAt: c.createdAt, updatedAt: c.updatedAt, lastUsedAt: c.lastUsedAt, referenceCount: c.references.length, warningCount: c.warnings.length });
export async function listFonts(owner: string, query: URLSearchParams) {
  const index = await read(owner); const all = index.cards.filter(c => !c.deletedAt);
  let cards = all; const q = (query.get('q') || '').toLocaleLowerCase(); const group = query.get('group'); const filter = query.get('filter');
  if (q) cards = cards.filter(c => [c.title, c.sampleText, c.prompt, c.style, c.description, ...(c.tags || [])].join(' ').toLocaleLowerCase().includes(q));
  if (group) cards = cards.filter(c => (c.groupId || 'ungrouped') === group);
  if (filter === 'favorites') cards = cards.filter(c => c.favorite);
  if (filter === 'recent') cards = cards.filter(c => c.lastUsedAt);
  cards.sort((a, b) => (filter === 'recent' ? b.lastUsedAt || '' : b.createdAt).localeCompare(filter === 'recent' ? a.lastUsedAt || '' : a.createdAt));
  const page = Math.max(1, Number(query.get('page')) || 1); const pageSize = 24;
  return { cards: cards.slice((page - 1) * pageSize, page * pageSize).map(summary), total: cards.length, page, pageSize, groups: index.groups, counts: { all: all.length, favorites: all.filter(c => c.favorite).length }, groupCounts: Object.fromEntries(index.groups.map(g => [g.id, all.filter(c => c.groupId === g.id).length])) };
}
export async function getFont(owner: string, id: string) { const card = (await read(owner)).cards.find(c => c.id === id && !c.deletedAt); if (!card) throw new FontStoreError('字体卡片不存在', 404); return card; }
// Two decoders shared by all uploads and historical imports in the server process.
const pool = globalThis as typeof globalThis & { __fontPool?: { active: number; waiters: (() => void)[] } };
async function imageTask<T>(fn: () => Promise<T>) {
  const state = pool.__fontPool ||= { active: 0, waiters: [] };
  if (state.active >= 2) await new Promise<void>(resolve => state.waiters.push(resolve));
  else state.active++;
  try { return await fn(); } finally { const next = state.waiters.shift(); if (next) next(); else state.active--; }
}
export async function saveFontImage(owner: string, bytes: Buffer, label: string, role: FontFile['role'] = 'sample'): Promise<FontFile> {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new FontStoreError('单张图片应小于 25MB');
  return imageTask(async () => {
    const decoder = sharp(bytes, { limitInputPixels: 80000000 });
    const meta = await decoder.metadata().catch(() => { throw new FontStoreError('图片无法解码，请使用 JPG、PNG 或 WebP'); });
    if (!['png', 'jpeg', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1) throw new FontStoreError('请上传静态 JPG、PNG 或 WebP 图片');
    const ext = meta.format === 'jpeg' ? 'jpg' : meta.format!; const hash = createHash('sha256').update(bytes).digest('hex'); const key = `${fontOwnerKey(owner)}_${hash}.${ext}`;
    const original = mediaWritePath(key, 'fonts');
    await atomic(original, bytes);
    for (const width of [128, 512]) {
      const target = original + `.${width}.webp`;
      try { await fs.access(target); } catch { await atomic(target, await sharp(bytes, { limitInputPixels: 80000000 }).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer()); }
    }
    return { key, url: `/api/font-file/${key}`, width: meta.width, height: meta.height, label, role };
  });
}
export async function copyFontImage(owner: string, url: string, label: string, role: FontFile['role']): Promise<FontFile> {
  const parsed = new URL(url, 'http://localhost'); let bytes: Buffer;
  if (parsed.pathname.startsWith('/api/local-file/') && ['localhost', '127.0.0.1'].includes(parsed.hostname)) bytes = await fs.readFile(resolveLocalFilePath(decodeURIComponent(parsed.pathname.split('/').pop()!)));
  else if (parsed.pathname.startsWith('/api/font-file/') && ['localhost', '127.0.0.1'].includes(parsed.hostname)) bytes = await fs.readFile(fontFilePath(decodeURIComponent(parsed.pathname.split('/').pop()!), owner));
  else if (url.startsWith('data:image/')) bytes = Buffer.from(url.split(',')[1] || '', 'base64');
  else {
    if (!['https:', 'http:'].includes(parsed.protocol) || ['localhost', '127.0.0.1', '::1', '169.254.169.254'].includes(parsed.hostname)) throw new FontStoreError('不支持的图片来源');
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 25 * 1024 * 1024 || !response.body) throw new FontStoreError('原图读取失败或过大');
    const chunks: Buffer[] = []; let size = 0; const reader = response.body.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 25 * 1024 * 1024) throw new FontStoreError('图片超过 25MB'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); }
    bytes = Buffer.concat(chunks);
  }
  return saveFontImage(owner, bytes, label, role);
}
function newCard(owner: string, title: string, cover: FontFile): FontCard {
  const now = new Date().toISOString(); return { id: randomUUID(), ownerId: owner, version: 1, title: clean(title) || '未命名字体', sampleText: '', groupId: null, favorite: false, cover, references: [], prompt: '', originalPrompt: '', parameters: {}, source: { type: 'upload' }, warnings: [], createdAt: now, updatedAt: now };
}
export async function uploadFont(owner: string, file: File, groupId?: string) {
  const cover = await saveFontImage(owner, Buffer.from(await file.arrayBuffer()), '字体成品'); const card = newCard(owner, file.name.replace(/\.[^.]+$/, ''), cover);
  return change(owner, index => { if (index.groups.some(g => g.id === groupId)) card.groupId = groupId!; index.cards.unshift(card); return card; });
}
export async function collectFont(owner: string, imageId: string, groupId?: string) {
  const duplicate = (await read(owner)).cards.find(c => !c.deletedAt && c.source.imageId === imageId); if (duplicate) return { card: duplicate, duplicate: true };
  if(imageId.startsWith('ref-')) {
    const ref=listReferenceImages(owner).find(r=>r.id===imageId.slice(4));
    if(!ref?.image_url)throw new FontStoreError('参考图已不存在',404);
    const cover=await copyFontImage(owner,ref.image_url,'字体成品','sample');
    const card=newCard(owner,ref.file_name?.replace(/\.[^.]+$/,'')||'字体参考图',cover);
    card.source={type:'upload',imageId,projectId:ref.project_id,createdAt:ref.created_at};
    card.warnings=['来自上传参考图，尚未记录生成提示词，可在卡片中补充'];
    return change(owner,index=>{const existing=index.cards.find(c=>!c.deletedAt&&c.source.imageId===imageId);if(existing)return {card:existing,duplicate:true};if(index.groups.some(g=>g.id===groupId))card.groupId=groupId!;index.cards.unshift(card);return {card,duplicate:false};});
  }
  const image = getImageRecordById(imageId, owner); if (!image?.image_url || image.status !== 'completed') throw new FontStoreError('该作品尚未完成或已不存在', 404);
  const cover = await copyFontImage(owner, image.image_url, '字体成品', 'sample');
  const card = newCard(owner, image.prompt.replace(/^上传:\s*/, '').slice(0, 32) || '字体案例', cover);
  const recipe = await loadGenerationRecipe(owner, imageId);
  const operation = recipe ? null : findGenerationOperationForImage(owner, imageId);
  card.originalPrompt = recipe?.prompt || image.prompt; card.prompt = recipe?.userPrompt || image.prompt;
  card.parameters = recipe?.parameters || { model: image.model, size: image.size };
  if (!recipe && operation?.params) { for (const key of ['imageSize','quality','background','outputFormat','moderation'] as const) { const value = operation.params[key]; if (typeof value === 'string') card.parameters[key] = value; } }
  card.source = { type: 'history', imageId, projectId: image.project_id, projectName: listProjects(owner).find(p => p.id === image.project_id)?.name, createdAt: image.created_at, operationId: recipe?.operationId || operation?.id, fontCardId: recipe?.sourceFontCardId };
  let urls: string[] = recipe?.referenceImages || [];
  if (!recipe) { try { urls = JSON.parse(image.reference_images || '[]'); } catch { urls = []; } card.warnings.push('历史作品未记录完整参数，仅保留已知原始资料'); }
  for (let n = 0; n < urls.length; n++) {
    if (typeof urls[n] !== 'string') continue;
    const label = recipe?.referenceLabels?.[n] || `原参考图${n + 1}`;
    try { card.references.push(await copyFontImage(owner, urls[n], label, 'reference')); }
    catch { card.references.push({ key: '', url: '', label, role: 'reference', missing: true }); card.warnings.push(`原参考图${n + 1}无法读取，可在详情补图`); }
  }
  return change(owner, index => { const existing = index.cards.find(c => !c.deletedAt && c.source.imageId === imageId); if (existing) return { card: existing, duplicate: true }; if (index.groups.some(g => g.id === groupId)) card.groupId = groupId!; index.cards.unshift(card); return { card, duplicate: false }; });
}
export async function collectFontCreation(owner: string, sessionId: string, runId: string) {
  const { getFontSession } = await import('./font-creation-store');
  const session = await getFontSession(owner, sessionId); const run = session.runs.find(item => item.id === runId);
  if (run?.status !== 'completed' || !run.result) throw new FontStoreError('该字体作品尚未完成', 404);
  const sourceId = `font:${sessionId}:${runId}`;
  const card = newCard(owner, run.userPrompt.slice(0, 32) || '字体作品', structuredClone(run.result));
  card.prompt = run.prompt; card.originalPrompt = run.prompt; card.references = structuredClone(run.references); card.parameters = run.parameters;
  card.source = { type: 'history', imageId: sourceId, projectName: `字体创作 · ${session.title}`, createdAt: run.createdAt, fontCardId: run.style?.cardId };
  return change(owner, index => { const existing = index.cards.find(c => !c.deletedAt && c.source.imageId === sourceId); if (existing) return { card: existing, duplicate: true }; index.cards.unshift(card); return { card, duplicate: false }; });
}
export async function updateFont(owner: string, id: string, input: Record<string, unknown>) {
  return change(owner, index => {
    const card = index.cards.find(c => c.id === id); if (!card) throw new FontStoreError('卡片不存在', 404);
    if (input.version !== undefined && input.version !== card.version) throw new FontStoreError('卡片已更新，请重新打开后编辑', 409);
    if (input.action === 'undo-organize' && card.analysis?.previous) { Object.assign(card, card.analysis.previous); delete card.analysis; }
    if (input.style !== undefined) card.style = clean(input.style, 80);
    if (input.description !== undefined) card.description = clean(input.description, 2000);
    if (Array.isArray(input.tags)) card.tags = [...new Set(input.tags.map(t => clean(t, 30)).filter(Boolean))].slice(0, 10);
    if (input.title !== undefined) card.title = clean(input.title) || '未命名字体';
    if (input.sampleText !== undefined) card.sampleText = clean(input.sampleText, 500);
    if (input.prompt !== undefined) card.prompt = cleanFontStylePrompt(clean(input.prompt, 30000));
    if (input.groupId !== undefined) card.groupId = index.groups.some(g => g.id === input.groupId) ? String(input.groupId) : null;
    if (typeof input.favorite === 'boolean') card.favorite = input.favorite;
    if (input.action === 'delete' && !card.deletedAt) { card.deletedAt = new Date().toISOString(); card.purgeAfter = new Date(Date.now() + 30 * 86400_000).toISOString(); }
    if (input.action === 'restore') { card.deletedAt = null; card.purgeAfter = null; }
    if (input.action === 'used') card.lastUsedAt = new Date().toISOString();
    card.version++; card.updatedAt = new Date().toISOString(); return card;
  });
}
export async function attachFontReference(owner: string, id: string, file: File, position?: number) {
  await getFont(owner, id); const ref = await saveFontImage(owner, Buffer.from(await file.arrayBuffer()), file.name, 'reference');
  return change(owner, index => { const card = index.cards.find(c => c.id === id && !c.deletedAt); if (!card) throw new FontStoreError('卡片不存在', 404);
    if (position !== undefined && card.references[position]?.missing) card.references[position] = ref; else { if (card.references.length >= 16) throw new FontStoreError('参考图最多16张'); card.references.push(ref); }
    card.version++; card.updatedAt = new Date().toISOString(); return card;
  });
}
export async function changeFontGroup(owner: string, action: string, id: string, name: string) {
  return change(owner, index => {
    if (action === 'create') { const title = clean(name, 50); if (!title) throw new FontStoreError('请输入分组名称'); if (index.groups.some(g => g.name === title)) throw new FontStoreError('分组名称已存在'); index.groups.push({ id: randomUUID(), name: title }); }
    else { const group = index.groups.find(g => g.id === id); if (!group) throw new FontStoreError('分组不存在', 404); if (action === 'delete') { index.groups = index.groups.filter(g => g.id !== id); index.cards.forEach(c => { if (c.groupId === id) { c.groupId = null; c.version++; } }); } else { const title = clean(name, 50); if (!title) throw new FontStoreError('请输入名称'); group.name = title; } }
    return index.groups;
  });
}
export function fontHistory(owner: string, query: URLSearchParams) {
  const q = (query.get('q') || '').toLowerCase(); const days = Number(query.get('days')) || 0;
  const projects = listProjects(owner); const names = new Map(projects.map(p => [p.id, p.name]));
  const { records } = listImageRecords(owner, { projectId: query.get('project') || null, pageSize: 100000 });
  const filtered = records.filter(r => r.status === 'completed' && r.image_url && (!q || r.prompt.toLowerCase().includes(q)) && (!days || Date.now() - Date.parse(r.created_at) < days * 86400000));
  const page = Math.max(1, Number(query.get('page')) || 1);
  return { records: filtered.slice((page - 1) * 24, page * 24).map(r => ({ id: r.id, image_url: r.image_url, prompt: r.prompt.slice(0, 150), created_at: r.created_at, projectName: names.get(r.project_id || '') || '原项目' })), total: filtered.length, projects: projects.map(p => ({ id: p.id, name: p.name })) };
}
export async function saveGenerationRecipe(owner: string, imageId: string, recipe: GenerationRecipe) {
  if (!/^[\w-]+$/.test(imageId)) throw new FontStoreError('无效作品ID');
  await atomic(path.join(ownerDir(owner), 'recipes', imageId + '.json'), JSON.stringify(recipe));
}
async function loadGenerationRecipe(owner: string, imageId: string): Promise<GenerationRecipe | null> {
  if (!/^[\w-]+$/.test(imageId)) return null;
  try { return JSON.parse(await fs.readFile(path.join(ownerDir(owner), 'recipes', imageId + '.json'), 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new FontStoreError('原始配方损坏，请检查备份', 500); }
}

// Analysis is committed under the same index lock as manual edits and group changes.
export async function fontOrganizationCandidates(owner: string, id?: string, force = false) {
  return (await read(owner)).cards.filter(c => !c.deletedAt && (!id || c.id === id) && (force || c.analysis?.status !== 'completed')).map(c => c.id);
}
export async function setFontAnalysis(owner: string, id: string, analysis: NonNullable<FontCard['analysis']>) {
  return change(owner, index => { const card = index.cards.find(c => c.id === id && !c.deletedAt); if (!card) throw new FontStoreError('卡片不存在', 404); card.analysis = { ...card.analysis, ...analysis }; return structuredClone(card); });
}
export async function applyFontOrganization(owner: string, before: FontCard, info: { sampleText: string; style: string; category: string; tags: string[]; description: string; confidence: number }, model: string) {
  return change(owner, index => {
    const card = index.cards.find(c => c.id === before.id && !c.deletedAt);
    if (!card) throw new FontStoreError('卡片不存在', 404);
    if (card.version !== before.version) throw new FontStoreError('识别期间卡片已被编辑，请重新识别', 409);
    const previous = { title: card.title, sampleText: card.sampleText, groupId: card.groupId, prompt: card.prompt, style: card.style || '', tags: card.tags || [], description: card.description || '' };
    // Uncertain OCR must not replace an existing transcription with guessed text.
    if (info.sampleText && info.confidence >= 0.85) card.sampleText = info.sampleText;
    card.style = info.style; card.tags = info.tags; card.description = info.description;
    card.title = [card.sampleText.slice(0, 48), info.style].filter(Boolean).join(' · ') || info.category + '字体设计';
    if (!card.groupId) { let group = index.groups.find(g => g.name === info.category); if (!group) { group = { id: randomUUID(), name: info.category }; index.groups.push(group); } card.groupId = group.id; }
    if (!card.prompt.trim()) card.prompt = `参考成品图的字体设计风格：${info.description}。保持字形与笔画特征，根据本次要求替换文字。`;
    card.analysis = { status: 'completed', model, analyzedAt: new Date().toISOString(), confidence: info.confidence, previous };
    card.version++; card.updatedAt = new Date().toISOString(); return card;
  });
}
