import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DESKTOP_GUEST_USER_ID } from '../src/lib/guest';
import { prepareStreamRestore, hashBackupFile } from '../src/lib/project-backup-stream';
import { restoreLocalProjectSnapshot, exportLocalProjectSnapshot, resolveLocalFilePath } from '../src/lib/local-backend';

async function main() {
  const report = JSON.parse(await fs.readFile(path.resolve('output/storage-lifecycle/history-cleanup.json'), 'utf8'));
  const sample = report.files.find((file: { status: string; backup?: { projectName: string } }) => file.status === 'removed-verified-backup' && file.backup?.projectName === '泥璞');
  assert(sample?.backup, 'No deleted backup sample');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hz-nas-restore-'));
  process.env.LOCAL_DATA_DIR = temp;
  try {
    const owner = DESKTOP_GUEST_USER_ID;
    const prepared = await prepareStreamRestore(sample.backup.package, owner);
    const projectId = randomUUID();
    restoreLocalProjectSnapshot(prepared.manifest.data, owner, { projectId, preserveRecordIds: false, assetByStorageKey: new Map(prepared.options.assetByStorageKey), assetByOriginalUrl: new Map(prepared.options.assetByOriginalUrl) });
    const restored = exportLocalProjectSnapshot(projectId, owner);
    assert.equal(restored.imageRecords.length, prepared.manifest.data.imageRecords.length);
    assert.equal(restored.chatMessages.length, prepared.manifest.data.chatMessages.length);
    const replacements = new Map(prepared.options.assetByStorageKey);
    for (const asset of prepared.manifest.assets) {
      if (!asset.storageKey) continue;
      const replacement = replacements.get(asset.storageKey);
      assert(replacement?.key);
      assert.equal(await hashBackupFile(resolveLocalFilePath(replacement.key)), asset.sha256);
    }
    for (const [index, image] of restored.imageRecords.entries()) {
      assert.equal(image.canvas_x, prepared.manifest.data.imageRecords[index].canvas_x);
      assert.equal(image.canvas_y, prepared.manifest.data.imageRecords[index].canvas_y);
    }
    const result = { pass: true, projectName: prepared.manifest.projectName, images: restored.imageRecords.length, messages: restored.chatMessages.length, verifiedAssets: prepared.manifest.assets.length, independentDirectory: true, tempRemoved: true };
    await fs.writeFile(path.resolve('output/storage-lifecycle/nas-restore-verification.json'), JSON.stringify(result, null, 2)); console.log(result);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
