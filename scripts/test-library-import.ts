import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createImportBatch, getImportItem, importBatchAction, importSnapshot, stageImportContent } from '../src/lib/library-import-service';
import { importSql } from '../src/lib/library-import-worker';
import { getFont, listFonts, updateFont } from '../src/lib/font-library-store';
import { listCaseLibrary, updateCaseAssets } from '../src/lib/case-library-store';
import { listPrompts, updatePrompt } from '../src/lib/local-backend';
import { writeProviderProfilesStore } from '../src/lib/provider-profiles-store';
import { collectStorageReferences } from '../src/lib/storage-lifecycle';
import type { LibraryKind, LibraryImportItem } from '../src/lib/library-import-types';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hz-import-test-')); process.env.LOCAL_DATA_DIR = root;
  const originalFetch = globalThis.fetch; const owner = 'import-test';
  const bytes = await sharp({ create: { width: 500, height: 300, channels: 3, background: '#284' } }).png().toBuffer();
  const result = { title: '几何字形海报', description: '几何结构，清晰的视觉层级与绿色背景，适合标题和海报设计。', tags: ['几何', '绿色'], category: '几何科技', prompt: '设计几何结构标题字，搭配清晰层级与绿色背景。', sampleText: '春山可望', ocr: '春山可望', confidence: .95 };
  let calls = 0, release: (() => void) | undefined, delayAnalysis = false;
  const now = new Date().toISOString();
  writeProviderProfilesStore({ profiles: [{ id: 'test', name: 'Test', baseUrl: 'https://mock.example/v1', apiKeyLocal: 'test', type: 'custom', enabled: true, createdAt: now, updatedAt: now }], capabilityBindings: [{ capability: 'vision', providerId: 'test', modelId: 'mock-vision', enabled: true, isDefault: true, showInPicker: true, updatedAt: now }] });
  globalThis.fetch = async (_url, init) => { calls++; const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'mock-vision'); if (delayAnalysis) await new Promise<void>(resolve => { release = resolve; }); return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }); };
  const waitFor = async (id: string, check: (item: LibraryImportItem) => boolean) => {
    const start = Date.now(); while (Date.now() - start < 20_000) { const item = await getImportItem(owner, id); if (check(item)) return item; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(`Timed out ${id}: ${JSON.stringify(await getImportItem(owner, id))}`);
  };
  const create = async (kind: LibraryKind, name: string, content = bytes, targetId?: string) => {
    const id = randomUUID(); const batch = await createImportBatch(owner, { kind, targetId, files: [{ id, name, bytes: content.length }] });
    await stageImportContent(owner, id, new Blob([new Uint8Array(content)]).stream()); return { id, batch: batch.batch.id };
  };
  try {
    for (const kind of ['fonts', 'prompts', 'cases'] as const) {
      const job = await create(kind, `${kind}.png`); const item = await waitFor(job.id, i => i.stage === 'completed');
      assert.ok(item.cardId && item.created); assert.equal(item.analysis?.title, result.title); assert.ok(collectStorageReferences().used(item.media!.key));
      if (kind === 'fonts') assert.equal((await getFont(owner, item.cardId!)).title, result.title);
      if (kind === 'prompts') assert.equal(listPrompts(owner)[0].text, result.prompt);
      if (kind === 'cases') assert.equal((await listCaseLibrary(owner, new URLSearchParams())).items[0].title, result.title);
      const duplicate = await create(kind, '重复.png'); const dup = await waitFor(duplicate.id, i => i.stage === 'completed'); assert.equal(dup.created, false); assert.equal(dup.cardId, item.cardId);
      await importBatchAction(owner, duplicate.batch, 'undo');
      const attach = await create(kind, '附件.png', bytes, item.cardId); const attached = await waitFor(attach.id, i => i.stage === 'completed'); assert.equal(attached.created, false);
      await importBatchAction(owner, attach.batch, 'undo');
    }
    assert.equal(calls, 3);
    const damaged = await create('cases', '坏图.png', Buffer.from('invalid')); assert.equal((await waitFor(damaged.id, i => i.stage === 'failed')).cardId, undefined);
    const secondBytes = await sharp({ create: { width: 301, height: 200, channels: 3, background: '#fa0' } }).png().toBuffer();
    delayAnalysis = true;
    const editedJob = await create('fonts', '手动保护.png', secondBytes); const editing = await waitFor(editedJob.id, i => i.stage === 'analyzing');
    await updateFont(owner, editing.cardId!, { title: '我的名称', prompt: '我的指令' });
    // AI delay must not prevent the next file being persisted.
    const concurrent = await create('cases', '并发保存.png', secondBytes); await waitFor(concurrent.id, i => !!i.cardId);
    release?.(); delayAnalysis = false;
    const complete = await waitFor(editedJob.id, i => i.stage === 'completed'); const card = await getFont(owner, complete.cardId!); assert.equal(card.title, '我的名称'); assert.equal(card.prompt, '我的指令');
    await importBatchAction(owner, editedJob.batch, 'undo'); assert.equal((await getFont(owner, card.id)).title, '我的名称');
    const caseDone = await waitFor(concurrent.id, i => i.stage === 'completed'); await updateCaseAssets(owner, [caseDone.cardId!], { title: '案例手动名称' });
    await importBatchAction(owner, concurrent.batch, 'undo'); assert.equal((await listCaseLibrary(owner, new URLSearchParams({ q: '案例手动名称' }))).total, 1);
    const prompts = listPrompts(owner); updatePrompt(prompts[0].id, owner, { text: '手动提示词' }); assert.equal(listPrompts(owner)[0].importManual?.includes('text'), true);
    const snapshots = await importSnapshot(owner); assert.ok(snapshots.items.length); assert.equal((await importSnapshot('other-user')).items.length, 0);
    await assert.rejects(() => importBatchAction('other-user', editedJob.batch, 'retry'));
    // Durable state exists independently from React and HTTP request lifetimes.
    const sql = await importSql('PRAGMA journal_mode'); assert.equal(sql.rows[0].journal_mode, 'wal');
    assert.equal((await listFonts(owner, new URLSearchParams())).total, 2);
    // No configured model: preserve originals and durable tasks, then resume after restart.
    writeProviderProfilesStore({ profiles: [], capabilityBindings: [] });
    const recoveryBytes = await sharp({create:{width:32,height:32,channels:3,background:'#713'}}).png().toBuffer();
    const recovery = await create('cases','恢复测试.png',recoveryBytes);
    await waitFor(recovery.id,i=>i.stage==='waiting');
    const globals = globalThis as typeof globalThis & {hzImportWorker?: {worker:{terminate():Promise<number>}}; hzLibraryImport?: {initialized?:Promise<void>;timer?:ReturnType<typeof setTimeout>}};
    if(globals.hzLibraryImport?.timer) {clearTimeout(globals.hzLibraryImport.timer); globals.hzLibraryImport.timer=undefined;}
    await globals.hzImportWorker?.worker.terminate();
    globals.hzLibraryImport!.initialized=undefined;
    assert.equal((await importSnapshot(owner)).items.find(i=>i.id===recovery.id)?.stage,'waiting');
    await importBatchAction(owner,recovery.batch,'pause');
    await importBatchAction(owner,recovery.batch,'cancel');
    assert.equal((await getImportItem(owner,recovery.id)).stage,'canceled');
    assert.ok((await getImportItem(owner,recovery.id)).cardId);
    await importBatchAction(owner,recovery.batch,'undo');
    assert.equal((await getImportItem(owner,recovery.id)).undone,true);
    console.log(JSON.stringify({ passed: true, checks: ['three-library-import', 'real-worker-decode', 'sqlite-wal', 'duplicate-no-delete', 'attachments', 'corrupt-image-isolation', 'manual-protection', 'saving-during-ai', 'undo-protection', 'media-gc-references', 'owner-isolation', 'analysis-cache','restart-recovery','no-model-preserves-original','pause-cancel-undo'], modelCalls: calls }));
  } finally {
    globalThis.fetch = originalFetch;
    // Workers use open WAL handles; close them before deleting isolated test data.
    const state = globalThis as typeof globalThis & { hzImportWorker?: { worker: { terminate(): Promise<number> } }; hzLibraryImport?: { timer?: ReturnType<typeof setTimeout> } };
    if (state.hzLibraryImport?.timer) clearTimeout(state.hzLibraryImport.timer);
    await state.hzImportWorker?.worker.terminate(); await fs.rm(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
