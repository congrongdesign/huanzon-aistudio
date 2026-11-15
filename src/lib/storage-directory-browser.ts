import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mediaRoot, mediaRoots, defaultMediaRoot } from './media-storage';
import { readRuntimeConfig } from './runtime-config';
import type { StorageDirectoryListing } from './storage-management-types';

export async function browseStorageDirectory(raw?: string): Promise<StorageDirectoryListing> {
  if (raw && !path.isAbsolute(raw)) throw new Error('文件夹地址无效');
  const requested = raw || mediaRoot();
  let directory: string;
  try { directory = await fs.realpath(requested); }
  catch (error) { if (raw || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('文件夹不可用，请检查磁盘连接'); directory = await fs.realpath(os.homedir()); }
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => { throw new Error('无法打开此文件夹，请选择其他位置'); });
  const folders: StorageDirectoryListing['folders'] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) folders.push({ name: entry.name, path: location });
    else if (entry.isSymbolicLink() && await fs.stat(location).then(s => s.isDirectory()).catch(() => false)) folders.push({ name: entry.name, path: location });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const shortcuts: StorageDirectoryListing['shortcuts'] = [];
  async function shortcut(name: string, location: string) {
    if (shortcuts.some(item => item.path === location)) return;
    if (await fs.stat(location).then(s => s.isDirectory()).catch(() => false)) shortcuts.push({ name, path: location });
  }
  await shortcut('当前图片库', mediaRoot());
  await shortcut('个人文件夹', os.homedir());
  for (const [label, name] of [['桌面', 'Desktop'], ['文稿', 'Documents'], ['图片', 'Pictures'], ['下载', 'Downloads']]) await shortcut(label, path.join(os.homedir(), name));
  for (const root of readRuntimeConfig().mediaPreviousDirectories || []) await shortcut(path.basename(root) || root, root);
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') await shortcut(`${letter}: 磁盘`, `${letter}:\\`);
  } else {
    await shortcut('文件系统', '/');
    for (const mountRoot of process.platform === 'darwin' ? ['/Volumes'] : ['/media', `/run/media/${os.userInfo().username}`, '/mnt']) {
      const volumes = await fs.readdir(mountRoot, { withFileTypes: true }).catch(() => []);
      for (const volume of volumes) await shortcut(volume.name, path.join(mountRoot, volume.name));
    }
  }
  const crumbs: StorageDirectoryListing['breadcrumbs'] = [];
  let current = directory;
  for (;;) {
    crumbs.unshift({ name: path.basename(current) || current, path: current });
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const writable = await fs.access(directory, fs.constants.W_OK).then(() => true).catch(() => false);
  const disk = await fs.statfs(directory).then(s => ({ available: s.bavail * s.bsize, total: s.blocks * s.bsize })).catch(() => null);
  return { directory, parent: path.dirname(directory) === directory ? null : path.dirname(directory), folders, shortcuts, breadcrumbs: crumbs, writable, disk };
}

export async function validateStorageDirectory(raw: string) {
  if (!path.isAbsolute(raw)) throw new Error('文件夹地址无效');
  const directory = await fs.realpath(raw).catch(() => { throw new Error('文件夹不可用，请检查磁盘连接'); });
  if (!(await fs.stat(directory)).isDirectory() || directory === path.parse(directory).root) throw new Error('请选择磁盘中的专用文件夹');
  for (const root of mediaRoots()) {
    if (root === directory) continue;
    const relative = path.relative(root, directory);
    const reverse = path.relative(directory, root);
    const contains = (value: string) => value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value);
    if (contains(relative) || contains(reverse)) throw new Error('请选择图片库之外的独立文件夹，避免新旧目录相互包含');
  }
  const probe = path.join(directory, `.huanzon-write-test-${randomUUID()}`);
  try { await fs.writeFile(probe, '', { flag: 'wx' }); }
  catch { throw new Error('此文件夹无法写入，请选择其他位置或检查访问权限'); }
  finally { await fs.unlink(probe).catch(() => {}); }
  return { directory, isDefault: directory === await fs.realpath(defaultMediaRoot()).catch(() => defaultMediaRoot()) };
}

export async function createStorageDirectory(parent: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(trimmed) || /[. ]$/.test(trimmed) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed) || trimmed.length > 120) throw new Error('请使用有效的文件夹名称，不含斜杠等特殊字符');
  if (!path.isAbsolute(parent)) throw new Error('父文件夹地址无效');
  const directory = await fs.realpath(parent);
  const target = path.join(directory, trimmed);
  try { await fs.mkdir(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('已存在同名文件夹，请换一个名称'); throw new Error('无法新建文件夹，请检查写入权限'); }
  return browseStorageDirectory(target);
}
