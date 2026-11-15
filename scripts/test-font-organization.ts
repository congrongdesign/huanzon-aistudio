import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeFontRecognition, prepareFontOrganization, runFontOrganization, fontOrganizationStatus } from '../src/lib/font-library-organizer';
import { uploadFont, getFont, listFonts, updateFont, applyFontOrganization } from '../src/lib/font-library-store';
import { writeProviderProfilesStore } from '../src/lib/provider-profiles-store';
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'font-organization-')); process.env.LOCAL_DATA_DIR = dir;
  const originalFetch = globalThis.fetch; const owner = 'test';
  try {
    const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
    const card = await uploadFont(owner, new File([new Uint8Array(bytes)], 'random-filename.png'));
    const info = normalizeFontRecognition({ sampleText: '春山可望', confidence: .95, style: '苍劲飞白书法', category: '书法手写', tags: ['飞白', '飞白', '毛笔'], description: '笔画苍劲、飞白明显，疏密富于变化。' });
    assert.deepEqual(info.tags, ['飞白', '毛笔']);
    assert.throws(() => normalizeFontRecognition({ ...info, category: 'invalid' }));
    assert.equal(normalizeFontRecognition({ ...info, confidence: '0.99' }).confidence, 0);
    const edited = await updateFont(owner, card.id, { prompt: '真实原始配方', version: card.version });
    const result = await applyFontOrganization(owner, edited, info, 'vision-model');
    assert.equal(result.title, '春山可望 · 苍劲飞白书法'); assert.equal(result.prompt, '真实原始配方'); assert.equal(result.originalPrompt, '');
    assert.equal((await listFonts(owner, new URLSearchParams({ q: '飞白' }))).total, 1);
    assert.equal((await listFonts(owner, new URLSearchParams())).groups[0].name, '书法手写');
    await assert.rejects(() => applyFontOrganization(owner, edited, info, 'vision-model'), /已被编辑/);
    await updateFont(owner, card.id, { action: 'undo-organize', version: result.version });
    assert.equal((await getFont(owner, card.id)).title, 'random-filename');
    const before = await getFont(owner, card.id);
    const uncertain = await applyFontOrganization(owner, { ...before }, { ...info, confidence: .3 }, 'test'); assert.equal(uncertain.sampleText, '');
    const now = new Date().toISOString(); writeProviderProfilesStore({ profiles: [{ id: 'test', name: 'Test', baseUrl: 'https://example.test/v1', apiKeyLocal: 'test-key', type: 'custom', enabled: true, createdAt: now, updatedAt: now }], capabilityBindings: [{ capability: 'vision', modelId: 'test-vision', providerId: 'test', enabled: true, isDefault: true, showInPicker: true, updatedAt: now }] });
    let calls = 0;
    globalThis.fetch = async (input, init) => { calls++; assert.equal(String(input), 'https://example.test/v1/chat/completions'); const body = JSON.parse(String(init?.body)); assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/); return Response.json({ choices: [{ message: { content: JSON.stringify(info) } }] }); };
    await prepareFontOrganization(owner, card.id, true); await Promise.all([runFontOrganization(owner), runFontOrganization(owner)]); assert.equal(calls, 1); assert.equal(fontOrganizationStatus(owner).completed, 1);
    await prepareFontOrganization(owner); await runFontOrganization(owner); assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ error: 'not found' }, { status: 404 });
    await prepareFontOrganization(owner, card.id, true); await runFontOrganization(owner); assert.equal(fontOrganizationStatus(owner).failed, 1); assert.equal((await getFont(owner, card.id)).title, '春山可望 · 苍劲飞白书法');
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: 'invalid-json' } }] });
    await prepareFontOrganization(owner, card.id, true); await runFontOrganization(owner); assert.equal(fontOrganizationStatus(owner).failed, 1);
    const other = await uploadFont(owner, new File([new Uint8Array(bytes)], 'concurrent.png'));
    globalThis.fetch = async () => { await updateFont(owner, other.id, { title: '手工编辑保留' }); return Response.json({ choices: [{ message: { content: JSON.stringify(info) } }] }); };
    await prepareFontOrganization(owner, other.id, true); await runFontOrganization(owner); assert.equal((await getFont(owner, other.id)).title, '手工编辑保留'); assert.equal(fontOrganizationStatus(owner).failed, 1);
    const fallbackStore = writeProviderProfilesStore({ capabilityBindings: [{ capability: 'vision', modelId: 'retired-model', providerId: 'test', enabled: true, isDefault: true, showInPicker: true, updatedAt: now }, { capability: 'chat', modelId: 'available-model', providerId: 'test', enabled: true, isDefault: false, showInPicker: true, updatedAt: now }] });
    assert.equal(fallbackStore.capabilityBindings?.length, 2);
    const attempted: string[] = [];
    globalThis.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)); attempted.push(body.model); return body.model === 'retired-model' ? Response.json({ error: '模型已下架' }, { status: 400 }) : Response.json({ choices: [{ message: { content: JSON.stringify(info) } }] }); };
    await prepareFontOrganization(owner, card.id, true); await runFontOrganization(owner); assert.deepEqual(attempted, ['retired-model', 'available-model']); assert.equal(fontOrganizationStatus(owner).completed, 1);
    console.log(JSON.stringify({ passed: true, checks: ['vision-image-payload', 'strict-json', 'ocr-confidence', 'original-recipe-preserved', 'search-tags', 'auto-group', 'undo', 'manual-edit-conflict', 'single-runner', 'skip-completed', 'api-error', 'invalid-json', 'retired-model-fallback'] }));
  } finally { globalThis.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
}
void main();
