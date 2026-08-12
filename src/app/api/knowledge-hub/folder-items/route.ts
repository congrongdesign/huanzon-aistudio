import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import {
  createKnowledgeItemId,
  getProjectAssetPackById,
  KnowledgeHubItem,
  KnowledgeSource,
  readKnowledgeHubConfig,
  readKnowledgeHubIndex,
  touchProjectAssetPack,
  upsertKnowledgeItems,
} from '@/lib/knowledge-hub-store';
import { getProjectById, isLocalBackendEnabled } from '@/lib/local-backend';

const NAS_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif']);

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

function isImagePath(filePath: string): boolean {
  return NAS_IMAGE_EXT.has(path.extname(filePath).toLowerCase());
}

async function buildNasItem(rootPath: string, filePath: string, source: KnowledgeSource = 'nas', packId?: string): Promise<KnowledgeHubItem> {
  const stat = fs.statSync(filePath);
  let dimensions: { width?: number; height?: number } = {};
  try {
    const meta = await sharp(filePath, { limitInputPixels: false }).metadata();
    dimensions = { width: meta.width, height: meta.height };
  } catch {
    dimensions = {};
  }
  return {
    id: createKnowledgeItemId(source, filePath),
    source,
    kind: 'image',
    title: path.basename(filePath),
    location: rootPath,
    externalId: filePath,
    metadata: {
      relativePath: path.relative(rootPath, filePath),
      ext: path.extname(filePath).toLowerCase(),
      mtimeMs: stat.mtimeMs,
      packId,
      ...dimensions,
    },
    size: stat.size,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
  };
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
    return NextResponse.json({ error: '素材包不存在或无权限', items: [] }, { status: 404 });
  }

  if (pack?.source === 'feishu') {
    const allowedSpaces = new Set((pack.feishuSpaceIds || []).filter(Boolean));
    const allItems = readKnowledgeHubIndex().items;
    const items = allItems.filter((item) => {
      if (item.source !== 'feishu') return false;
      if (allowedSpaces.size === 0) return true;
      const spaceId = typeof item.metadata?.spaceId === 'string' ? item.metadata.spaceId : item.externalId.split(':')[0];
      return allowedSpaces.has(spaceId);
    });
    touchProjectAssetPack(packId);
    return NextResponse.json({
      folder: '',
      folderPath: '',
      recursive: false,
      total: items.length,
      subfolders: [],
      items,
      pack,
    });
  }

  const rootPath = (pack?.rootPath || config.nas.rootPath || '').trim();
  const sourceEnabled = pack ? Boolean(rootPath) : config.nas.enabled;
  if (!sourceEnabled || !rootPath) {
    return NextResponse.json({ error: 'NAS 或本地路径未配置', items: [] }, { status: 400 });
  }
  if (!fs.existsSync(rootPath)) {
    return NextResponse.json({ error: `路径不存在: ${rootPath}`, items: [] }, { status: 404 });
  }

  try {
    const folderKey = request.nextUrl.searchParams.get('folder') || '';
    const recursive = request.nextUrl.searchParams.get('recursive') === '1';
    const maxItems = Math.max(1, Math.min(5000, Number(request.nextUrl.searchParams.get('limit') || 2000)));
    const folderPath = resolveFolderPath(rootPath, folderKey);

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return NextResponse.json({ error: '文件夹不存在', items: [] }, { status: 404 });
    }

    const items: KnowledgeHubItem[] = [];
    const subfolders: Array<{ key: string; label: string; path: string }> = [];
    const queue: string[] = [folderPath];

    while (queue.length > 0 && items.length < maxItems) {
      const current = queue.shift();
      if (!current) continue;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!config.nas.includeHidden && isHiddenName(entry.name)) continue;
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          const relativeKey = path.relative(rootPath, fullPath).split(path.sep).join('/');
          if (current === folderPath) {
            subfolders.push({ key: relativeKey, label: entry.name, path: fullPath });
          }
          if (recursive) queue.push(fullPath);
          continue;
        }

        if (!entry.isFile() || !isImagePath(fullPath)) continue;
        const source: KnowledgeSource = pack?.source === 'local' ? 'local' : 'nas';
        items.push(await buildNasItem(rootPath, fullPath, source, pack?.id));
        if (items.length >= maxItems) break;
      }
    }

    upsertKnowledgeItems(items);
    if (packId) touchProjectAssetPack(packId);

    return NextResponse.json({
      folder: folderKey,
      folderPath,
      recursive,
      total: items.length,
      subfolders,
      items,
      pack,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取文件夹失败', items: [] },
      { status: 400 },
    );
  }
}
