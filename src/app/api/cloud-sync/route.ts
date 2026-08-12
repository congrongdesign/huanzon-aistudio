import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { buildProjectZip, importProjectZip, safeBackupDir } from "@/app/api/project-package/route";
import { isCozeCloudRuntime } from "@/lib/deploy-mode";

type CloudProvider = "folder";

type CloudSyncConfig = {
  provider: CloudProvider;
  syncDir: string;
  updatedAt?: string;
};

type CloudSyncEntry = {
  id: string;
  projectId: string;
  projectName: string;
  fileName: string;
  relativePath: string;
  size: number;
  exportedAt: string;
  updatedAt: string;
  deviceName: string;
  provider: CloudProvider;
};

type CloudSyncIndex = {
  format: "huanzon-aistudio-sync-index";
  version: 1;
  updatedAt: string;
  entries: CloudSyncEntry[];
};

const CONFIG_FILE = "cloud-sync-config.json";
const SYNC_META_DIR = ".huanzon-aistudio-sync";
const INDEX_FILE = "sync-index.json";
const PACKAGE_DIR = "project-packages";

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) return path.resolve(process.env.LOCAL_DATA_DIR);
  if (process.env.DESKTOP_ENV_PATH) return path.dirname(process.env.DESKTOP_ENV_PATH);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "环中AIStudio");
  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "环中AIStudio");
  if (process.platform === "linux") return path.join(home, ".config", "环中AIStudio");
  return path.join(process.cwd(), ".local-data", "环中AIStudio");
}

function normalizeProvider(value: unknown): CloudProvider {
  return value === "folder" ? "folder" : "folder";
}

function getConfigPath(): string {
  return path.join(getBaseDataDir(), CONFIG_FILE);
}

