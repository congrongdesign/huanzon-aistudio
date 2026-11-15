import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsup', '--config', 'tsup.backup.config.ts'], { stdio: 'inherit' });
for (const runtime of ['.next/standalone', '.next/standalone-win']) {
  if (!fs.existsSync(runtime)) continue;
  fs.mkdirSync(path.join(runtime, 'workers'), { recursive: true });
  fs.copyFileSync('.desktop-runtime/backup-worker/project-backup-worker.cjs', path.join(runtime, 'workers/project-backup-worker.cjs'));
}
