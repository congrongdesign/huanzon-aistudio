import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isCozeCloudRuntime } from "@/lib/deploy-mode";
import { createArchiveJob, getArchiveJob, getArchiveRoot, getStoredArchiveJob, listStoredArchiveJobs, readArchiveConfig } from "@/lib/project-archive-store";
import { backupConnectionStatus, checkBackupRepository, backupWorkerRequest, cachedBackupCatalog, controlBackupJob, ensureBackupService, refreshBackupCatalog, saveBackupCatalog } from "@/lib/project-backup-service";
import type { ProjectArchiveEntry } from "@/lib/project-archive-types";

function archiveDisabled() {
  return isCozeCloudRuntime()
    ? NextResponse.json({ error: "扣子云端版不支持写入本机或 NAS 目录" }, { status: 403 })
    : null;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(request: NextRequest) {
  const disabled = archiveDisabled();
  if (disabled) return disabled;
  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  ensureBackupService();

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getArchiveJob(jobId);
    if (!job || getStoredArchiveJob(jobId)?.payload.userId !== userId) return NextResponse.json({ error: "备份任务不存在" }, { status: 404 });
    return NextResponse.json({ job });
  }

  const requestedDir = request.nextUrl.searchParams.get("syncDir") || "";
  const config = readArchiveConfig();
  const targetDir = requestedDir || config.syncDir;
  const catalog = cachedBackupCatalog(targetDir);
  refreshBackupCatalog(targetDir);
  const entries = catalog.entries.filter(entry => !entry.ownerId || entry.ownerId === userId);
  const connection = backupConnectionStatus();
  const ready = catalog.ready && connection.state === 'connected';
  const error = ready || connection.state === 'checking' ? '' : catalog.error || connection.message;
  return NextResponse.json({
    config: { ...config, syncDir: targetDir },
    ready,
    connection,
    error,
    entries,
    jobs: listStoredArchiveJobs().filter(job => job.payload.userId === userId).slice(0, 20).map(({ payload: _payload, ...job }) => job),
  });
}

export async function POST(request: NextRequest) {
  try {
    const disabled = archiveDisabled();
    if (disabled) return disabled;
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    ensureBackupService();

    const body = await request.json();
    const action = String(body.action || "");

    if (action === 'reconnect') {
      await checkBackupRepository(true);
      refreshBackupCatalog(readArchiveConfig().syncDir, true);
      return NextResponse.json({ success: true, connection: backupConnectionStatus() });
    }

    if (["pause", "resume", "cancel"].includes(action)) {
      const jobId = String(body.jobId || "");
      if (getStoredArchiveJob(jobId)?.payload.userId !== userId) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      return NextResponse.json({ success: true, job: controlBackupJob(jobId, action as "pause" | "resume" | "cancel") });
    }
    if (["browse-directory", "validate-directory", "create-directory"].includes(action)) {
      return NextResponse.json(await backupWorkerRequest({ ...body, userId }, { timeout: 15000 }));
    }
    if (action === "configure") {
      const targetDir = String(body.targetDir || body.syncDir || "").trim();
      const root = getArchiveRoot(targetDir);
      const result = await backupWorkerRequest<{ config: object; entries: ProjectArchiveEntry[] }>({ action, root, userId }, { timeout: 15000 });
      saveBackupCatalog(root, result.entries);
      await checkBackupRepository(true);
      return NextResponse.json({ success: true, config: result.config });
    }
    if (action === "refresh") {
      const root = getArchiveRoot(String(body.targetDir || readArchiveConfig().syncDir || ""));
      refreshBackupCatalog(root, true);
      return NextResponse.json({ success: true, entries: cachedBackupCatalog(root).entries });
    }
    if (action === "delete") {
      const root = getArchiveRoot(String(body.targetDir || readArchiveConfig().syncDir || ""));
      const entryIds = Array.isArray(body.entryIds) ? body.entryIds.map(String) : [String(body.entryId || "")].filter(Boolean);
      if (!entryIds.length) return NextResponse.json({ error: "请选择版本" }, { status: 400 });
      const result = await backupWorkerRequest<{ entries: ProjectArchiveEntry[] }>({ action, root, userId, entryIds }, { timeout: 15000 });
      saveBackupCatalog(root, result.entries);
      return NextResponse.json({ success: true, deleted: entryIds.length });
    }

    if (action === "archive" || action === "cleanup") {
      const projectIds: string[] = Array.isArray(body.projectIds)
        ? Array.from(new Set<string>(body.projectIds.map(String).filter(Boolean)))
        : [];
      if (projectIds.length === 0) return NextResponse.json({ error: "请选择要归档的项目" }, { status: 400 });
      if (projectIds.length > 50) return NextResponse.json({ error: "单次最多归档 50 个项目" }, { status: 400 });
      const targetDir = String(body.targetDir || readArchiveConfig().syncDir || "").trim();
      if (!targetDir) return NextResponse.json({ error: "请填写 NAS / 本地归档目录" }, { status: 400 });
      const root = getArchiveRoot(targetDir);
      const backupEntryByProject: Record<string, string> = {};
      if (action === "cleanup") {
        for (const id of projectIds) {
          const entry = cachedBackupCatalog(root).entries.find(e => e.projectId === id && (!e.ownerId || e.ownerId === userId));
          if (!entry) return NextResponse.json({ error: "项目尚无备份，请先备份" }, { status: 400 });
          backupEntryByProject[id] = entry.id;
        }
      }
      const active = listStoredArchiveJobs().find(job => job.payload.userId === userId && ["queued", "running", "waiting", "paused"].includes(job.status) && job.payload.projectIds?.some(id => projectIds.includes(id)));
      if (active) return NextResponse.json({ error: "所选项目已有备份任务，请等待完成", jobId: active.id }, { status: 409 });
      const job = createArchiveJob("archive", root, projectIds.length, {
        userId,
        projectIds,
        deleteAfterBackup: body.deleteAfterBackup !== false,
        removeOnly: action === "cleanup",
        backupEntryByProject,
        baseUrl: request.nextUrl.origin,
      });
      ensureBackupService();
      return NextResponse.json({ success: true, jobId: job.id, job });
    }

    if (action === "restore") {
      const entryIds: string[] = Array.isArray(body.entryIds)
        ? Array.from(new Set<string>(body.entryIds.map(String).filter(Boolean)))
        : [String(body.entryId || "")].filter(Boolean);
      if (entryIds.length === 0) return NextResponse.json({ error: "请选择要恢复的项目包" }, { status: 400 });
      const targetDir = String(body.targetDir || readArchiveConfig().syncDir || "").trim();
      if (!targetDir) return NextResponse.json({ error: "请填写 NAS / 本地归档目录" }, { status: 400 });
      const root = getArchiveRoot(targetDir);
      const active = listStoredArchiveJobs().find(job => job.payload.userId === userId && ["queued", "running", "waiting", "paused"].includes(job.status) && job.payload.entryIds?.some(id => entryIds.includes(id)));
      if (active) return NextResponse.json({ error: "此版本正在恢复，请等待完成", jobId: active.id }, { status: 409 });
      const job = createArchiveJob("restore", root, entryIds.length, {
        userId,
        entryIds,
      });
      ensureBackupService();
      return NextResponse.json({ success: true, jobId: job.id, job });
    }

    return NextResponse.json({ error: "未知归档操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: toMessage(error, "归档操作失败") }, { status: 500 });
  }
}
