import fs from 'node:fs/promises';
import { sharedCaseSnapshot, commitSharedCases } from './case-library-store';
import type { ReferenceAsset } from './case-library-types';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import yauzl from 'yauzl';
import sharp from 'sharp';
import { z } from 'zod';
import { commitSharedPrompts, getLocalFileUrl, listPrompts, resolveLocalFilePath, type LocalPromptRecord } from './local-backend';
import { createLocalLibrary, deleteLocalLibrary, listLocalLibraries } from './prompt-library-store';
import { commitSharedFonts, fontFilePath, fontOwnerKey, sharedFontSnapshot, saveFontImage } from './font-library-store';
import { mediaReadPath, mediaWritePath } from './media-storage';
import { promptMetadata, promptTags } from './prompt-metadata';
import type { FontCard, FontFile } from './font-library-types';
import type { LibraryKind, TransferPreview, TransferResult, TransferScope } from './library-transfer-types';

const LIMIT = 256 * 1024 * 1024;
const FILE_LIMIT = 40 * 1024 * 1024;
export class TransferError extends Error { constructor(message: string, public status = 400) { super(message); } }
const text = z.string().max(30000);
const short = z.string().max(500);
const image = z.object({ asset: z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp|avif)$/).nullable(), label: short, missing: z.boolean() });
const webUrl = z.string().url().max(3000).refine(value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } });
const metadata = z.object({ subcategory: short.optional(), previewKind: z.enum(['example','reference','schematic']).optional(), language: short.optional(), author: short.optional(), url: webUrl.optional(), collection: short.optional(), collectionUrl: webUrl.optional(), note: text.optional(), referenceRequired: z.boolean().optional() });
const parameters = z.object({ model: short.optional(), size: short.optional(), imageSize: short.optional(), quality: short.optional(), background: short.optional(), outputFormat: short.optional(), moderation: short.optional() });
const caseInfo = z.object({
  folders: z.array(short).max(100), source: z.string().max(2000), fileName: short, favorite: z.boolean(), collection: short.optional(),
  analysis: z.object({ title: short, description: text, prompt: text, tags: z.array(short).max(100), category: short, sampleText: z.string().max(4000), ocr: text, confidence: z.number().min(0).max(1), model: short }).optional(),
});
const record = z.object({
  origin: z.string().regex(/^[a-f0-9]{64}$/), revision: z.string().regex(/^[a-f0-9]{64}$/), group: short.nullable(), title: short,
  text, tags: z.array(short).max(100), metadata, cover: image.nullable(), referencePreview: image.nullable(),
  references: z.array(image).max(1000), sampleText: short, style: short, description: text, originalPrompt: text, parameters, caseInfo: caseInfo.optional(),
});
const manifestSchema = z.object({ format: z.literal('huanzon-library'), version: z.literal(1), kind: z.enum(['prompts','fonts','cases']), name: z.string().trim().min(1).max(100), author: z.string().max(160), description: z.string().max(2000), createdAt: z.string().datetime(), groups: z.array(z.object({ id: short, name: z.string().min(1).max(80) })).max(2000), records: z.array(record).min(1).max(10000) });
type RecordData = z.infer<typeof record>;
type Manifest = z.infer<typeof manifestSchema>;
type Archive = { manifest: Manifest; assets: Map<string, Buffer> };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function localState(row: LocalPromptRecord | FontCard | ReferenceAsset) {
  if ('folderIds' in row) return hash(canonical({ title:row.title, text:row.prompt, tags:row.tags, note:row.note, source:row.source, fileName:row.fileName, favorite:row.favorite, collection:row.collection, analysis:row.analysis, image:row.url, missing:row.missing, attachments:row.attachments?.map(a=>({url:a.url,name:a.name})) }));
  if ('text' in row) return hash(canonical({ title: row.name || '', text: row.text, tags: promptTags(row.tags), metadata: promptMetadata(row.source), image: row.image_url || null }));
  return hash(canonical({ title: row.title, text: row.prompt, originalPrompt: row.originalPrompt, sampleText: row.sampleText, style: row.style || '', description: row.description || '', tags: row.tags || [], parameters: row.parameters, cover: row.cover, references: row.references }));
}
function contentHash(row: RecordData) { const { origin: _o, revision: _v, group: _g, ...content } = row; void _o; void _v; void _g; return hash(canonical(content)); }
function originOf(owner: string, kind: LibraryKind, row: LocalPromptRecord | FontCard | ReferenceAsset) { return row.shareOrigin || hash(`${owner}:${kind}:${row.id}`); }
function safeMeta(source?: string) {
  const original = promptMetadata(source), out: Record<string, unknown> = {};
  for (const key of Object.keys(metadata.shape)) { const value = original[key as keyof typeof original]; if (value !== undefined) out[key] = value; }
  // Only public web provenance is portable; paths and credentials never travel.
  for (const key of ['url','collectionUrl']) if (typeof out[key] === 'string') { try { const url = new URL(out[key]); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) delete out[key]; } catch { delete out[key]; } }
  return metadata.parse(out);
}
async function snapshot(owner: string, kind: LibraryKind, includeDeleted = false) {
  if (kind === 'cases') return sharedCaseSnapshot(owner);
  if (kind === 'fonts') return sharedFontSnapshot(owner);
  return { cards: listPrompts(owner, undefined, includeDeleted), groups: listLocalLibraries(owner).filter(g => !g.is_default).map(g => ({ id: String(g.id), name: g.name })) };
}
function groupsOf(row: LocalPromptRecord | FontCard | ReferenceAsset) { return 'folderIds' in row ? row.folderIds.length ? row.folderIds : ['none'] : [groupOf(row)]; }
function groupOf(row: LocalPromptRecord | FontCard | ReferenceAsset) { if ('folderIds' in row) return row.folderIds[0] || 'none'; return 'text' in row ? String(row.library_id ?? row.category.match(/^group:(\d+)$/)?.[1] ?? 'none') : row.groupId || 'none'; }
async function readImage(owner: string, url: string): Promise<Buffer> {
  if (url.startsWith('/api/font-file/')) return fs.readFile(fontFilePath(decodeURIComponent(url.split('/').pop()!.split('?')[0]), owner));
  if (url.startsWith('/api/local-file/')) return fs.readFile(resolveLocalFilePath(decodeURIComponent(url.slice('/api/local-file/'.length).split('?')[0])));
  if (url.startsWith('/prompt-previews/') && !url.includes('..')) return fs.readFile(path.join(process.cwd(), 'public', url));
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) throw new Error('图片地址不支持共享');
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!res.ok || Number(res.headers.get('content-length')) > FILE_LIMIT || !res.body) throw new Error('图片无法读取');
  const reader = res.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > FILE_LIMIT) throw new Error('单张图片超过40MB'); chunks.push(next.value); } } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
