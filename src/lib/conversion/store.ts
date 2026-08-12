import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { deleteLocalFileByKey } from "@/lib/local-backend";
import type { ConversionStore, ConversionTaskRecord } from "./types";

const APP_NAME = "环中AIStudio";
const STORE_DIR_NAME = "conversion-center";
const STORE_FILE_NAME = "db.json";

const EMPTY_STORE: ConversionStore = {
  version: 1,
  tasks: [],
};

function nowIso() {
  return new Date().toISOString();
}

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) return path.resolve(process.env.LOCAL_DATA_DIR);
  if (process.env.DESKTOP_ENV_PATH) return path.dirname(process.env.DESKTOP_ENV_PATH);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, APP_NAME);

  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", APP_NAME);
  if (process.platform === "linux") return path.join(home, ".config", APP_NAME);
  return path.join(process.cwd(), ".local-data", APP_NAME);
}

function getStoreRoot() {
  return path.join(getBaseDataDir(), STORE_DIR_NAME);
}

function getStorePath() {
  return path.join(getStoreRoot(), STORE_FILE_NAME);
}

function ensureStore() {
  fs.mkdirSync(getStoreRoot(), { recursive: true });
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(EMPTY_STORE, null, 2), "utf8");
  }
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function ensureStoreShape(raw: unknown): ConversionStore {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STORE };
  const obj = raw as Record<string, unknown>;
  return {
    version: typeof obj.version === "number" ? obj.version : 1,
    tasks: ensureArray<ConversionTaskRecord>(obj.tasks),
  };
}

function readStore(): ConversionStore {
  ensureStore();
  try {
    return ensureStoreShape(JSON.parse(fs.readFileSync(getStorePath(), "utf8")));
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: ConversionStore) {
  ensureStore();
  const storePath = getStorePath();
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempPath, storePath);
}

function withStore<T>(mutator: (store: ConversionStore) => T): T {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

export function createConversionTask(
  userId: string | null,
  input: Omit<ConversionTaskRecord, "id" | "user_id" | "created_at" | "updated_at" | "completed_at">,
) {
  return withStore((store) => {
    const record: ConversionTaskRecord = {
      id: randomUUID(),
      user_id: userId,
      ...input,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };
    store.tasks.push(record);
    return record;
  });
}

export function updateConversionTask(
  taskId: string,
  userId: string | null,
  updates: Partial<Omit<ConversionTaskRecord, "id" | "user_id" | "created_at">>,
) {
  return withStore((store) => {
    const task = store.tasks.find((item) => item.id === taskId && item.user_id === userId);
    if (!task) return null;
    const previousStatus = task.status;
    Object.assign(task, updates);
    task.updated_at = nowIso();
    if (updates.status && ["succeeded", "failed", "canceled"].includes(updates.status) && previousStatus !== updates.status) {
      task.completed_at = nowIso();
    }
    return task;
  });
}

export function listConversionTasks(userId: string | null, projectId?: string | null) {
  const store = readStore();
  return store.tasks
    .filter((task) => task.user_id === userId && (!projectId || task.project_id === projectId))
    .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
}

export function getConversionTask(taskId: string, userId: string | null) {
  const store = readStore();
  return store.tasks.find((task) => task.id === taskId && task.user_id === userId) || null;
}

export function deleteConversionTask(taskId: string, userId: string | null) {
  return withStore((store) => {
    const task = store.tasks.find((item) => item.id === taskId && item.user_id === userId);
    if (!task) return false;
    deleteLocalFileByKey(task.prepared_pdf_key);
    store.tasks = store.tasks.filter((item) => item.id !== taskId);
    return true;
  });
}
