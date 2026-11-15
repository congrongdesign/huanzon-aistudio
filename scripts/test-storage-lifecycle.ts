import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject, createImageRecord, saveBinaryFile, resolveLocalFilePath, getLocalDataDirectory, hardDeleteImageRecord, softDeleteImageRecord, restoreImageRecord, getImageRecordById, drainLocalFileCleanup, localFileCleanupStatus, maintainLocalStorage } from '../src/lib/local-backend';
import { collectStorageReferences, saveBrowserReferences, fontTrash, purgeFontTrash } from '../src/lib/storage-lifecycle';
import { fontOwnerKey } from '../src/lib/font-library-store';
import { writeRuntimeConfig } from '../src/lib/runtime-config';
import { DELETE as trashDelete } from '../src/app/api/trash/route';
import { NextRequest } from 'next/server';
import { DESKTOP_GUEST_USER_ID } from '../src/lib/guest';

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-lifecycle-')); process.env.LOCAL_DATA_DIR = temp;
  const owner = DESKTOP_GUEST_USER_ID;
  const project = createProject(owner, 'lifecycle');
  const shared = saveBinaryFile(Buffer.from('shared content'), 'shared.png');
  const one = createImageRecord({ prompt: 'qa', user_id: owner, project_id: project.id, image_key: shared.key, image_url: shared.url });
  const two = createImageRecord({ prompt: 'qa', user_id: owner, project_id: project.id, image_key: shared.key, image_url: shared.url });
  hardDeleteImageRecord(one.id, owner); assert(fs.existsSync(resolveLocalFilePath(shared.key)), 'No physical deletion inside business commit');
  assert.equal(drainLocalFileCleanup().retained, 1); assert(fs.existsSync(resolveLocalFilePath(shared.key)));
  softDeleteImageRecord(two.id, owner);
  assert(Date.parse(getImageRecordById(two.id, owner)!.purge_after!) > Date.now() + 29 * 86400_000);
  restoreImageRecord(two.id, owner); assert.equal(getImageRecordById(two.id, owner)!.purge_after, null);
  saveBrowserReferences(owner, 'qa-browser-session', [{ name: 'saved-case', keys: [shared.key] }]);
  hardDeleteImageRecord(two.id, owner); assert.equal(drainLocalFileCleanup().retained, 1);
  assert(collectStorageReferences().reasons(shared.key).some(reason => reason.includes('saved-case')));
  // Terminal generation output is history; it must not hold bytes forever.
  fs.writeFileSync(path.join(getLocalDataDirectory(), 'generation-jobs.json'), JSON.stringify([{ status: 'completed', result: { image_url: shared.url } }]));
  saveBrowserReferences(owner, 'qa-browser-session', []);
  const old = createImageRecord({ prompt: 'qa', user_id: owner, image_key: shared.key, image_url: shared.url });
  hardDeleteImageRecord(old.id, owner); assert.equal(drainLocalFileCleanup().bytes, Buffer.byteLength('shared content'));
  assert(!fs.existsSync(resolveLocalFilePath(shared.key)));
  // A failed JSON commit must not remove originals or leave a committed deletion task.
  const safe = saveBinaryFile(Buffer.from('must survive'), 'commit-failure.png');
  const safeRow = createImageRecord({ prompt: 'qa', user_id: owner, image_key: safe.key, image_url: safe.url });
  const dbTmp = path.join(getLocalDataDirectory(), 'db.json.tmp'); fs.mkdirSync(dbTmp);
  assert.throws(() => hardDeleteImageRecord(safeRow.id, owner)); fs.rmdirSync(dbTmp);
  assert(getImageRecordById(safeRow.id, owner)); assert(fs.existsSync(resolveLocalFilePath(safe.key)));
  // All old directories are reclaimed, not just the first path found for reads.
  const copyRoot = path.join(temp, 'external'); fs.mkdirSync(path.join(copyRoot, 'files'), { recursive: true });
  fs.copyFileSync(resolveLocalFilePath(safe.key), path.join(copyRoot, 'files', safe.key));
  writeRuntimeConfig({ mediaPreviousDirectories: [copyRoot] }); hardDeleteImageRecord(safeRow.id, owner);
  assert.equal(drainLocalFileCleanup().bytes, Buffer.byteLength('must survive') * 2);
  // Corrupt auxiliary index blocks cleanup; task survives for an explicit retry.
  const corrupt = saveBinaryFile(Buffer.from('still safe'), 'corrupt.png');
  const corruptRow = createImageRecord({ prompt: 'qa', user_id: owner, image_key: corrupt.key, image_url: corrupt.url });
  hardDeleteImageRecord(corruptRow.id, owner); fs.writeFileSync(path.join(temp, 'draft.json'), '{');
  assert.throws(() => drainLocalFileCleanup(), /索引无法读取/); assert(fs.existsSync(resolveLocalFilePath(corrupt.key)));
  fs.unlinkSync(path.join(temp, 'draft.json')); assert.equal(drainLocalFileCleanup().bytes, 10);
  // An active generation protects in-memory inputs even when old files are selected.
  const busy = saveBinaryFile(Buffer.from('running'), 'busy.png');
  const busyRow = createImageRecord({ prompt: 'qa', user_id: owner, image_key: busy.key, image_url: busy.url });
  hardDeleteImageRecord(busyRow.id, owner);
  fs.writeFileSync(path.join(getLocalDataDirectory(), 'generation-jobs.json'), JSON.stringify([{ status: 'running' }]));
  assert.equal(drainLocalFileCleanup().bytes, 0); assert(localFileCleanupStatus().pending > 0);
  fs.writeFileSync(path.join(getLocalDataDirectory(), 'generation-jobs.json'), '[]'); drainLocalFileCleanup();
  // Trash endpoint cannot delete a live object, even if the caller supplies its ID.
  const live = createImageRecord({ prompt: 'qa', user_id: owner });
  const response = await trashDelete(new NextRequest('http://localhost/api/trash', { method: 'DELETE', body: JSON.stringify({ id: live.id }) }));
  assert.equal(response.status, 403); assert(getImageRecordById(live.id, owner));
  const legacy = createImageRecord({ prompt: 'qa', user_id: owner, deleted_at: '2020-01-01T00:00:00Z' });
  maintainLocalStorage(); assert(getImageRecordById(legacy.id, owner), 'Do not expire legacy trash retroactively');
  // Archived project drafts and detached recipes cannot hold originals forever.
  saveBrowserReferences(owner, 'qa-stale-project', [{ name: 'hz_chat_draft_11111111-1111-4111-8111-111111111111', keys: ['stale.png'] }]);
  assert(!collectStorageReferences().used('stale.png'));
  saveBrowserReferences(owner, 'qa-current-project', [{ name: `hz_chat_draft_${project.id}`, keys: ['current.png'] }]);
  assert(collectStorageReferences().used('current.png'));
  const recipeDir = path.join(getLocalDataDirectory(), 'font-library', fontOwnerKey(owner), 'recipes'); fs.mkdirSync(recipeDir, { recursive: true });
  fs.writeFileSync(path.join(recipeDir, 'detached.json'), JSON.stringify({ image_key: 'stale-recipe.png' }));
  assert(!collectStorageReferences().used('stale-recipe.png'));
  // Font trash is visible to storage cleanup, with shared cards retaining bytes.
  const fontDir = path.join(getLocalDataDirectory(), 'font-creation', fontOwnerKey(owner)); fs.mkdirSync(fontDir, { recursive: true });
  const sessionFile = path.join(fontDir, '11111111-1111-4111-8111-111111111111.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ runs: [{ id: 'deleted-font', deletedAt: new Date().toISOString(), result: { image_key: 'font.png' } }], draft: {} }));
  assert.deepEqual(collectStorageReferences().reasons('font.png'), ['回收站保留']);
  const fontItem = fontTrash(owner)[0]; assert(fontItem);
  const lock = sessionFile.replace(/\.json$/, '.lock'); fs.mkdirSync(lock);
  assert.throws(() => purgeFontTrash(owner, fontItem.id), /正在保存/); fs.rmdirSync(lock);
  assert.deepEqual(purgeFontTrash(owner, fontItem.id), ['font.png']);
  assert(!collectStorageReferences().used('font.png'));
  await new Promise(resolve => setTimeout(resolve, 30)); await fsp.rm(temp, { recursive: true, force: true });
  console.log('PASS: shared assets, browser references, weak diagnostics, 30-day new trash, restore, failed metadata commit, all-copy deletion, corrupt index retry, running-job protection, trash ownership/state, legacy retention');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
