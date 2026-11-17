import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsup', '--config', 'tsup.backup.config.ts'], { stdio: 'inherit' });
if (process.platform === 'darwin') {
  execFileSync('xcrun', ['clang', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', 'scripts/nas-mount-macos.c', '-framework', 'CoreFoundation', '-framework', 'NetFS', '-o', '.desktop-runtime/backup-worker/nas-mount-macos'], { stdio: 'inherit' });
}
const runtimes = [...new Set([`${process.env.HZ_NEXT_DIST_DIR || '.next'}/standalone`, '.next/standalone-win'])];
for (const runtime of runtimes) {
  if (!fs.existsSync(runtime)) continue;
  fs.mkdirSync(path.join(runtime, 'workers'), { recursive: true });
  fs.copyFileSync('.desktop-runtime/backup-worker/project-backup-worker.cjs', path.join(runtime, 'workers/project-backup-worker.cjs'));
  fs.copyFileSync('.desktop-runtime/backup-worker/library-import-worker.cjs', path.join(runtime, 'workers/library-import-worker.cjs'));
}

if (process.platform === 'darwin') {
  const target = `${process.env.HZ_NEXT_DIST_DIR || '.next'}/standalone/workers`;
  if (fs.existsSync(target)) fs.copyFileSync('.desktop-runtime/backup-worker/nas-mount-macos', path.join(target, 'nas-mount-macos'));
}
