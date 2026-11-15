import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { performance } from 'node:perf_hooks';
import { uploadFont, getFont, listFonts, updateFont, changeFontGroup, collectFont, fontFilePath, saveGenerationRecipe } from '../src/lib/font-library-store';
import { buildFontComposer } from '../src/lib/font-library-types';
import { createProject, createImageRecord, saveBinaryFile, hardDeleteImageRecord, createReferenceImage } from '../src/lib/local-backend';
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'font-library-test-')); process.env.LOCAL_DATA_DIR = dir;
  const owner = 'font-qa-user'; const png = await sharp({ create: { width: 400, height: 200, channels: 4, background: '#eee' } }).png().toBuffer();
  const file = new File([new Uint8Array(png)], '春山.png', { type: 'image/png' });
  try {
    const card = await uploadFont(owner, file); assert.equal(card.title, '春山'); assert.ok((await fs.stat(fontFilePath(card.cover.key, owner))).size);
    await assert.rejects(() => getFont('different-user', card.id)); assert.throws(() => fontFilePath(card.cover.key, 'different-user'));
    await assert.rejects(() => uploadFont(owner, new File(['invalid'], 'bad.png')));
    const groups = await changeFontGroup(owner, 'create', '', '书法');
    const edited = await updateFont(owner, card.id, { groupId: groups[0].id, title: '春山可望', prompt: '模仿图1，保留图2构图', version: card.version });
    await assert.rejects(() => updateFont(owner, card.id, { version: card.version, title: 'old' }), /已更新/);
    await Promise.all(Array.from({ length: 8 }, (_, i) => uploadFont(owner, new File([new Uint8Array(png)], `并发${i}.png`))));
    assert.equal((await listFonts(owner, new URLSearchParams())).total, 9);
    await changeFontGroup(owner, 'delete', groups[0].id, ''); assert.equal((await getFont(owner, card.id)).groupId, null);
    await updateFont(owner, card.id, { action: 'delete' }); assert.equal((await listFonts(owner, new URLSearchParams())).total, 8);
    await updateFont(owner, card.id, { action: 'restore' }); assert.equal((await listFonts(owner, new URLSearchParams())).total, 9);
    const sample = { ...edited, references: [{ ...card.cover, url: '/ref1', label: '原图1', role: 'reference' as const }, { ...card.cover, url: '/ref2', label: '原图2', role: 'reference' as const }] };
    const result = buildFontComposer({ card: sample, mode: 'append' }, '我的草稿[@图1]', [{ url: '/draft', label: '草稿' }]);
    assert.equal(result.refs.length, 4); assert.match(result.text, /我的草稿/); assert.match(result.text, /模仿图3，保留图4/);
    assert.equal(sample.prompt, '模仿图1，保留图2构图');
    const imageOnly = buildFontComposer({card: sample, mode: 'image'}, '', []); assert.equal(imageOnly.refs.length, 1);
    const partial = buildFontComposer({ card: sample, mode: 'replace' }, 'OLD', [], [card.cover.url, '/ref2']); assert.match(partial.text, /原参考图1未带入/); assert.match(partial.text, /图2构图/); assert.ok(!partial.text.includes('OLD'));
    const project = createProject(owner, 'source'); const saved = saveBinaryFile(png, 'source.png', 'image/png');
    const image = createImageRecord({ user_id: owner, project_id: project.id, prompt: '原始图1', image_url: saved.url, image_key: saved.key, status: 'completed', reference_images: JSON.stringify([saved.url, '/api/local-file/missing.png']), model: 'test-model', size: '3:2' });
    await saveGenerationRecipe(owner, image.id, { schemaVersion: 1, prompt: '实际图1', userPrompt: '用户图1', referenceImages: [saved.url, '/api/local-file/missing.png'], referenceLabels: ['纹理', '缺失'], parameters: { model: 'test-model', size: '3:2', quality: 'high' }, createdAt: new Date().toISOString() });
    const collected = await collectFont(owner, image.id); assert.equal(collected.card.originalPrompt, '实际图1'); assert.equal(collected.card.parameters.quality, 'high'); assert.equal(collected.card.references.length, 2); assert.equal(collected.card.references[1].missing, true);
    const duplicated = await collectFont(owner, image.id); assert.equal(duplicated.card.id, collected.card.id); assert.equal(duplicated.duplicate, true);
    const reference=createReferenceImage(owner,{project_id:project.id,image_url:saved.url,image_key:saved.key,file_name:'字体参考.png'});
    const fromReference=await collectFont(owner,`ref-${reference.id}`);assert.equal(fromReference.card.title,'字体参考');assert.equal(fromReference.card.prompt,'');assert.equal(fromReference.card.source.type,'upload');
    assert.equal((await collectFont(owner,`ref-${reference.id}`)).duplicate,true);
    await assert.rejects(()=>collectFont('different-user',`ref-${reference.id}`));
    hardDeleteImageRecord(image.id, owner); assert.ok((await fs.stat(fontFilePath(collected.card.cover.key, owner))).size); assert.ok((await fs.stat(fontFilePath(collected.card.references[0].key, owner))).size);
    // Seed 1000 cards directly in an isolated index to measure paged metadata overhead.
    const files = await fs.readdir(path.join(dir, 'local-data', 'font-library')).catch(() => []);
    const libraryDir = files.length ? path.join(dir, 'local-data', 'font-library') : path.join(dir, 'font-library');
    const ownerDirs = (await fs.readdir(libraryDir)).filter(v => v !== 'files'); const indexFile = path.join(libraryDir, ownerDirs[0], 'index.json');
    const index = JSON.parse(await fs.readFile(indexFile, 'utf8')); index.cards = Array.from({ length: 1000 }, (_, i) => ({ ...card, id: `bench-${i}`, title: `字体${i}` })); await fs.writeFile(indexFile, JSON.stringify(index));
    const start = performance.now(); const list = await listFonts(owner, new URLSearchParams({ page: '2' })); const elapsed = performance.now() - start;
    assert.equal(list.cards.length, 24); assert.equal(list.total, 1000); assert.ok(!('prompt' in list.cards[0]));
    console.log(JSON.stringify({ passed: true, checks: ['upload-validation', 'ownership', 'concurrent-index', 'conflict', 'group-delete', 'soft-delete-undo', 'reference-remap', 'missing-reference', 'exact-recipe', 'idempotence', 'source-deletion-survival', '1000-card-pagination'], pageMs: Math.round(elapsed * 100) / 100 }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
void main();