async function imageExtension(bytes: Buffer) {
  if (!bytes.length || bytes.length > FILE_LIMIT) throw new TransferError('图片为空或超过40MB');
  const meta = await sharp(bytes, { limitInputPixels: 80000000 }).metadata().catch(() => { throw new TransferError('图片损坏或格式不支持'); });
  const format = meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : meta.format;
  if (!['png','jpeg','webp','avif'].includes(format || '') || (meta.pages || 1) > 1) throw new TransferError('共享包支持静态 PNG、JPG、WebP、AVIF 图片');
  return format === 'jpeg' ? 'jpg' : format!;
}
export async function exportLibrary(owner: string, kind: LibraryKind, scope: TransferScope, info: { name: string; author: string; description: string }, allowMissing = false) {
  const source = await snapshot(owner, kind);
  const rows = source.cards.filter(row => scope.mode === 'all' || (scope.mode === 'selected' ? scope.ids?.includes(row.id) : groupsOf(row).includes((scope.groupId === 'ungrouped' ? 'none' : scope.groupId) || 'none')));
  if (!rows.length) throw new TransferError('没有可导出的条目');
  if (rows.length > 10000) throw new TransferError('每个共享包最多10000条，请分组导出');
  const assets = new Map<string, Buffer>(), missing: string[] = []; let total = 0;
  const cache = new Map<string, Promise<z.infer<typeof image>>>();
  const add = async (url: string | undefined, label: string): Promise<z.infer<typeof image>> => {
    if (!url) { missing.push(label); return { asset: null, label, missing: true }; }
    if (!cache.has(url)) cache.set(url, (async () => { try {
      const bytes = await readImage(owner, url), ext = await imageExtension(bytes), key = hash(bytes)+'.'+ext;
      if (!assets.has(key)) { total += bytes.length; if (total > LIMIT) throw new TransferError('资源包超过256MB，请按分组或选中条目分批导出'); assets.set(key, bytes); }
      return { asset: key, label, missing: false };
    } catch (e) { if (e instanceof TransferError && e.message.includes('256MB')) throw e; missing.push(label); return { asset: null, label, missing: true }; } })());
    return { ...await cache.get(url)!, label };
  };
  const records: RecordData[] = [];
  for (const row of rows) {
    const base = { origin: originOf(owner, kind, row), revision: row.shareRevision && row.shareStateHash === localState(row) ? row.shareRevision : localState(row), group: source.groups.some(g=>String(g.id)===groupOf(row)) ? groupOf(row) : null };
    if ('folderIds' in row) {
      const source = /^(?:\/|[A-Za-z]:[\\/]|file:)/.test(row.source) ? '' : row.source;
      records.push({ ...base, title:row.title, text:row.prompt, tags:row.tags, metadata:{},
        cover:await add(row.url,row.fileName || row.title), referencePreview:null,
        references:await Promise.all((row.attachments || []).map(ref=>add(ref.url,ref.name))),
        sampleText:'', style:'', description:row.note, originalPrompt:'', parameters:{},
        caseInfo:{ folders:row.folderIds, source, fileName:row.fileName, favorite:row.favorite, collection:row.collection, analysis:row.analysis },
      });
    } else if ('text' in row) {
      const meta = promptMetadata(row.source);
      records.push({ ...base, title: row.name || '', text: row.text, tags: promptTags(row.tags), metadata: safeMeta(row.source), cover: row.image_url ? await add(row.image_url, `${row.name || '提示词'} · 效果图`) : null, referencePreview: meta.referencePreviewUrl ? await add(meta.referencePreviewUrl, `${row.name || '提示词'} · 相关参考图`) : null, references: [], sampleText: '', style: '', description: '', originalPrompt: '', parameters: {} });
    } else {
      records.push({ ...base, title: row.title, text: row.prompt, tags: row.tags || [], metadata: {}, cover: await add(row.cover.url, row.cover.label), referencePreview: null, references: await Promise.all(row.references.map(ref => { if (ref.missing || !ref.url) { missing.push(`${row.title} · ${ref.label}`); return { asset: null, label: ref.label, missing: true }; } return add(ref.url, ref.label); })), sampleText: row.sampleText, style: row.style || '', description: row.description || '', originalPrompt: row.originalPrompt, parameters: parameters.parse(row.parameters) });
    }
  }
  if (missing.length && !allowMissing) throw new TransferError(`有 ${missing.length} 张图片缺失或无法打包：${missing.slice(0,4).join('、')}。可勾选“允许缺失图片”后继续，缺失位置会保留标记。`, 422);
  const manifest = manifestSchema.parse({ format: 'huanzon-library', version: 1, kind, ...info, createdAt: new Date().toISOString(), groups: source.groups.filter(g => records.some(r => r.group === String(g.id) || r.caseInfo?.folders.includes(String(g.id)))), records });
  const manifestText = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(manifestText)>12*1024*1024 || total+Buffer.byteLength(manifestText)>264*1024*1024-1024*1024) throw new TransferError('资源包内容过多，请按分组或选中条目分批导出');
  const zip = new JSZip(); zip.file('manifest.json', manifestText); for (const [name, bytes] of assets) zip.file('assets/'+name, bytes);
  return { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), missing: missing.length, count: rows.length };
}
// Read sequentially with declared AND actual size limits. No archive path is ever extracted.
async function unzip(bytes: Buffer) {
  if (!bytes.length || bytes.length > LIMIT + 8*1024*1024) throw new TransferError('请选择小于264MB的 .hzlib 共享包');
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new TransferError('共享包无法读取，请检查文件是否完整'));
      let size = 0, count = 0; const files = new Map<string, Buffer>();
      const fail = (e: unknown) => { zip.close(); reject(e instanceof TransferError ? e : new TransferError('共享包损坏')); };
      zip.on('error', fail); zip.on('end', () => resolve(files));
      zip.on('entry', entry => {
        if (++count > 20002) return fail(new TransferError('共享包文件过多'));
        if (entry.fileName.endsWith('/') && ['assets/'].includes(entry.fileName)) { zip.readEntry(); return; }
        if (files.has(entry.fileName) || !/^(manifest\.json|assets\/[a-f0-9]{64}\.(png|jpg|webp|avif))$/.test(entry.fileName) || entry.uncompressedSize > (entry.fileName === 'manifest.json' ? 12*1024*1024 : FILE_LIMIT) || size + entry.uncompressedSize > LIMIT + 12*1024*1024) return fail(new TransferError('共享包路径、大小或内容不符合规范'));
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err); const chunks: Buffer[] = []; let actual = 0;
          stream.on('data', chunk => { actual += chunk.length; size += chunk.length; if (actual > entry.uncompressedSize || size > LIMIT + 12*1024*1024) { stream.destroy(); fail(new TransferError('共享包解压大小超过限制')); } else chunks.push(chunk); });
          stream.on('error', fail); stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      }); zip.readEntry();
    });
  });
}
export async function readLibrary(bytes: Buffer, kind: LibraryKind): Promise<Archive> {
  const files = await unzip(bytes); let raw: unknown;
  try { raw = JSON.parse(files.get('manifest.json')?.toString('utf8') || ''); } catch { throw new TransferError('共享包缺少有效的清单'); }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new TransferError('共享包格式不支持或内容损坏，请使用当前版本重新导出');
  const manifest = parsed.data; if (manifest.kind !== kind) throw new TransferError(`这是${manifest.kind === 'fonts' ? '字体库' : manifest.kind === 'cases' ? '案例中心' : '提示词库'}共享包，请前往对应的库导入`);
  if (new Set(manifest.groups.map(g => g.id)).size !== manifest.groups.length) throw new TransferError('共享包分组编号重复');
  const assets = new Map<string, Buffer>();
  for (const [name, data] of files) if (name.startsWith('assets/')) { const key = name.slice(7); if (hash(data) !== key.split('.')[0] || await imageExtension(data) !== key.split('.')[1]) throw new TransferError('图片校验失败，共享包可能已损坏'); assets.set(key, data); }
  for (const row of manifest.records) {
    if (row.group && !manifest.groups.some(g => g.id === row.group)) throw new TransferError('共享包分组引用不完整');
    for (const ref of [row.cover,row.referencePreview,...row.references]) if (ref && ((ref.asset && !assets.has(ref.asset)) || (!ref.asset && !ref.missing))) throw new TransferError('共享包图片引用不完整');
    if (row.caseInfo?.folders.some(id=>!manifest.groups.some(g=>g.id===id))) throw new TransferError('共享包分类引用不完整');
    if (kind === 'cases' && (!row.cover || !row.caseInfo)) throw new TransferError('案例缺少原图或资料记录');
    if (kind !== 'cases' && (row.references.length > 16 || row.caseInfo)) throw new TransferError('共享包资料与库类型不匹配');
    if (kind === 'fonts' && !row.cover) throw new TransferError('字体案例缺少成品图记录');
  }
  return { manifest, assets };
}
async function plan(owner: string, archive: Archive) {
  const { manifest } = archive, current = await snapshot(owner, manifest.kind, true);
  const seen = new Set<string>(), digests = new Set<string>(), revisions = new Map<string, Set<string>>(), titles = new Set<string>();
  for (const c of current.cards) {
    const state = localState(c), origin = originOf(owner, manifest.kind, c);
    if (c.shareContentHash && c.shareStateHash === state) digests.add(c.shareContentHash);
    if (!revisions.has(origin)) revisions.set(origin, new Set());
    revisions.get(origin)!.add(state);
    if (c.shareRevision && c.shareStateHash === state) revisions.get(origin)!.add(c.shareRevision);
    const title = 'text' in c ? c.name : c.title; if (title) titles.add(title);
  }
  const items = manifest.records.map(row => {
    const digest = contentHash(row);
    const duplicate = seen.has(digest) || digests.has(digest) || revisions.get(row.origin)?.has(row.revision);
    seen.add(digest);
    return { row, status: duplicate ? 'duplicate' as const : revisions.has(row.origin) || titles.has(row.title) ? 'conflict' as const : 'new' as const };
  });
  return { items, current };
}
export async function previewLibrary(owner: string, archive: Archive): Promise<TransferPreview> {
  const { manifest, assets } = archive, { items, current } = await plan(owner, archive);
  return { kind: manifest.kind, name: manifest.name, author: manifest.author, description: manifest.description, createdAt: manifest.createdAt, total: items.length, images: assets.size, missing: manifest.records.reduce((n,r) => n+[r.cover,r.referencePreview,...r.references].filter(f=>f?.missing).length,0), bytes: [...assets.values()].reduce((n,b) => n+b.length,0), duplicates: items.filter(i => i.status === 'duplicate').length, conflicts: items.filter(i => i.status === 'conflict').length, items: items.map(i => ({ title: i.row.title || i.row.text.slice(0,40), status: i.status })), groups: current.groups.map(g => ({ id: String(g.id), name: g.name })) };
}
const globals = globalThis as typeof globalThis & { libraryImportQueues?: Map<string, Promise<void>> };
export async function importLibrary(owner: string, archive: Archive, destination: { mode: 'new' | 'existing' | 'preserve'; name?: string; id?: string }): Promise<TransferResult> {
  const queues = globals.libraryImportQueues ||= new Map(), key = owner+':'+archive.manifest.kind, before = queues.get(key) || Promise.resolve(); let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }); const queued = before.then(() => hold); queues.set(key, queued); await before;
  try { return await commit(owner, archive, destination); } finally { release(); if (queues.get(key) === queued) queues.delete(key); }
}
async function commit(owner: string, archive: Archive, destination: { mode: 'new' | 'existing' | 'preserve'; name?: string; id?: string }): Promise<TransferResult> {
  const { manifest, assets } = archive, { items, current } = await plan(owner, archive), selected = items.filter(i => i.status !== 'duplicate');
  if (!['new','existing','preserve'].includes(destination.mode)) throw new TransferError('请选择导入位置');
  let name = (destination.name || manifest.name).trim().slice(0,50), groupId: string | null = null;
  if (destination.mode === 'existing') { const existing = current.groups.find(g => String(g.id) === destination.id); if (!existing) throw new TransferError('目标分组已不存在，请重新选择'); name = existing.name; groupId = String(existing.id); }
  if (!selected.length) return { added: 0, skipped: items.length, conflicts: 0, groupId, groupName: name };
  const newGroups: { id: string; name: string }[] = [], promptGroups: number[] = [], newFiles: string[] = [];
  const groupMap = new Map<string, string>(); const usedNames = new Set(current.groups.map(g => g.name));
  const makeGroup = (requested: string) => { let title = requested.slice(0,42) || '导入资源', n=2; while (usedNames.has(title)) title = `${requested.slice(0,40)} (${n++})`; usedNames.add(title); let id: string;
    if (manifest.kind !== 'prompts') { id = randomUUID(); newGroups.push({ id, name: title }); } else { const group = createLocalLibrary(owner, { name: title }); id = String(group.id); promptGroups.push(group.id); }
    return { id, name: title };
  };
  try {
    // Materialize images before adding any library rows; font previews are regenerated locally.
    const materialized = new Map<string, FontFile | string>();
    for (const [asset, bytes] of assets) {
      if (!selected.some(i => [i.row.cover,i.row.referencePreview,...i.row.references].some(f => f?.asset === asset))) continue;
      if (manifest.kind === 'fonts') {
        const targetKey = `${fontOwnerKey(owner)}_${asset}`;
        const existed = await fs.access(mediaReadPath(targetKey, 'fonts')).then(() => true, () => false);
        const file = await saveFontImage(owner, bytes, '共享图片'); materialized.set(asset, file); if (!existed) newFiles.push(fontFilePath(file.key, owner), fontFilePath(file.key, owner)+'.128.webp', fontFilePath(file.key, owner)+'.512.webp');
      } else {
        const fileKey = 'shared_'+asset, file = mediaWritePath(fileKey), exists = await fs.access(file).then(() => true, () => false);
        if (!exists) { const temp = file+'.'+randomUUID()+'.tmp'; try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); newFiles.push(file); } finally { await fs.unlink(temp).catch(() => {}); } }
        materialized.set(asset, getLocalFileUrl(fileKey));
      }
    }
    if (destination.mode === 'new') { const g = makeGroup(name); groupId=g.id; name=g.name; }
    else if (destination.mode === 'preserve') { for (const group of manifest.groups.filter(g => selected.some(i => i.row.group === g.id || i.row.caseInfo?.folders.includes(g.id)))) groupMap.set(group.id, makeGroup(group.name).id); name='原分组结构'; }
    const now = new Date().toISOString(), prompts: LocalPromptRecord[] = [], fonts: FontCard[] = [], cases: ReferenceAsset[] = [];
    const fileOf = (ref: z.infer<typeof image>, role: FontFile['role']): FontFile => ({ ...(ref.asset ? materialized.get(ref.asset) as FontFile : { key:'',url:'' }), label: ref.label, role, missing: !ref.asset });
    for (const { row } of selected) {
      const target = destination.mode === 'preserve' ? groupMap.get(row.group || '') || null : groupId;
      if (manifest.kind === 'prompts') {
        const p: LocalPromptRecord = { id: randomUUID(), user_id: owner, project_id: null, name: row.title, text: row.text, content: row.text, tags: JSON.stringify(row.tags), source: JSON.stringify({ ...row.metadata, ...([row.cover,row.referencePreview].some(f=>f?.missing) ? {note:[row.metadata.note, '共享包中有图片缺失，请向分享者补充。'].filter(Boolean).join('；')} : {}), ...(row.referencePreview?.asset ? { referencePreviewUrl: materialized.get(row.referencePreview.asset) } : {}) }), category: target ? 'group:'+target : 'general', library_id: target ? Number(target) : null, image_url: row.cover?.asset ? materialized.get(row.cover.asset) as string : null, created_at: now, updated_at: now, shareOrigin: row.origin, shareRevision: row.revision, shareContentHash: contentHash(row) }; p.shareStateHash=localState(p); prompts.push(p);
      } else if (manifest.kind === 'cases') {
        const info=row.caseInfo!, asset=row.cover?.asset;
        const coverBytes=asset ? assets.get(asset)! : null;
        const meta=coverBytes ? await sharp(coverBytes).metadata() : null;
        const swap=[5,6,7,8].includes(meta?.orientation || 0);
        const c:ReferenceAsset={ id:randomUUID(), title:row.title || '未命名案例', prompt:row.text, note:row.description, tags:row.tags,
          source:info.source, favorite:info.favorite, fileName:info.fileName, collection:info.collection, analysis:info.analysis,
          folderIds:destination.mode==='preserve'?info.folders.map(id=>groupMap.get(id)!).filter(Boolean):target?[target]:[],
          url:asset?materialized.get(asset) as string:'', key:asset?'shared_'+asset:'', hash:asset?asset.split('.')[0]:'',
          width:(swap?meta?.height:meta?.width)||0, height:(swap?meta?.width:meta?.height)||0, bytes:coverBytes?.length||0, missing:!asset,
          attachments:row.references.map(ref=>({key:ref.asset?'shared_'+ref.asset:'',url:ref.asset?materialized.get(ref.asset) as string:'',name:ref.label,importItemId:randomUUID()})),
          createdAt:now, updatedAt:now, shareOrigin:row.origin, shareRevision:row.revision, shareContentHash:contentHash(row),
        };c.shareStateHash=localState(c);cases.push(c);
      } else {
        const c: FontCard = { id: randomUUID(), ownerId: owner, version: 1, title: row.title || '未命名字体', sampleText: row.sampleText, groupId: target, favorite: false, style: row.style, tags: row.tags, description: row.description, prompt: row.text, originalPrompt: row.originalPrompt, parameters: row.parameters, cover: fileOf(row.cover!, 'sample'), references: row.references.map(r => fileOf(r,'reference')), source: { type:'upload' }, warnings: [row.cover,...row.references].filter(r => r?.missing).map(r => `共享包缺少图片：${r!.label}`), createdAt: now, updatedAt: now, shareOrigin: row.origin, shareRevision: row.revision, shareContentHash: contentHash(row) }; c.shareStateHash=localState(c); fonts.push(c);
      }
    }
    if (manifest.kind === 'cases') await commitSharedCases(owner,newGroups,cases); else if (manifest.kind === 'fonts') await commitSharedFonts(owner, newGroups, fonts); else commitSharedPrompts(owner, prompts);
    return { added: selected.length, skipped: items.length-selected.length, conflicts: selected.filter(i => i.status==='conflict').length, groupId, groupName: name };
  } catch (error) {
    for (const id of promptGroups) deleteLocalLibrary(owner, id);
    await Promise.all(newFiles.map(file => fs.unlink(file).catch(() => {})));
    throw error;
  }
}
