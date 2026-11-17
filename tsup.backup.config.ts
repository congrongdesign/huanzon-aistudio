import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'project-backup-worker': 'src/workers/project-backup-worker.ts', 'library-import-worker': 'src/workers/library-import-worker.ts' },
  outDir: '.desktop-runtime/backup-worker',
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node', target: 'node20', splitting: false,
  noExternal: ['yauzl', 'yazl', 'buffer-crc32', 'pend', 'fd-slicer'],
  external: ['sharp', 'coze-coding-dev-sdk', '@libsql/client'],
});
