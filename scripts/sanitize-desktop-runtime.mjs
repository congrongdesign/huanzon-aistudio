import fs from 'node:fs';
import path from 'node:path';

const runtime = path.resolve(process.argv[2]);
if (!runtime.startsWith(path.resolve('.next') + path.sep) || !fs.existsSync(path.join(runtime, 'server.js'))) {
  throw new Error('Expected a built standalone directory inside .next');
}
const allowed = new Set(['server.js', 'package.json', 'node_modules', '.next', 'public', 'workers', 'THIRD_PARTY_NOTICES.md']);
for (const name of fs.readdirSync(runtime)) {
  if (!allowed.has(name)) fs.rmSync(path.join(runtime, name), { recursive: true, force: true });
}
for (const name of fs.readdirSync(path.join(runtime, '.next'))) {
  if (name === 'cache') fs.rmSync(path.join(runtime, '.next', name), { recursive: true, force: true });
}
for (const file of ['server.js', '.next/BUILD_ID', 'workers/project-backup-worker.cjs', 'workers/library-import-worker.cjs', 'node_modules/next/package.json']) {
  if (!fs.existsSync(path.join(runtime, file))) throw new Error(`Runtime missing ${file}`);
}
console.log('Standalone sanitized; no developer data or root environment files included.');
