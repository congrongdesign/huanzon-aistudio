/** Rebuild the last verified 235-card collection, without replacing current user data.
 * Preview: pnpm exec tsx scripts/recover-independent-prompts.ts
 * Apply only while the desktop service is stopped: ... --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { recoverIndependentPrompts, type LocalPromptRecord } from '../src/lib/local-backend';
const root = process.cwd();
const json = (name: string) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const owner = '00000000-0000-4000-8000-000000000001';
const baseline = json('output/prompt-curation/landscapes/before-import.json').prompts as LocalPromptRecord[];
const report = json('output/prompt-curation/landscapes/import-report.json') as { projectId: string; imported: { id: string; key: string; category: string }[] };
const collection = json('data/prompt-curation/design-prompts-2026-11-15.json').prompts as {key: string; name: string; text: string; previewUrl: string; tags: string[]; source: object}[];
const dataRoot = process.env.LOCAL_DATA_DIR;
if (!dataRoot) throw new Error('必须明确指定 LOCAL_DATA_DIR');
const groups = jsonAbsolute(path.join(dataRoot, 'local-data/prompt-libraries.json')).libraries as {id: number; name: string; user_id: string}[];
function jsonAbsolute(file: string) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
const recovered: LocalPromptRecord[] = [...baseline];
for (const entry of report.imported) {
  const source = collection.find(c => c.key === entry.key), group = groups.find(g => g.name === entry.category && g.user_id === owner);
  if (!source || !group) throw new Error('恢复来源或分组缺失：' + entry.key);
  recovered.push({ id: entry.id, user_id: owner, project_id: report.projectId, text: source.text, content: source.text, name: source.name, category: `group:${group.id}`, library_id: group.id, image_url: source.previewUrl, tags: JSON.stringify(source.tags), source: JSON.stringify(source.source), created_at: '2026-11-15T10:43:35.485Z' });
}
if (baseline.length !== 194 || recovered.length !== 235 || new Set(recovered.map(r => r.id)).size !== 235) throw new Error('恢复数量不符');
for (const row of recovered) {
  if (!row.text || row.user_id !== owner || !row.image_url?.startsWith('/prompt-previews/')) throw new Error('记录无效');
  if (!fs.existsSync(path.join(root, 'public', row.image_url))) throw new Error('预览图缺失：' + row.id);
}
const digest = createHash('sha256').update(JSON.stringify(recovered)).digest('hex');
const output = path.join(root, 'output/prompt-integrity'); fs.mkdirSync(output, {recursive:true});
fs.writeFileSync(path.join(output,'recovery-plan.json'), JSON.stringify({ count: recovered.length, digest, records: recovered, limits: '194条来自完整快照；41条正文、分组、来源和原编号来自最终导入材料，其创建时间为批次完成时间。无法证明包含后续人工修改。' }, null, 2));
if (process.argv.includes('--apply')) {
  const result = recoverIndependentPrompts(owner, recovered, 'verified-235-2026-11-17');
  fs.writeFileSync(path.join(output, 'recovery-result.json'), JSON.stringify({ ...result, digest, at: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ added: result.added.length, skipped: result.skipped.length, digest }));
} else console.log(JSON.stringify({ ready: true, count: recovered.length, previews: 235, digest }));
