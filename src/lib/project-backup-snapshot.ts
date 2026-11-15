import { createHash } from 'node:crypto';
import type { ProjectArchiveSnapshot } from './project-archive-types';

// Compare content, independent of object key ordering in old exporters.
export function backupSnapshotHash(snapshot: ProjectArchiveSnapshot): string {
  const stable = (value: unknown): unknown => Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
      : value;
  return createHash('sha256').update(JSON.stringify(stable(snapshot))).digest('hex');
}
