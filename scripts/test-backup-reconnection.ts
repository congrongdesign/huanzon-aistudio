import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSmbMounts, remoteForDirectory, safeSmbUrl, connectionFailure, retryDelay, checkBackupConnection, assertRepository } from '../src/lib/backup-connection';
import { writeArchiveConfig, getArchiveJob, listArchiveEntries } from '../src/lib/project-archive-store';
import { backupWorkerRequest, cachedBackupCatalog, checkBackupRepository, controlBackupJob, ensureBackupService } from '../src/lib/project-backup-service';
import { streamProjectBackup } from '../src/lib/project-backup-stream';
import { createProject, createChatMessage, getProjectById } from '../src/lib/local-backend';
import { DESKTOP_GUEST_USER_ID as userId } from '../src/lib/guest';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/project-archive/route';

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hz-reconnect-'));
  process.env.LOCAL_DATA_DIR = path.join(temp, 'data'); process.env.DESKTOP_GUEST_MODE = '1';
  const root = path.join(temp, 'NAS'); await fs.mkdir(root);
  try {
    const mounts = parseSmbMounts('//user@guyong.local/AIstudio%E5%A4%87%E4%BB%BD on /Volumes/AIstudio备份-1 (smbfs, nodev)\n/dev/disk on / (apfs)');
    assert.equal(mounts.length, 1);
    assert.equal(remoteForDirectory('/Volumes/AIstudio备份-1/folder', mounts)?.relativePath, 'folder');
    assert.equal(remoteForDirectory('/Volumes/AIstudio备份-10', mounts), undefined);
    assert.throws(() => safeSmbUrl('smb://user:password@server/share'));
    assert.throws(() => safeSmbUrl('https://server/share'));
    assert.deepEqual([1, 2, 3, 8].map(retryDelay), [5000, 10000, 20000, 300000]);
    assert.equal(connectionFailure(Object.assign(new Error('denied'), { code: 'EACCES' })), 'permission-denied');
    assert.equal(connectionFailure(Object.assign(new Error('stale'), { code: 'ESTALE' })), 'network-unavailable');
    const config = writeArchiveConfig(root);
    assert.equal((await checkBackupConnection(config)).state, 'connected');
    assert.equal((await checkBackupConnection({ ...config, repositoryId: 'wrong' })).state, 'identity-mismatch');
    const moved = path.join(temp, 'NAS-offline'); await fs.rename(root, moved);
    assert.equal((await checkBackupConnection(config)).state, 'unmounted');
    await assert.rejects(fs.access(root), 'No local folder created under an absent mount');
    await fs.rename(moved, root);
    // Same operation after commit must reuse the package, even if editing continued.
    const project = createProject(userId, '重连测试'); createChatMessage(project.id, userId, 'user', 'before backup');
    const operationId = `archive_${randomUUID()}`;
    const first = await streamProjectBackup({ projectId: project.id, userId, root, baseUrl: '', operationId }, () => {});
    createChatMessage(project.id, userId, 'user', 'after backup');
    const replay = await streamProjectBackup({ projectId: project.id, userId, root, baseUrl: '', operationId }, () => {});
    assert.equal(replay.entry.id, first.entry.id); assert.equal(replay.snapshotHash, first.snapshotHash);
    assert.equal((await listArchiveEntries(root)).length, 1, 'No duplicate version after commit replay');
    // Lose the sidecar after remote rename; reconciliation rebuilds metadata.
    await fs.unlink(path.join(root, first.entry.metaRelativePath));
    const noSidecar = await streamProjectBackup({ projectId: project.id, userId, root, baseUrl: '', operationId }, () => {});
    assert.equal(noSidecar.entry.id, first.entry.id);
    await checkBackupRepository(true);
    for (let n = 0; n < 100 && !cachedBackupCatalog(root).entries.length; n++) await new Promise(resolve => setTimeout(resolve, 50));
    const cachedCount = cachedBackupCatalog(root).entries.length;
    assert(cachedCount > 0);
    await fs.rename(root, moved);
    await checkBackupRepository(true);
    assert.equal(cachedBackupCatalog(root).ready, false);
    assert.equal(cachedBackupCatalog(root).entries.length, cachedCount, 'Offline retains cached cards');
    const request = (body: object) => POST(new NextRequest('http://localhost/api/project-archive', { method: 'POST', body: JSON.stringify(body) }));
    const response = await request({ action: 'archive', targetDir: root, projectIds: [project.id], deleteAfterBackup: false });
    const { jobId } = await response.json(); assert.equal(response.status, 200);
    for (let n = 0; n < 100 && getArchiveJob(jobId)?.status !== 'waiting'; n++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(getArchiveJob(jobId)?.status, 'waiting', JSON.stringify(getArchiveJob(jobId)));
    assert(getProjectById(project.id, userId), 'Disconnect retains the local project');
    assert.equal((await request({ action: 'archive', targetDir: root, projectIds: [project.id] })).status, 409, 'Waiting job locks only its project');
    controlBackupJob(jobId, 'pause'); await fs.rename(moved, root); await checkBackupRepository(true);
    assert.equal(getArchiveJob(jobId)?.status, 'paused', 'Reconnect never resumes a manually paused task');
    // Resume while unavailable, then recover without pressing Continue again.
    await fs.rename(root, moved); controlBackupJob(jobId, 'resume');
    for (let n = 0; n < 100 && getArchiveJob(jobId)?.status !== 'waiting'; n++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(getArchiveJob(jobId)?.status, 'waiting');
    await fs.rename(moved, root); await checkBackupRepository(true); ensureBackupService();
    for (let n = 0; n < 300 && ['queued', 'running', 'waiting'].includes(getArchiveJob(jobId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(getArchiveJob(jobId)?.status, 'completed', JSON.stringify(getArchiveJob(jobId)));
    assert(getProjectById(project.id, userId));
    const foreign = path.join(temp, 'foreign'); await fs.mkdir(foreign); await fs.writeFile(path.join(foreign, '.huanzon-aistudio-repository.json'), JSON.stringify({ id: 'wrong' }));
    assert.throws(() => assertRepository(foreign, config.repositoryId), /身份不匹配/);
    // Preserve worker errno so transport failures can enter the waiting state.
    const fake = path.join(temp, 'errno.cjs'); await fs.writeFile(fake, 'process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({error:"transport failure",code:"EIO"})+"\\n");});');
    process.env.HZ_BACKUP_WORKER_PATH = fake;
    await assert.rejects(backupWorkerRequest({ action: 'scan', root }), (error: unknown) => (error as NodeJS.ErrnoException).code === 'EIO');
    delete process.env.HZ_BACKUP_WORKER_PATH;
    console.log(JSON.stringify({ pass: true, offlineCache: true, waitingAutoResume: true, manualPausePreserved: true, durableCommitReplay: true, sidecarRecovery: true, identityMismatchBlocked: true, errnoPreserved: true }));
  } finally {
    await new Promise(resolve => setTimeout(resolve, 500));
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
