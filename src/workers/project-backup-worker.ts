import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listArchiveEntries, findArchiveEntry, deleteArchivePackage, writeArchiveConfig, updateArchiveEntryMeta, assertArchiveRoot } from '../lib/project-archive-store';
import { streamProjectBackup, prepareStreamRestore, hashBackupFile, readStreamManifest, verifyBackupFile, verifiedLocalBackupCopies } from '../lib/project-backup-stream';
import { backupSnapshotHash } from '../lib/project-backup-snapshot';
import { browseStorageDirectory, createStorageDirectory, validateStorageDirectory } from '../lib/storage-directory-browser';

const parent = process.ppid;
setInterval(() => {
  try { process.kill(parent, 0); } catch { process.exit(1); }
}, 2000).unref();
try { os.setPriority(0, 10); } catch { /* Platform may not expose process niceness. */ }
const send = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);
const progress = (stage: string) => send({ progress: stage });

async function run(input: Record<string, unknown>) {
  const root = String(input.root || ''); const userId = String(input.userId || '');
  switch (input.action) {
    case 'scan': return { entries: await listArchiveEntries(root) };
    case 'configure': {
      assertArchiveRoot(root);
      const probe = path.join(root, `.backup-probe-${process.pid}`);
      try { fs.writeFileSync(probe, 'ok', { flag: 'wx' }); } finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
      return { config: writeArchiveConfig(root), entries: await listArchiveEntries(root) };
    }
    case 'backup': return streamProjectBackup({ projectId: String(input.projectId), userId, root, baseUrl: String(input.baseUrl || '') }, progress);
    case 'verify-removal': {
      const entry = await findArchiveEntry(root, String(input.entryId));
      if (entry.ownerId && entry.ownerId !== userId) throw new Error('无权处理这个备份');
      const file = path.join(root, entry.relativePath);
      if (await hashBackupFile(file, bytes => progress(`${entry.projectName} · 校验备份 ${Math.round(bytes / entry.size * 100)}%`)) !== entry.checksum) throw new Error('备份校验失败，原项目保留');
      const manifest = await readStreamManifest(file);
      if (manifest.data.project.user_id && manifest.data.project.user_id !== userId) throw new Error('无权处理这个项目');
      await verifyBackupFile(file, manifest, progress);
      return { entry, assets: manifest.assets, copies: await verifiedLocalBackupCopies(manifest.assets), snapshotHash: backupSnapshotHash(manifest.data), message: '已有备份校验完成' };
    }
    case 'prepare-restore': {
      const entry = await findArchiveEntry(root, String(input.entryId));
      if (entry.ownerId && entry.ownerId !== userId) throw new Error('无权恢复这个项目');
      const file = path.join(root, entry.relativePath);
      progress(`${entry.projectName} · 校验备份文件`);
      if (await hashBackupFile(file, bytes => progress(`${entry.projectName} · 校验备份 ${Math.round(bytes / entry.size * 100)}%`)) !== entry.checksum) throw new Error('备份包校验失败');
      const prepared = await prepareStreamRestore(file, userId, progress);
      return { entry, prepared };
    }
    case 'restored-meta': {
      const entry = await findArchiveEntry(root, String(input.entryId));
      if (entry.ownerId && entry.ownerId !== userId) throw new Error('无权更新这个备份');
      return { entry: updateArchiveEntryMeta(root, entry, { restoredAt: new Date().toISOString(), restoredProjectId: String(input.projectId) }) };
    }
    case 'delete': {
      for (const id of input.entryIds as string[]) {
        const entry = await findArchiveEntry(root, id);
        if (entry.ownerId && entry.ownerId !== userId) throw new Error('无权删除这个备份');
        deleteArchivePackage(root, entry);
      }
      return { success: true, entries: await listArchiveEntries(root) };
    }
    case 'browse-directory': return browseStorageDirectory(input.directory ? String(input.directory) : undefined);
    case 'validate-directory': return validateStorageDirectory(String(input.directory));
    case 'create-directory': return createStorageDirectory(String(input.directory), String(input.name));
    default: throw new Error('未知备份工作进程操作');
  }
}
let request = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { request += chunk; });
process.stdin.on('end', () => {
  void run(JSON.parse(request)).then(result => {
    process.stdout.write(`${JSON.stringify({ result })}\n`, () => process.exit(0));
  }, error => {
    process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`, () => process.exit(1));
  });
});
