import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { createProject, createImageRecord, createChatMessage, saveBinaryFile, updateProject, getProjectById, exportLocalProjectSnapshot, resolveLocalFilePath } from '../src/lib/local-backend';
import { DESKTOP_GUEST_USER_ID as owner } from '../src/lib/guest';
import { GET, POST } from '../src/app/api/project-archive/route';
import { getArchiveJob, listStoredArchiveJobs } from '../src/lib/project-archive-store';
import { backupWorkerRequest, cachedBackupCatalog } from '../src/lib/project-backup-service';
import { readStreamManifest, verifyBackupFile } from '../src/lib/project-backup-stream';

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hz-backup-isolation-'));
  process.env.LOCAL_DATA_DIR = path.join(temp, 'app'); process.env.DESKTOP_GUEST_MODE = '1';
  const root = path.join(temp, 'NAS'); await fs.mkdir(root);
  const request = (body: object) => POST(new NextRequest('http://localhost/api/project-archive', { method: 'POST', body: JSON.stringify(body) }));
  const configure = await request({ action: 'configure', targetDir: root }); assert.equal(configure.status, 200, await configure.clone().text());
  const projects = [createProject(owner, '并发编辑 A'), createProject(owner, '并发编辑 B')];
  const image = saveBinaryFile(await sharp(randomBytes(1500 * 1500 * 3), { raw: { width: 1500, height: 1500, channels: 3 } }).png().toBuffer(), 'noise.png');
  for (const p of projects) {
    createImageRecord({ user_id: owner, project_id: p.id, image_key: image.key, image_url: image.url, prompt: 'snapshot', status: 'completed', canvas_x: 729, canvas_y: 831 });
    createChatMessage(p.id, owner, 'user', '备份前对话');
  }
  const started = await request({ action: 'archive', projectIds: projects.map(p => p.id), targetDir: root, deleteAfterBackup: true });
  assert.equal(started.status, 200); const jobId = (await started.json()).jobId;
  assert.equal((await request({ action: 'archive', projectIds: [projects[0].id], targetDir: root })).status, 409);
  assert.equal((await request({ action: 'pause', jobId })).status, 200);
  assert.equal(getArchiveJob(jobId)?.status, 'paused');
  // Editing continues while a backup is paused and after resuming.
  updateProject(projects[0].id, owner, { name: '备份期间改过的名称' });
  assert.equal((await request({ action: 'resume', jobId })).status, 200);
  const latencies: number[] = []; let edits = 0;
  for (let n = 0; n < 1000 && ['queued', 'running'].includes(getArchiveJob(jobId)?.status || ''); n++) {
    const start = performance.now();
    const response = await GET(new NextRequest('http://localhost/api/project-archive'));
    assert.equal(response.status, 200); latencies.push(performance.now() - start);
    createChatMessage(projects[0].id, owner, 'user', `并发编辑 ${edits++}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const completed = getArchiveJob(jobId)!; assert.equal(completed.status, 'completed', JSON.stringify(completed));
  assert.equal(completed.completed, 2);
  assert.equal(getProjectById(projects[1].id, owner), null, 'unchanged project automatically removed');
  assert.equal(completed.results.find(r => r.projectId === projects[1].id)?.originalRemoved, true);
  assert.equal(completed.results.find(r => r.projectId === projects[0].id)?.originalRemoved, false, 'concurrent edits must remain');
  assert.equal(getProjectById(projects[0].id, owner)?.name, '备份期间改过的名称');
  assert(exportLocalProjectSnapshot(projects[0].id, owner).chatMessages.length >= edits + 1);
  assert(Math.max(...latencies) < 500, `Catalog reads blocked: ${Math.max(...latencies)}ms`);
  const entry = cachedBackupCatalog(root).entries.find(e => e.projectId === projects[0].id)!;
  const file = path.join(root, entry.relativePath); const manifest = await readStreamManifest(file); await verifyBackupFile(file, manifest);
  assert.equal(manifest.data.imageRecords[0].canvas_x, 729);
  const restoreResponse = await request({ action: 'restore', entryIds: [entry.id], targetDir: root }); assert.equal(restoreResponse.status, 200);
  const restoreId = (await restoreResponse.json()).jobId;
  for (let n = 0; n < 1000 && ['queued', 'running'].includes(getArchiveJob(restoreId)?.status || ''); n++) {
    createChatMessage(projects[0].id, owner, 'user', `恢复期间编辑 ${n}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const restored = getArchiveJob(restoreId)!; assert.equal(restored.status, 'completed', JSON.stringify(restored));
  const copyId = restored.results[0].restoredProjectId!;
  assert.notEqual(copyId, projects[0].id); assert(getProjectById(copyId, owner)?.name.endsWith('（恢复副本）'));
  const snapshot = exportLocalProjectSnapshot(copyId, owner);
  assert.equal(snapshot.imageRecords[0].canvas_x, 729); assert.equal(snapshot.imageRecords[0].canvas_y, 831);
  assert.deepEqual(await fs.readFile(resolveLocalFilePath(String(snapshot.imageRecords[0].image_key))), await fs.readFile(resolveLocalFilePath(image.key)));
  const cancelResponse = await request({ action: 'archive', projectIds: [projects[1].id], targetDir: root }); const cancelId = (await cancelResponse.json()).jobId;
  assert.equal((await request({ action: 'cancel', jobId: cancelId })).status, 200); assert.equal(getArchiveJob(cancelId)?.status, 'cancelled');
  // A hung/failing child must time out without blocking the editing event loop.
  const actualWorker = process.env.HZ_BACKUP_WORKER_PATH;
  const fake = path.join(temp, 'hung.cjs'); await fs.writeFile(fake, 'process.stdin.resume();setInterval(()=>{},1000);');
  process.env.HZ_BACKUP_WORKER_PATH = fake;
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  await assert.rejects(() => backupWorkerRequest({ action: 'scan', root }, { timeout: 200 }), /超时/);
  clearInterval(timer); assert(ticks >= 8, 'Child timeout blocked main thread');
  const failing = path.join(temp, 'failed.cjs');
  await fs.writeFile(failing, 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({error:"NAS unavailable"})+"\\n",()=>process.exit(1)));');
  process.env.HZ_BACKUP_WORKER_PATH = failing;
  const retryProject = createProject(owner, '失败重试保留');
  createImageRecord({ user_id: owner, project_id: retryProject.id, image_key: image.key, image_url: image.url, status: 'completed', prompt: 'retry' });
  const retryResponse = await request({ action: 'archive', projectIds: [retryProject.id], targetDir: root });
  const retryId = (await retryResponse.json()).jobId;
  for (let n = 0; n < 200 && ['queued', 'running'].includes(getArchiveJob(retryId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(getArchiveJob(retryId)?.status, 'partial');
  assert(getProjectById(retryProject.id, owner), 'failed backup retains project');
  if (actualWorker) process.env.HZ_BACKUP_WORKER_PATH = actualWorker; else delete process.env.HZ_BACKUP_WORKER_PATH;
  assert.equal((await request({ action: 'resume', jobId: retryId })).status, 200);
  for (let n = 0; n < 500 && ['queued', 'running'].includes(getArchiveJob(retryId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(getArchiveJob(retryId)?.status, 'completed', JSON.stringify(getArchiveJob(retryId)));
  assert.equal(getProjectById(retryProject.id, owner), null, 'successful retry removes project');
  const existing = await request({ action: 'archive', projectIds: [projects[0].id], targetDir: root, deleteAfterBackup: false });
  const existingId = (await existing.json()).jobId;
  for (let n = 0; n < 500 && ['queued', 'running'].includes(getArchiveJob(existingId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(getProjectById(projects[0].id, owner));
  const cleanup = await request({ action: 'cleanup', projectIds: [projects[0].id], targetDir: root });
  assert.equal(cleanup.status, 200);
  const cleanupId = (await cleanup.json()).jobId;
  for (let n = 0; n < 500 && ['queued', 'running'].includes(getArchiveJob(cleanupId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(getArchiveJob(cleanupId)?.status, 'completed', JSON.stringify(getArchiveJob(cleanupId)));
  assert.equal(getProjectById(projects[0].id, owner), null, 'previously backed up project removed after verification');
  const removedEntry = cachedBackupCatalog(root).entries.find(e => e.projectId === projects[1].id)!;
  const recover = await request({ action: 'restore', entryIds: [removedEntry.id], targetDir: root });
  const recoverId = (await recover.json()).jobId;
  for (let n = 0; n < 500 && ['queued', 'running'].includes(getArchiveJob(recoverId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(getArchiveJob(recoverId)?.status, 'completed', JSON.stringify(getArchiveJob(recoverId)));
  assert(getProjectById(projects[1].id, owner), 'removed project can be restored to its original ID');
  assert.equal(exportLocalProjectSnapshot(projects[1].id, owner).imageRecords[0].canvas_y, 831);
  for (let n = 0; n < 40 && listStoredArchiveJobs().some(j => j.status === 'running'); n++) await new Promise(resolve => setTimeout(resolve, 25));
  const unique = saveBinaryFile(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ba2345' } }).png().toBuffer(), 'unique.png');
  const uniqueProject = createProject(owner, '独占原图释放');
  createImageRecord({ user_id: owner, project_id: uniqueProject.id, image_key: unique.key, image_url: unique.url, prompt: 'unique', status: 'completed' });
  const uniqueResponse = await request({ action: 'archive', projectIds: [uniqueProject.id], targetDir: root });
  const uniqueId = (await uniqueResponse.json()).jobId;
  for (let n = 0; n < 500 && ['queued', 'running'].includes(getArchiveJob(uniqueId)?.status || ''); n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(getArchiveJob(uniqueId)?.status, 'completed', JSON.stringify(getArchiveJob(uniqueId)));
  for (let n = 0; n < 100; n++) { try { await fs.access(resolveLocalFilePath(unique.key)); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
  await assert.rejects(() => fs.access(resolveLocalFilePath(unique.key)), 'unique archived original must be physically reclaimed');
  const uniqueEntry = cachedBackupCatalog(root).entries.find(e => e.projectId === uniqueProject.id)!;
  const uniqueManifest = await readStreamManifest(path.join(root, uniqueEntry.relativePath));
  await verifyBackupFile(path.join(root, uniqueEntry.relativePath), uniqueManifest);
  console.log(JSON.stringify({ pass: true, projectsBackedUp: 2, concurrentEdits: edits, maxCatalogReadMs: Math.round(Math.max(...latencies)), pauseResumeCancel: true, isolatedRestore: true, hungWorkerTimeout: true }));
  // Background metadata/scans may still be settling; keep this isolated fixture for diagnostics.
}
main().catch(error => { console.error(error); process.exitCode = 1; });
