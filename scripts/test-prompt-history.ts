import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { collectPromptHistory, listPromptHistory } from '../src/lib/prompt-history';
import { createProject, createImageRecord, saveBinaryFile, listPrompts, updatePrompt, hardDeleteImageRecord, resolveLocalFilePath, drainLocalFileCleanup } from '../src/lib/local-backend';
import { createLocalLibrary } from '../src/lib/prompt-library-store';
import { saveGenerationRecipe } from '../src/lib/font-library-store';
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-history-test-'));
  process.env.LOCAL_DATA_DIR = root;
  const owner = 'prompt-history-qa';
  try {
    const project = createProject(owner, '春山项目'), other = createProject(owner, '其他项目');
    const png = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#cad7c5' } }).png().toBuffer();
    const file = saveBinaryFile(png, 'history.png', 'image/png');
    const seed = (prompt: string, patch = {}) => createImageRecord({ user_id: owner, project_id: project.id, prompt, image_url: file.url, image_key: file.key, model: 'qa-model', status: 'completed', ...patch });
    const uniquePreview = saveBinaryFile(png, 'independent-preview.png', 'image/png');
    const image = seed('春山原始描述', { image_url: uniquePreview.url, image_key: uniquePreview.key });
    const fullPrompt = '完整实际提示词 '.repeat(120) + '结尾不可截断';
    await saveGenerationRecipe(owner, image.id, { schemaVersion: 1, prompt: fullPrompt, referenceImages: [file.url], parameters: { model: 'recipe-model', size: '16:9' }, createdAt: new Date().toISOString() });
    const group = createLocalLibrary(owner, { name: '历史精选' });
    const old = seed('旧作品', { created_at: '2020-01-01T00:00:00Z', project_id: other.id });
    const invalid = [seed('上传：原图'), seed('失败', { status: 'failed' }), seed('删除', { deleted_at: new Date().toISOString() }), seed('其他用户', { user_id: 'other-owner' }), seed('')];
    assert.equal(listPromptHistory(owner, new URLSearchParams()).total, 2);
    assert.equal(listPromptHistory(owner, new URLSearchParams({ q: '春山', days: '7' })).total, 1);
    assert.equal(listPromptHistory(owner, new URLSearchParams({ project: other.id })).records[0].id, old.id);
    const result = await collectPromptHistory(owner, [image.id, image.id, 'missing'], group.id);
    assert.equal(result.added, 1); assert.equal(result.failed, 1);
    const card = listPrompts(owner)[0];
    assert.equal(card.text, fullPrompt.trim()); assert.equal(card.image_url, uniquePreview.url); assert.equal(card.library_id, group.id); assert.equal(card.model, 'recipe-model'); assert.equal(card.aspect_ratio, '16:9');
    assert.equal(JSON.parse(card.source!).referenceRequired, true);
    assert.equal(listPromptHistory(owner, new URLSearchParams()).records.find(r => r.id === image.id)?.collected, true);
    updatePrompt(card.id, owner, { text: '用户修改后的提示词' });
    const repeats = await Promise.all([collectPromptHistory(owner, [image.id]), collectPromptHistory(owner, [image.id])]);
    assert.ok(repeats.every(r => r.duplicates === 1)); assert.equal(listPrompts(owner).length, 1); assert.equal(listPrompts(owner)[0].text, '用户修改后的提示词');
    assert.equal((await collectPromptHistory(owner, invalid.map(r => r.id))).failed, invalid.length);
    await assert.rejects(() => collectPromptHistory(owner, [old.id], 999999), /分组不存在/);
    await assert.rejects(() => collectPromptHistory(owner, []));
    hardDeleteImageRecord(image.id, owner); drainLocalFileCleanup(); assert.ok((await fs.stat(resolveLocalFilePath(uniquePreview.key))).size > 0);
    for (let i = 0; i < 27; i++) seed(`分页作品${i}`);
    assert.equal(listPromptHistory(owner, new URLSearchParams()).records.length, 24);
    assert.equal(listPromptHistory(owner, new URLSearchParams({ page: '2' })).records.length, 4);
    console.log(JSON.stringify({ passed: true, checks: ['full-actual-prompt', 'preview-and-parameters', 'target-group', 'search-project-date', 'pagination', 'ownership-and-eligibility', 'idempotence-manual-edit-preserved', 'partial-failure', 'source-deletion-preview-survives'] }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
void main();
