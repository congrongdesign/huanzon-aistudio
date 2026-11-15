import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getBaseDataDir } from './runtime-config';
import { mediaReadPath, mediaWritePath } from './media-storage';
import { fontFilePath } from './font-library-store';
import type { GenerationCase } from './generation-tools';
import type { CaseFolder, ReferenceAsset, CaseLibraryResult } from './case-library-types';

type Index = { schemaVersion: 1; folders: CaseFolder[]; items: ReferenceAsset[]; migrations: string[] };
export class CaseLibraryError extends Error { constructor(message: string, public status = 400) { super(message); } }
const clean = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const strings = (v: unknown, max = 40) => Array.isArray(v) ? [...new Set(v.map(x => clean(x, 80)).filter(Boolean))].slice(0, max) : [];
export const caseLibraryDirectory = (owner: string) => path.join(getBaseDataDir(), 'local-data', 'case-library', createHash('sha256').update(owner).digest('hex').slice(0, 24));
async function read(owner: string): Promise<Index> {
  try { const data = JSON.parse(await fs.readFile(path.join(caseLibraryDirectory(owner), 'index.json'), 'utf8')); if (data.schemaVersion !== 1 || !Array.isArray(data.items) || !Array.isArray(data.folders) || !Array.isArray(data.migrations)) throw new Error('schema'); return data; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, folders: [], items: [], migrations: [] }; throw new CaseLibraryError('参考图库索引无法读取，请保留文件并检查备份', 500); }
}
async function atomic(file: string, data: string | Buffer) { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = file + '.' + randomUUID() + '.tmp'; try { await fs.writeFile(tmp, data); await fs.rename(tmp, file); } finally { await fs.unlink(tmp).catch(() => {}); } }
async function change<T>(owner: string, fn: (index: Index) => T): Promise<T> {
  const dir = caseLibraryDirectory(owner); await fs.mkdir(dir, { recursive: true }); const lock = path.join(dir, '.lock');
  for (let i = 0; ; i++) { try { await fs.mkdir(lock); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; const info = await fs.stat(lock).catch(() => null); if (info && Date.now() - info.mtimeMs > 60000) { await fs.rm(lock, { recursive: true, force: true }); continue; } if (i > 300) throw new CaseLibraryError('图库正在保存，请稍后重试', 503); await new Promise(r => setTimeout(r, 20)); } }
  try { const index = await read(owner); const result = fn(index); await atomic(path.join(dir, 'index.json'), JSON.stringify(index)); return result; } finally { await fs.rmdir(lock).catch(() => {}); }
}
export async function listCaseLibrary(owner: string, q: URLSearchParams): Promise<CaseLibraryResult> {
  const index = await read(owner); const live = index.items.filter(i => !i.deletedAt); const filter = q.get('filter') || 'all'; let items = filter === 'trash' ? index.items.filter(i => i.deletedAt) : live;
  if (filter === 'favorites') items = items.filter(i => i.favorite);
  if (filter === 'unfiled') items = items.filter(i => !i.folderIds.length);
  if (filter === 'recent') items = items.filter(i => i.lastUsedAt);
  const folder = q.get('folder'); if (folder) items = items.filter(i => i.folderIds.includes(folder));
  const words = (q.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean); if (words.length) items = items.filter(i => { const text = [i.title, i.note, i.source, i.fileName, i.prompt, i.collection, ...i.tags].join(' ').toLowerCase(); return words.every(w => text.includes(w)); });
  const tag = q.get('tag'); if (tag) items = items.filter(i => i.tags.includes(tag));
  const ratio = q.get('ratio'); if (ratio) items = items.filter(i => ratio === 'wide' ? i.width / i.height > 1.05 : ratio === 'tall' ? i.width / i.height < .95 : Math.abs(i.width / i.height - 1) <= .05);
  const sort = q.get('sort'); items = [...items].sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) : (filter === 'recent' ? b.lastUsedAt || '' : sort === 'oldest' ? a.createdAt : b.createdAt).localeCompare(filter === 'recent' ? a.lastUsedAt || '' : sort === 'oldest' ? b.createdAt : a.createdAt));
  const page = Math.max(1, Math.floor(Number(q.get('page')) || 1)); const pageSize = 48;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), folders: index.folders, total: items.length, page, pageSize, counts: { all: live.length, favorites: live.filter(i => i.favorite).length, unfiled: live.filter(i => !i.folderIds.length).length, recent: live.filter(i => i.lastUsedAt).length, trash: index.items.length - live.length }, folderCounts: Object.fromEntries(index.folders.map(f => [f.id, live.filter(i => i.folderIds.includes(f.id)).length])), tags: [...new Set(live.flatMap(i => i.tags))].sort((a,b)=>a.localeCompare(b,'zh-CN')) };
}
export async function uploadCaseImage(owner: string, file: File, folders: string[] = [], extra: Partial<ReferenceAsset> = {}) {
  if (!file.size || file.size > 40 * 1024 * 1024) throw new CaseLibraryError('单张图片需在 40MB 以内');
  const bytes = Buffer.from(await file.arrayBuffer()); let meta;
  try { meta = await sharp(bytes, { limitInputPixels: 80000000 }).metadata(); } catch { throw new CaseLibraryError('图片无法读取，请使用 JPG、PNG、WebP 或 AVIF'); }
  if (!['png','jpeg','webp','avif'].includes(meta.format || '') || (meta.pages || 1) > 1) throw new CaseLibraryError('请使用静态 JPG、PNG、WebP 或 AVIF 图片');
  const hash = createHash('sha256').update(bytes).digest('hex'); const ownerKey = createHash('sha256').update(owner).digest('hex').slice(0,24); const key = `case_${ownerKey}_${hash}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
  const filePath = mediaWritePath(key); try { await fs.access(filePath); } catch { await atomic(filePath, bytes); }
  const swap = [5,6,7,8].includes(meta.orientation || 0); const width = (swap ? meta.height : meta.width) || 1, height = (swap ? meta.width : meta.height) || 1;
  return change(owner, index => {
    const folderIds = folders.filter(id => index.folders.some(f => f.id === id)); const previous = index.items.find(i => i.hash === hash);
    if (previous) { previous.deletedAt = undefined; previous.folderIds = [...new Set([...previous.folderIds, ...folderIds])]; previous.updatedAt = new Date().toISOString(); return { item: previous, duplicate: true }; }
    const now = new Date().toISOString(); const item: ReferenceAsset = { id: randomUUID(), title: clean(extra.title || file.name.replace(/\.[^.]+$/, '')) || '未命名参考图', url: `/api/local-file/${key}`, key, width, height, fileName: file.name.slice(0,200), bytes: bytes.length, hash, folderIds, tags: strings(extra.tags), note: clean(extra.note,10000), source: clean(extra.source,2000), prompt: clean(extra.prompt,10000), favorite: false, createdAt: now, updatedAt: now, legacyId: extra.legacyId, collection: extra.collection };
    index.items.unshift(item); return { item, duplicate: false };
  });
}
export async function updateCaseAssets(owner: string, ids: unknown, patch: Record<string, unknown>) {
  const wanted = strings(ids, 1000); if (!wanted.length) throw new CaseLibraryError('请先选择参考图');
  return change(owner, index => {
    const selected = index.items.filter(i => wanted.includes(i.id)); if (selected.length !== wanted.length) throw new CaseLibraryError('部分参考图不存在，请刷新后重试',404);
    if (patch.folderIds !== undefined && strings(patch.folderIds).some(id => !index.folders.some(f => f.id === id))) throw new CaseLibraryError('分类不存在，请重新选择');
    for (const item of selected) {
      if (patch.action === 'delete') item.deletedAt = new Date().toISOString();
      else if (patch.action === 'restore') item.deletedAt = undefined;
      else if (patch.action === 'used') item.lastUsedAt = new Date().toISOString();
      else {
        if (patch.title !== undefined) { const title = clean(patch.title); if (!title) throw new CaseLibraryError('名称不能为空'); item.title = title; }
        for (const field of ['note','source','prompt'] as const) if (patch[field] !== undefined) item[field] = clean(patch[field],field === 'source' ? 2000 : 10000);
        if (patch.favorite !== undefined) item.favorite = patch.favorite === true;
        if (patch.tags !== undefined) item.tags = strings(patch.tags);
        if (patch.addTags !== undefined) item.tags = strings([...item.tags, ...strings(patch.addTags)]);
        if (patch.folderIds !== undefined) item.folderIds = strings(patch.folderIds);
        if (patch.addFolderId !== undefined) { const id = clean(patch.addFolderId); if (!index.folders.some(f=>f.id===id)) throw new CaseLibraryError('分类不存在'); item.folderIds = [...new Set([...item.folderIds,id])]; }
      }
      item.updatedAt = new Date().toISOString();
    }
    return selected;
  });
}
export async function changeCaseFolder(owner: string, action: string, id: unknown, name: unknown) {
  return change(owner, index => {
    const title = clean(name,80);
    if (action === 'create-folder') { if (!title) throw new CaseLibraryError('请输入分类名称'); if (index.folders.some(f=>f.name===title)) throw new CaseLibraryError('这个分类已存在'); index.folders.push({id:randomUUID(),name:title}); }
    else { const folder = index.folders.find(f => f.id === id); if (!folder) throw new CaseLibraryError('分类不存在',404); if (action === 'delete-folder') { index.folders = index.folders.filter(f=>f.id!==id); for (const item of index.items) item.folderIds = item.folderIds.filter(f=>f!==id); } else if (action === 'rename-folder') { if (!title) throw new CaseLibraryError('请输入分类名称'); if (index.folders.some(f=>f.id!==id&&f.name===title)) throw new CaseLibraryError('这个分类已存在'); folder.name=title; } else throw new CaseLibraryError('未知分类操作'); }
    return index.folders;
  });
}
async function legacyBytes(owner: string, url: string): Promise<Buffer> {
  if (url.startsWith('data:image/')) { if (url.length > 56 * 1024 * 1024) throw new CaseLibraryError('旧图超过大小限制'); return Buffer.from(url.split(',')[1] || '', 'base64'); }
  const parsed = new URL(url, 'http://localhost');
  if (['localhost','127.0.0.1'].includes(parsed.hostname)) {
    const key = decodeURIComponent(parsed.pathname.split('/').pop() || ''); if (!key || key !== path.basename(key)) throw new CaseLibraryError('旧图地址无效');
    if (parsed.pathname.startsWith('/api/local-file/')) return fs.readFile(mediaReadPath(key));
    if (parsed.pathname.startsWith('/api/font-file/')) return fs.readFile(fontFilePath(key,owner));
    throw new CaseLibraryError('旧图地址无法识别');
  }
  if (!['http:','https:'].includes(parsed.protocol)) throw new CaseLibraryError('旧图地址不支持');
  const response = await fetch(url,{signal:AbortSignal.timeout(20000)}); if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 40*1024*1024) throw new CaseLibraryError('旧图下载失败或过大');
  let size = 0; const parts: Buffer[]=[]; const reader=response.body.getReader(); try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>40*1024*1024)throw new CaseLibraryError('旧图超过大小限制'); parts.push(Buffer.from(value)); } } finally { await reader.cancel().catch(()=>{}); } return Buffer.concat(parts);
}
export async function migrateCase(owner: string, migrationId: string, legacy: GenerationCase) {
  if (!migrationId || !legacy || typeof legacy.title !== 'string') throw new CaseLibraryError('旧案例资料格式无效');
  if ((await read(owner)).migrations.includes(migrationId)) return { skipped:true, imported:0 };
  const pages = legacy.slides?.length ? legacy.slides : legacy.coverImage ? [{ imageUrl: legacy.coverImage, fileName:legacy.sourceFileName || legacy.title, title:legacy.title }] : [];
  const folder = clean(legacy.category,80);
  let folderId = '';
  if (folder && folder !== '未分类') folderId = await change(owner,index=> { let found=index.folders.find(f=>f.name===folder); if(!found) {found={id:randomUUID(),name:folder}; index.folders.push(found);}return found.id; });
  let imported=0;
  for (const page of pages.slice(0,100)) { const bytes=await legacyBytes(owner,page.imageUrl); await uploadCaseImage(owner,new File([new Uint8Array(bytes)],page.fileName || page.title || legacy.title),folderId?[folderId]:[],{title:pages.length>1?`${legacy.title} · ${page.title}`:legacy.title,tags:legacy.tags,note:legacy.description,prompt:legacy.prompt,legacyId:migrationId,collection:legacy.title}); imported++; }
  await change(owner,index=>{index.migrations.push(migrationId);}); return {imported,skipped:false};
}
export async function exportCaseIndex(owner: string) { return read(owner); }