function readConfig(): CloudSyncConfig {
  try {
    const file = getConfigPath();
    if (!fs.existsSync(file)) {
      return { provider: "folder", syncDir: "" };
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CloudSyncConfig>;
    return {
      provider: normalizeProvider(parsed.provider),
      syncDir: typeof parsed.syncDir === "string" ? parsed.syncDir : "",
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { provider: "folder", syncDir: "" };
  }
}

function publicConfig(config = readConfig()) {
  return {
    provider: config.provider,
    syncDir: config.syncDir,
    updatedAt: config.updatedAt,
  };
}

function writeConfig(input: Partial<CloudSyncConfig>): CloudSyncConfig {
  const current = readConfig();
  const next: CloudSyncConfig = {
    provider: "folder",
    syncDir: typeof input.syncDir === "string" ? input.syncDir.trim() : current.syncDir,
    updatedAt: new Date().toISOString(),
  };
  const file = getConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(`${file}.tmp`, file);
  return next;
}

function getSyncRoot(syncDir?: string): string {
  const config = readConfig();
  const raw = (syncDir || config.syncDir || "").trim();
  if (!raw) throw new Error("请先配置同步目录");
  return safeBackupDir(raw);
}

function getIndexPath(syncRoot: string): string {
  return path.join(syncRoot, SYNC_META_DIR, INDEX_FILE);
}

function getPackageDir(syncRoot: string): string {
  return path.join(syncRoot, PACKAGE_DIR);
}

function ensureSyncDir(syncRoot: string): void {
  fs.mkdirSync(path.join(syncRoot, SYNC_META_DIR), { recursive: true });
  fs.mkdirSync(getPackageDir(syncRoot), { recursive: true });
  const indexPath = getIndexPath(syncRoot);
  if (!fs.existsSync(indexPath)) writeIndex(syncRoot, []);
}

function readIndex(syncRoot: string): CloudSyncIndex {
  ensureSyncDir(syncRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(getIndexPath(syncRoot), "utf8")) as Partial<CloudSyncIndex>;
    return {
      format: "huanzon-aistudio-sync-index",
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.filter((entry) => Boolean(entry?.id && entry?.relativePath)) as CloudSyncEntry[]
        : [],
    };
  } catch {
    return writeIndex(syncRoot, []);
  }
}

function writeIndex(syncRoot: string, entries: CloudSyncEntry[]): CloudSyncIndex {
  const index: CloudSyncIndex = {
    format: "huanzon-aistudio-sync-index",
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: entries
      .filter((entry) => Boolean(entry.id && entry.relativePath))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  };
  fs.mkdirSync(path.dirname(getIndexPath(syncRoot)), { recursive: true });
  fs.writeFileSync(`${getIndexPath(syncRoot)}.tmp`, JSON.stringify(index, null, 2), "utf8");
  fs.renameSync(`${getIndexPath(syncRoot)}.tmp`, getIndexPath(syncRoot));
  return index;
}

function resolveEntryPath(syncRoot: string, entry: Pick<CloudSyncEntry, "relativePath">): string {
  const target = path.resolve(syncRoot, entry.relativePath);
  const root = path.resolve(syncRoot);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("非法同步文件路径");
  return target;
}

function sanitizeFilePart(value: string, fallback: string): string {
  return (value || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
}

function getDeviceName(): string {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname() || "未知设备";
}

function listFolderEntries(syncRoot: string): CloudSyncEntry[] {
  const index = readIndex(syncRoot);
  const existing = index.entries.filter((entry) => fs.existsSync(resolveEntryPath(syncRoot, entry)));
  if (existing.length !== index.entries.length) writeIndex(syncRoot, existing);
  return existing;
}

function parseProjectNameFromFile(fileName: string): string {
  return fileName
    .replace(/_\d{4}-\d{2}-\d{2}(?:_[\dTZ.-]+)?\.hzproj\.zip$/i, "")
    .replace(/_[\dTZ-]{15,}\.hzproj\.zip$/i, "")
    .replace(/\.hzproj\.zip$/i, "") || "项目画板";
}

function makePackageFileName(baseFileName: string): { fileName: string; projectName: string } {
  const now = new Date().toISOString();
  const sourceName = baseFileName.replace(/\.hzproj\.zip$/i, "");
  const cleanName = sanitizeFilePart(sourceName, "项目画板");
  const fileName = `${cleanName}_${now.replace(/[:.]/g, "-")}.hzproj.zip`;
  return { fileName, projectName: parseProjectNameFromFile(baseFileName) };
}

async function pushFolderProject(request: NextRequest, syncRoot: string, projectId: string, userId: string | null): Promise<CloudSyncEntry> {
  const { buffer, fileName: sourceFileName } = await buildProjectZip(request, projectId, userId);
  const now = new Date().toISOString();
  const { fileName, projectName } = makePackageFileName(sourceFileName);
  const relativePath = path.posix.join(PACKAGE_DIR, fileName);
  const outputPath = resolveEntryPath(syncRoot, { relativePath });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  const entry: CloudSyncEntry = {
    id: `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    projectName,
    fileName,
    relativePath,
    size: buffer.length,
    exportedAt: now,
    updatedAt: now,
    deviceName: getDeviceName(),
    provider: "folder",
  };
  const entries = [entry, ...listFolderEntries(syncRoot)].slice(0, 200);
  writeIndex(syncRoot, entries);
  return entry;
}

async function restoreFolderEntry(syncRoot: string, entryId: string, userId: string | null) {
  const entry = listFolderEntries(syncRoot).find((item) => item.id === entryId);
  if (!entry) throw new Error("同步项目包不存在");
  const filePath = resolveEntryPath(syncRoot, entry);
  const buffer = fs.readFileSync(filePath);
  const file = new File([new Uint8Array(buffer)], entry.fileName, { type: "application/zip" });
  return importProjectZip(file, userId);
}

function deleteFolderEntry(syncRoot: string, entryId: string): CloudSyncIndex {
  const entries = listFolderEntries(syncRoot);
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) throw new Error("同步记录不存在");
  const filePath = resolveEntryPath(syncRoot, target);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return writeIndex(syncRoot, entries.filter((entry) => entry.id !== entryId));
}

async function statusPayload() {
  const config = readConfig();
  let entries: CloudSyncEntry[] = [];
  let ready = false;
  let error = "";
  try {
    if (config.syncDir.trim()) {
      const syncRoot = getSyncRoot(config.syncDir);
      ensureSyncDir(syncRoot);
      entries = listFolderEntries(syncRoot);
      ready = true;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "读取同步状态失败";
  }
  return {
    config: publicConfig(config),
    ready,
    error,
    entries,
    providers: [
      { id: "folder", name: "NAS / 本地同步目录", available: true, note: "已支持。适合 NAS、移动硬盘、同步盘挂载目录。" },
    ],
  };
}

export async function GET(request: NextRequest) {
  if (isCozeCloudRuntime()) {
    return NextResponse.json({ error: "扣子云端版已关闭本地/局域网同步，请使用账号登录后的云端数据库与对象存储。" }, { status: 403 });
  }

  const userId = getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(await statusPayload());
}

export async function POST(request: NextRequest) {
  try {
    if (isCozeCloudRuntime()) {
      return NextResponse.json({ error: "扣子云端版已关闭本地/局域网同步，请使用账号登录后的云端数据库与对象存储。" }, { status: 403 });
    }

    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await request.json();
    const action = String(body.action || "status");

    if (action === "configure") {
      const config = writeConfig({
        provider: "folder",
        syncDir: String(body.syncDir || ""),
      });
      if (config.syncDir.trim()) ensureSyncDir(getSyncRoot(config.syncDir));
      return NextResponse.json({ success: true, ...(await statusPayload()) });
    }

    if (action === "push") {
      const projectId = String(body.projectId || "");
      if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
      const entry = await pushFolderProject(request, getSyncRoot(), projectId, userId);
      return NextResponse.json({ success: true, entry, ...(await statusPayload()) });
    }

    if (action === "restore") {
      const entryId = String(body.entryId || "");
      if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
      const project = await restoreFolderEntry(getSyncRoot(), entryId, userId);
      return NextResponse.json({ success: true, project, ...(await statusPayload()) });
    }

    if (action === "delete") {
      const entryId = String(body.entryId || "");
      if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
      deleteFolderEntry(getSyncRoot(), entryId);
      return NextResponse.json({ success: true, ...(await statusPayload()) });
    }

    if (action === "refresh") {
      const syncRoot = getSyncRoot();
      ensureSyncDir(syncRoot);
      listFolderEntries(syncRoot);
      return NextResponse.json({ success: true, ...(await statusPayload()) });
    }

    return NextResponse.json({ error: "未知云同步操作" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "云同步操作失败" }, { status: 500 });
  }
}
