import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import * as yauzl from 'yauzl';
import sharp from 'sharp';
import { S3Config, S3Storage } from 'coze-coding-dev-sdk';
import { collectProjectAssets, downloadAsset, loadProjectSnapshot, MissingLocalArchiveAsset, buildReplacementOptions } from './project-archive';
import { isLocalBackendEnabled, resolveLocalFilePath } from './local-backend';
import { mediaWritePath } from './media-storage';
import { fileFingerprint, managedCopies } from './storage-lifecycle';
import { assertArchiveRoot, makeArchiveEntry } from './project-archive-store';
import { normalizeBackupManifest } from './project-backup-format';
import { backupSnapshotHash } from './project-backup-snapshot';
import type { ProjectArchiveManifest, ProjectArchiveAssetReplacement } from './project-archive-types';

const CHUNK = 256 * 1024;
export async function hashBackupFile(file: string, progress?: (bytes: number) => void) {
  const hash = createHash('sha256'); let bytes = 0; let last = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: CHUNK })) {
    hash.update(chunk); bytes += chunk.length;
    if (progress && Date.now() - last > 750) { last = Date.now(); progress(bytes); }
  }
  return hash.digest('hex');
}
export async function verifiedLocalBackupCopies(assets: ProjectArchiveManifest['assets']) {
  const copies: { key: string; file: string; signature: string }[] = [];
  for (const asset of assets) {
    const key = asset.storageKey || asset.originalUrl.match(/\/api\/local-file\/([^?#]+)/)?.[1];
    if (!key) continue;
    for (const copy of managedCopies(decodeURIComponent(key))) {
      if (copy.bytes === asset.size && await hashBackupFile(copy.file) === asset.sha256 && fileFingerprint(fs.lstatSync(copy.file)) === copy.signature) copies.push({ key: decodeURIComponent(key), file: copy.file, signature: copy.signature });
    }
  }
  return copies;
}
async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value));
  await fsp.rename(temporary, file);
}
// Sequential lazy ZIP reads hold one resource at a time, rather than the whole ZIP.
export async function visitBackupZip(file: string, visit: (entry: yauzl.Entry, stream: Readable) => Promise<void>) {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('无法打开备份包'));
      const fail = (error: unknown) => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error || new Error('无法读取备份资源'));
          void visit(entry, stream).then(() => zip.readEntry(), fail);
        });
      });
      zip.readEntry();
    });
  });
}
async function collectSmall(stream: Readable, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('备份元数据过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function readStreamManifest(file: string) {
  const manifest = await new Promise<ProjectArchiveManifest>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('无法打开备份包'));
      let found = false;
      const fail = (error: unknown) => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', () => { if (!found) fail(new Error('项目包缺少 manifest.json')); });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'manifest.json') { zip.readEntry(); return; }
        found = true;
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error || new Error('无法读取元数据'));
          void collectSmall(stream, 64 * 1024 * 1024).then(bytes => {
            try { const parsed = JSON.parse(bytes.toString()); zip.close(); resolve(parsed); } catch (error) { fail(error); }
          }, fail);
        });
      });
      zip.readEntry();
    });
  });
  if (manifest?.version === 2) return normalizeBackupManifest(manifest, '', async () => { throw new Error('无效资源'); });
  const inspected = new Map<string, { size: number; sha256: string }>();
  await visitBackupZip(file, async (entry, stream) => {
    let size = 0; const hash = createHash('sha256');
    for await (const chunk of stream) { size += chunk.length; hash.update(chunk); }
    if (inspected.has(entry.fileName)) throw new Error('旧备份包含重复资源');
    inspected.set(entry.fileName, { size, sha256: hash.digest('hex') });
  });
  return normalizeBackupManifest(manifest, await hashBackupFile(file), async asset => {
    const info = inspected.get(asset.fileName);
    if (!info) throw new Error(`旧项目包缺少资源：${asset.fileName}`);
    return info;
  });
}
export async function verifyBackupFile(file: string, manifest: ProjectArchiveManifest, progress?: (stage: string) => void) {
  const expected = new Map(manifest.assets.map(asset => [asset.archivePath, asset]));
  const seen = new Set<string>();
  let last = 0;
  await visitBackupZip(file, async (entry, stream) => {
    const asset = expected.get(entry.fileName);
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of stream) {
      if (asset) { hash.update(chunk); size += chunk.length; }
      if (progress && Date.now() - last > 750) { last = Date.now(); progress(`${manifest.projectName} · 校验资源 ${seen.size + 1}/${expected.size}`); }
    }
    if (!asset) return;
    if (seen.has(entry.fileName) || size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error(`资源校验失败：${entry.fileName}`);
    seen.add(entry.fileName);
  });
  if (seen.size !== expected.size) throw new Error('备份包缺少资源');
}
async function thumbnail(manifest: ProjectArchiveManifest, paths: Map<string, string>) {
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  const images = manifest.data.imageRecords.filter(row => !row.deleted_at).slice(0, 4);
  for (let i = 0; i < images.length; i++) {
    const row = images[i]; const asset = manifest.assets.find(a => a.storageKey === row.image_key || a.originalUrl === row.image_url);
    const file = asset && paths.get(asset.id); if (!file) continue;
    try {
      const input = await sharp(file, { limitInputPixels: 80_000_000 }).rotate().resize(images.length === 1 ? 480 : 238, images.length <= 2 ? 300 : 148, { fit: 'cover' }).webp({ quality: 65 }).toBuffer();
      tiles.push({ input, left: images.length === 1 ? 0 : i % 2 * 242, top: images.length <= 2 ? 0 : Math.floor(i / 2) * 152 });
    } catch { /* Optional cover. */ }
  }
  if (!tiles.length) return '';
  return `data:image/webp;base64,${(await sharp({ create: { width: 480, height: 300, channels: 3, background: '#ececec' } }).composite(tiles).webp({ quality: 65 }).toBuffer()).toString('base64')}`;
}
export async function streamProjectBackup(input: { projectId: string; userId: string; root: string; baseUrl: string }, progress: (stage: string) => void) {
  const temp = process.env.HZ_BACKUP_WORK_DIR || await fsp.mkdtemp(path.join(os.tmpdir(), 'hz-backup-worker-'));
  await fsp.mkdir(temp, { recursive: true });
  let remotePart = '';
  try {
    const snapshot = await loadProjectSnapshot(input.projectId, input.userId);
    const manifest: ProjectArchiveManifest = { format: 'huanzon-aistudio-project', version: 2, mode: 'archive', archiveId: `archive_${randomUUID()}`, originalProjectId: input.projectId, projectName: String(snapshot.project.name), exportedAt: new Date().toISOString(), appVersion: '0.2.2', data: snapshot, assets: [], missingHistoryAssets: [] };
    const sources = collectProjectAssets(snapshot); const paths = new Map<string, string>();
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]; progress(`${manifest.projectName} · 准备资源 ${i + 1}/${sources.length}`);
      let sourcePath = source.storageKey && isLocalBackendEnabled() ? resolveLocalFilePath(source.storageKey) : '';
      if (!sourcePath && source.originalUrl.startsWith('/api/local-file/')) sourcePath = resolveLocalFilePath(decodeURIComponent(source.originalUrl.split('/').pop()!.split('?')[0]));
      const local = path.join(temp, `resource-${i}`);
      try {
        if (sourcePath) {
          if (!fs.existsSync(sourcePath)) throw new MissingLocalArchiveAsset(`项目图片不存在：${path.basename(sourcePath)}`);
          await pipeline(fs.createReadStream(sourcePath, { highWaterMark: CHUNK }), fs.createWriteStream(local, { highWaterMark: CHUNK }));
        } else {
          const downloaded = await downloadAsset(source, input.baseUrl);
          await fsp.writeFile(local, downloaded.buffer);
        }
      } catch (error) {
        if (!source.historicalOnly || !(error instanceof MissingLocalArchiveAsset)) throw error;
        manifest.missingHistoryAssets!.push({ originalUrl: source.originalUrl, reason: error.message }); continue;
      }
      const info = await fsp.stat(local); const digest = await hashBackupFile(local);
      const ext = path.extname(sourcePath || source.originalUrl.split('?')[0]).slice(0, 9) || '.bin';
      const asset = { id: source.id, storageKey: source.storageKey, originalUrl: source.originalUrl, archivePath: `assets/${i}-${digest.slice(0, 12)}${ext}`, contentType: source.contentType || 'application/octet-stream', size: info.size, sha256: digest };
      manifest.assets.push(asset); paths.set(asset.id, local);
    }
    const cover = await thumbnail(manifest, paths);
    progress(`${manifest.projectName} · 正在本机生成备份包`);
    const zip = new ZipFile(); const localZip = path.join(temp, 'project.zip');
    for (const asset of manifest.assets) zip.addFile(paths.get(asset.id)!, asset.archivePath, { compress: false });
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    zip.addBuffer(Buffer.from('环中AIStudio 项目备份；manifest.json 记录项目内容及此前已删除的历史图片链接。'), 'README.txt');
    const writing = pipeline(zip.outputStream, fs.createWriteStream(localZip, { highWaterMark: CHUNK }));
    zip.on('error', error => (zip.outputStream as Readable).destroy(error)); zip.end(); await writing;
    await verifyBackupFile(localZip, manifest);
    const checksum = await hashBackupFile(localZip); const size = (await fsp.stat(localZip)).size;
    progress(`${manifest.projectName} · 正在连接 NAS 备份目录`);
    assertArchiveRoot(input.root);
    const name = manifest.projectName.replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 80);
    const fileName = `${name}_${manifest.exportedAt.replace(/[:.]/g, '-')}.hzarchive.zip`;
    const entry = makeArchiveEntry(manifest, size, checksum, fileName); entry.thumbnailDataUrl = cover;
    const target = path.join(input.root, entry.relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    remotePart = `${target}.${randomUUID()}.part`;
    let transferred = 0; let last = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, done) {
      transferred += chunk.length;
      if (Date.now() - last > 750) { last = Date.now(); progress(`${manifest.projectName} · 写入 NAS ${Math.round(transferred / size * 100)}%`); }
      done(null, chunk);
    } });
    progress(`${manifest.projectName} · 正在写入 NAS`);
    await pipeline(fs.createReadStream(localZip, { highWaterMark: CHUNK }), meter, fs.createWriteStream(remotePart, { highWaterMark: CHUNK, flags: 'wx' }));
    const handle = await fsp.open(remotePart, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    progress(`${manifest.projectName} · 正在校验 NAS 文件`);
    if (await hashBackupFile(remotePart, bytes => progress(`${manifest.projectName} · 校验 NAS ${Math.round(bytes / size * 100)}%`)) !== checksum) throw new Error('NAS 写入校验失败，本机项目已保留');
    await fsp.rename(remotePart, target); remotePart = '';
    await atomicJson(`${target}.meta.json`, entry);
    return { entry, assets: manifest.assets, copies: await verifiedLocalBackupCopies(manifest.assets), snapshotHash: backupSnapshotHash(snapshot), message: manifest.missingHistoryAssets!.length ? `已备份；保留 ${manifest.missingHistoryAssets!.length} 个此前已删除历史图片的链接说明` : '已备份' };
  } finally {
    if (remotePart) await fsp.unlink(remotePart).catch(() => {});
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

export async function prepareStreamRestore(file: string, userId: string, progress?: (stage: string) => void) {
  const manifest = await readStreamManifest(file);
  if (manifest.data.project.user_id && manifest.data.project.user_id !== userId) throw new Error('无权恢复这个项目');
  await verifyBackupFile(file, manifest, progress);
  const replacements = new Map<string, ProjectArchiveAssetReplacement>();
  const cloud = isLocalBackendEnabled() ? null : new S3Storage(new S3Config());
  const assets = new Map(manifest.assets.map(a => [a.archivePath, a]));
  let last = 0;
  await visitBackupZip(file, async (entry, stream) => {
    const asset = assets.get(entry.fileName);
    if (!asset) { for await (const _chunk of stream) { /* drain */ } return; }
    stream.on('data', () => {
      if (progress && Date.now() - last > 750) { last = Date.now(); progress(`${manifest.projectName} · 恢复资源 ${replacements.size + 1}/${assets.size}`); }
    });
    if (cloud) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const key = await cloud.uploadFile({ fileContent: Buffer.concat(chunks), fileName: path.basename(entry.fileName), contentType: asset.contentType });
      replacements.set(asset.id, { key, url: await cloud.generatePresignedUrl({ key, expireTime: 86400 }) });
    } else {
      const key = `restored_${randomUUID()}${path.extname(entry.fileName) || '.bin'}`;
      await pipeline(stream, fs.createWriteStream(mediaWritePath(key), { flags: 'wx', highWaterMark: CHUNK }));
      replacements.set(asset.id, { key, url: `/api/local-file/${key}` });
    }
  });
  // Database commit happens in the editing service, in one synchronous transaction,
  // against its latest state. The worker never writes the shared project database.
  const options = buildReplacementOptions(manifest, replacements, manifest.originalProjectId, true);
  return { manifest, options: { projectId: options.projectId, preserveRecordIds: true, assetByStorageKey: [...options.assetByStorageKey], assetByOriginalUrl: [...options.assetByOriginalUrl] } };
}
