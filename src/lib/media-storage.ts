import fs from 'node:fs';
import path from 'node:path';
import { getBaseDataDir, readRuntimeConfig } from './runtime-config';

export type MediaKind = 'files' | 'fonts';
export const defaultMediaRoot = () => path.join(getBaseDataDir(), 'local-data');
export const mediaRoot = () => readRuntimeConfig().mediaDirectory || defaultMediaRoot();
export const mediaRoots = () => [...new Set([mediaRoot(), ...(readRuntimeConfig().mediaPreviousDirectories || []), defaultMediaRoot()].map(root => {
  try { return fs.realpathSync(root); } catch { return path.resolve(root); }
}))];
export const mediaFolder = (root: string, kind: MediaKind) => path.join(root, kind === 'files' ? 'files' : 'font-library/files');
export function mediaWritePath(key: string, kind: MediaKind = 'files') {
  const root = mediaRoot();
  if (readRuntimeConfig().mediaDirectory && !fs.existsSync(root)) throw new Error('图片储存目录不可用，请连接磁盘或在设置中更改位置');
  const folder = mediaFolder(root, kind);
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, path.basename(key));
}
export function mediaReadPath(key: string, kind: MediaKind = 'files') {
  const name = path.basename(key);
  for (const root of mediaRoots()) {
    const file = path.join(mediaFolder(root, kind), name);
    if (fs.existsSync(file)) return file;
  }
  return path.join(mediaFolder(mediaRoot(), kind), name);
}
export function previewCacheLimitBytes() {
  const mb = readRuntimeConfig().previewCacheLimitMB;
  return (typeof mb === 'number' && Number.isFinite(mb) ? Math.max(64, Math.min(4096, mb)) : 256) * 1024 * 1024;
}
