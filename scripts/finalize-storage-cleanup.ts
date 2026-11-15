/** Explicit historical maintenance, with a durable per-file report. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { activeStorageJobs, collectStorageReferences, fontTrash, purgeFontTrash } from '../src/lib/storage-lifecycle';
import { deleteLocalFileByKey, drainLocalFileCleanup } from '../src/lib/local-backend';
import { getBaseDataDir } from '../src/lib/runtime-config';

const execute = process.argv.includes('--execute');
const base = getBaseDataDir();
const owner = '00000000-0000-4000-8000-000000000001';
const reportArg = process.argv.indexOf('--report');
const reportFile = path.resolve(reportArg < 0 ? 'output/storage-lifecycle/final-cleanup.json' : process.argv[reportArg + 1]);
if (fs.existsSync(reportFile)) throw new Error('报告已存在，请指定新的 --report 路径');
const report = { at: new Date().toISOString(), execute, fontRecords: [] as string[], files: [] as { file: string; bytes: number; sha256: string; reason: string }[], bytes: 0 };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
if (activeStorageJobs()) throw new Error('有任务正在执行，停止清理');
const history = ['history-cleanup.json', 'history-cleanup-followup.json'].map(name => JSON.parse(fs.readFileSync(path.join(path.dirname(reportFile), name), 'utf8')));
const proven = new Map<string, { sha256: string; bytes: number }>();
for (const audit of history) for (const file of audit.files) if (file.status.startsWith('removed-')) proven.set(path.basename(file.file), file);
save();
// Only legacy copies of the exact bytes already authorized and deleted above.
const legacy = path.join(path.dirname(base), 'projects', 'local-data', 'files');
const refs = collectStorageReferences();
for (const folder of [legacy, path.join(base, 'local-data', 'files')]) if (fs.existsSync(folder)) for (const name of fs.readdirSync(folder)) {
  const evidence = proven.get(name); if (!evidence || refs.used(name)) continue;
  const file = path.join(folder, name); const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== evidence.bytes) continue;
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha256 !== evidence.sha256) continue;
  report.files.push({ file, bytes: info.size, sha256, reason: 'legacy duplicate of verified historical junk' }); save();
  if (execute) { fs.unlinkSync(file); report.bytes += info.size; save(); }
}
// User explicitly requested clearing historical deleted works. Active cards,
// draft references and exports remain protected by the central collector.
for (const item of fontTrash(owner)) {
  report.fontRecords.push(item.id); save();
  if (execute) {
    for (const key of purgeFontTrash(owner, item.id) || []) deleteLocalFileByKey(key);
  }
}
if (execute) for (let n = 0; n < 30; n++) {
  const result = drainLocalFileCleanup(); report.bytes += result.bytes; save();
  if (!result.removed) break;
}
save(); console.log(JSON.stringify({ reportFile, removedLegacyFiles: report.files.length, purgedFontRecords: report.fontRecords.length, reclaimedBytes: report.bytes }));
