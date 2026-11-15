/** Explicit maintenance command. Audit first; --execute only uses freshly verified NAS assets. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getBaseDataDir } from '../src/lib/runtime-config';
import { mediaFolder, mediaRoots } from '../src/lib/media-storage';
import { activeStorageJobs, collectStorageReferences, fileFingerprint } from '../src/lib/storage-lifecycle';
import { assertArchiveRoot, readArchiveConfig } from '../src/lib/project-archive-store';
import { hashBackupFile, readStreamManifest, verifyBackupFile } from '../src/lib/project-backup-stream';

async function main() {
  const execute = process.argv.includes('--execute');
  const deleteOrphans = process.argv.includes('--delete-orphans');
  const auditArg = process.argv.indexOf('--from-audit');
  const previous = auditArg >= 0 ? JSON.parse(fs.readFileSync(process.argv[auditArg + 1], 'utf8')) : null;
  const reportArg = process.argv.indexOf('--report');
  if (reportArg < 0) throw new Error('必须提供 --report 路径');
  const reportFile = path.resolve(process.argv[reportArg + 1]);
  const config = readArchiveConfig(); const root = config.syncDir; assertArchiveRoot(root);
  if (activeStorageJobs()) throw new Error('任务仍在进行，停止清理');
  const proof = new Map<string, { package: string; archivePath: string; projectName: string; signature: string }>();
  const report = { mode: execute ? 'execute' : 'audit', startedAt: new Date().toISOString(), finishedAt: '', root, repositoryId: config.repositoryId, verifiedPackages: [] as string[], errors: [] as string[], files: [] as { file: string; bytes: number; sha256: string; status: string; reasons: string[]; backup?: object }[], reclaimedBytes: 0, removed: 0 };
  const save = () => { fs.mkdirSync(path.dirname(reportFile), { recursive: true }); const tmp = reportFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(report, null, 2)); fs.renameSync(tmp, reportFile); };
  const packages: string[] = [];
  function visit(folder: string) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.hz(archive|proj)\.zip$/i.test(entry.name)) packages.push(file);
    }
  }
  visit(root); save();
  if (previous) {
    if (!previous.finishedAt || previous.root !== root || previous.repositoryId !== config.repositoryId || Date.now() - Date.parse(previous.finishedAt) > 3600_000) throw new Error('审计凭据失效');
    for (const item of previous.files) if (item.backup?.signature && item.sha256 && item.backup.signature === fileFingerprint(fs.statSync(item.backup.package))) proof.set(`${item.bytes}:${item.sha256}`, item.backup);
    report.verifiedPackages = [...new Set([...proof.values()].map(value => value.package))];
  }
  for (const [index, file] of packages.entries()) {
    console.log(`校验 NAS ${index + 1}/${packages.length} ${path.basename(file)}`);
    if (previous) continue;
    try {
      assertArchiveRoot(root);
      const before = fileFingerprint(fs.statSync(file));
      const metadata = JSON.parse(await fsp.readFile(file + '.meta.json', 'utf8'));
      if (await hashBackupFile(file) !== metadata.checksum) throw new Error('整包 SHA-256 不匹配');
      const manifest = await readStreamManifest(file); await verifyBackupFile(file, manifest);
      if (before !== fileFingerprint(fs.statSync(file))) throw new Error('校验期间备份变化');
      for (const asset of manifest.assets) proof.set(`${asset.size}:${asset.sha256}`, { package: file, archivePath: asset.archivePath, projectName: manifest.projectName, signature: before });
      report.verifiedPackages.push(file); save();
    } catch (error) { report.errors.push(`${file}: ${error instanceof Error ? error.message : error}`); save(); }
  }
  console.log(`已校验 ${report.verifiedPackages.length} 个 NAS 包，核对本机文件`);
  const refs = collectStorageReferences();
  const dbPath = path.join(getBaseDataDir(), 'local-data/db.json');
  const dbHash = createHash('sha256').update(await fsp.readFile(dbPath)).digest('hex');
  const copies: string[] = [];
  for (const mediaRoot of mediaRoots()) {
    const folder = mediaFolder(mediaRoot, 'files'); if (!fs.existsSync(folder)) continue;
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('原图目录为符号链接，停止');
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) if (entry.isFile()) copies.push(path.join(folder, entry.name));
  }
  for (const [index, file] of copies.entries()) {
    if (index % 100 === 0) console.log(`本机核对 ${index + 1}/${copies.length}`);
    const key = path.basename(file); const stat = fs.lstatSync(file); const before = fileFingerprint(stat);
    const hash = await hashBackupFile(file); const backup = proof.get(`${stat.size}:${hash}`); const reasons = refs.reasons(key);
    const item = { file, bytes: stat.size, sha256: hash, status: reasons.length ? 'retained-reference' : backup ? 'verified-backup-candidate' : 'retained-no-backup-proof', reasons, backup };
    report.files.push(item);
    const oldManagedOrphan = deleteOrphans && /_\d{13}_[a-z0-9]{6}\.[a-z0-9]+$/i.test(key) && stat.mtimeMs < Date.now() - 86400_000;
    if (!execute || (!backup && !oldManagedOrphan) || reasons.length) continue;
    assertArchiveRoot(root);
    if (backup && backup.signature !== fileFingerprint(fs.statSync(backup.package))) { item.status = 'retained-backup-changed'; continue; }
    if (activeStorageJobs()) throw new Error('清理期间有任务启动，已停止');
    const latest = collectStorageReferences().reasons(key);
    if (latest.length || before !== fileFingerprint(fs.lstatSync(file))) { item.status = 'retained-changed'; item.reasons = latest; continue; }
    // No await between the last reference check and unlink. Run with the desktop stopped.
    save(); fs.unlinkSync(file); item.status = backup ? 'removed-verified-backup' : 'removed-old-managed-orphan'; report.removed++; report.reclaimedBytes += stat.size;
    if (report.removed % 25 === 0) save();
  }
  if (dbHash !== createHash('sha256').update(await fsp.readFile(dbPath)).digest('hex')) throw new Error('数据库发生变化，请检查');
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ report: reportFile, removed: report.removed, reclaimedBytes: report.reclaimedBytes, retained: report.files.filter(f => f.status.startsWith('retained')).length, errors: report.errors.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
