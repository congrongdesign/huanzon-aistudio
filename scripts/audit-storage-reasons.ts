import fs from 'node:fs';
import path from 'node:path';
import { collectStorageReferences, storageKeys } from '../src/lib/storage-lifecycle';
import { getBaseDataDir } from '../src/lib/runtime-config';
const base = getBaseDataDir(); const refs = collectStorageReferences();
const totals = new Map<string, { count: number; bytes: number }>();
const files = [];
for (const kind of ['files', 'font-library/files']) {
  const folder = path.join(base, 'local-data', kind);
  if (!fs.existsSync(folder)) continue;
  for (const name of fs.readdirSync(folder)) {
    if (/\.(128|512)\.webp$/.test(name)) continue;
    const file = path.join(folder, name); const stat = fs.lstatSync(file);
    if (!stat.isFile()) continue;
    const reasons = refs.reasons(name);
    const category = reasons.map(r => r.replace(/ · .*/, '').replace(/recipes\/.*\.json/, 'recipes/*.json')).sort().join(', ') || 'unreferenced';
    const total = totals.get(category) || { count: 0, bytes: 0 }; total.count++; total.bytes += stat.size; totals.set(category, total);
    files.push({ file, key: name, bytes: stat.size, reasons });
  }
}
console.log(JSON.stringify([...totals].sort((a,b)=>b[1].bytes-a[1].bytes), null, 2));
fs.writeFileSync('output/storage-lifecycle/current-reference-audit.json', JSON.stringify({ at: new Date().toISOString(), files }, null, 2));
const fontRoot = path.join(base, 'local-data/font-creation');
if (fs.existsSync(fontRoot)) for (const owner of fs.readdirSync(fontRoot)) for (const name of fs.readdirSync(path.join(fontRoot, owner))) {
  if (!name.endsWith('.json')) continue;
  const session = JSON.parse(fs.readFileSync(path.join(fontRoot, owner, name), 'utf8'));
  console.log('font session', name, 'runs', session.runs.length, 'deleted', session.runs.filter((r: { deletedAt?: string }) => r.deletedAt).length, 'keys', storageKeys(session).length);
}
