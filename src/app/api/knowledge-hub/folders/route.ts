import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getProjectAssetPackById, readKnowledgeHubConfig, touchProjectAssetPack } from '@/lib/knowledge-hub-store';
import { getProjectById, isLocalBackendEnabled } from '@/lib/local-backend';

const NAS_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif']);

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

function isImageName(name: string): boolean {
  return NAS_IMAGE_EXT.has(path.extname(name).toLowerCase());
}

function safeRelativePath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' ? '' : relative.split(path.sep).join('/');
}

function resolveFolderPath(rootPath: string, folderKey: string): string {
  const normalizedKey = folderKey.trim().replace(/^\/+/, '');
  const target = path.resolve(rootPath, normalizedKey);
  const root = path.resolve(rootPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('非法文件夹路径');
  }
  return target;
}

function canAccessPack(packId: string, userId: string): boolean {
  const pack = getProjectAssetPackById(packId);
  if (!pack) return false;
  if (!isLocalBackendEnabled()) return true;
  return Boolean(getProjectById(pack.projectId, userId));
}

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const config = readKnowledgeHubConfig();
  const packId = (request.nextUrl.searchParams.get('packId') || '').trim();
  const pack = packId ? getProjectAssetPackById(packId) : null;
  if (packId && (!pack || !canAccessPack(packId, userId))) {
    return NextResponse.json({ folders: [], error: '素材包不存在或无权限' }, { status: 404 });
  }
  if (pack?.source === 'feishu') {
    return NextResponse.json({ folders: [], rootPath: '', pack, error: '飞书素材包不使用本地文件夹树，请点击刷新同步飞书内容。' });
  }

  const rootPath = (pack?.rootPath || config.nas.rootPath || '').trim();
  const sourceEnabled = pack ? Boolean(rootPath) : config.nas.enabled;
  if (!sourceEnabled || !rootPath) {
    return NextResponse.json({ folders: [], pack, error: 'NAS 或本地路径未配置' });
  }
  if (!fs.existsSync(rootPath)) {
    return NextResponse.json({ folders: [], pack, error: `路径不存在: ${rootPath}` }, { status: 404 });
  }

  const maxFolders = Math.max(20, Math.min(5000, Number(request.nextUrl.searchParams.get('limit') || 300)));
  const maxDepth = Math.max(1, Math.min(20, Number(request.nextUrl.searchParams.get('depth') || 2)));
  const baseKey = request.nextUrl.searchParams.get('folder') || '';
  const basePath = resolveFolderPath(rootPath, baseKey);
  if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
    return NextResponse.json({ folders: [], error: `文件夹不存在: ${baseKey || '根目录'}` }, { status: 404 });
  }

  const folders: Array<{ key: string; parentKey: string | null; name: string; label: string; path: string; depth: number; fileCount: number; childCount: number }> = [
    { key: '', parentKey: null, name: '根目录', label: '根目录', path: rootPath, depth: 0, fileCount: 0, childCount: 0 },
  ];
  const seen = new Set<string>(['']);
  if (baseKey) {
    const parentKey = path.posix.dirname(baseKey) === '.' ? '' : path.posix.dirname(baseKey);
    folders.push({
      key: baseKey,
      parentKey,
      name: path.basename(basePath),
      label: path.basename(basePath),
      path: basePath,
      depth: baseKey.split('/').length,
      fileCount: 0,
      childCount: 0,
    });
    seen.add(baseKey);
  }
  const queue: Array<{ fullPath: string; scanDepth: number }> = [{ fullPath: basePath, scanDepth: 0 }];

  while (queue.length > 0 && folders.length < maxFolders) {
    const currentNode = queue.shift();
    if (!currentNode) continue;
    const current = currentNode.fullPath;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    const currentKey = safeRelativePath(rootPath, current);
    const currentFolder = folders.find((folder) => folder.key === currentKey);
    if (currentFolder) {
      currentFolder.fileCount = entries.filter((entry) => entry.isFile() && isImageName(entry.name) && (config.nas.includeHidden || !isHiddenName(entry.name))).length;
      currentFolder.childCount = entries.filter((entry) => entry.isDirectory() && (config.nas.includeHidden || !isHiddenName(entry.name))).length;
    }

    if (currentNode.scanDepth >= maxDepth) continue;

    for (const entry of entries) {
      if (!config.nas.includeHidden && isHiddenName(entry.name)) continue;
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(current, entry.name);
      const key = safeRelativePath(rootPath, fullPath);
      if (seen.has(key)) continue;
      seen.add(key);
      const parentKey = safeRelativePath(rootPath, current);
      folders.push({
        key,
        parentKey,
        name: entry.name,
        label: entry.name,
        path: fullPath,
        depth: key ? key.split('/').length : 0,
        fileCount: 0,
        childCount: 0,
      });
      queue.push({ fullPath, scanDepth: currentNode.scanDepth + 1 });
      if (folders.length >= maxFolders) break;
    }
  }

  if (packId) touchProjectAssetPack(packId);

  return NextResponse.json({
    rootPath,
    pack,
    total: folders.length,
    folders,
  });
}
