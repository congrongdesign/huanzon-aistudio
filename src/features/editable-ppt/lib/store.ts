import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { deleteLocalFileByKey } from "@/lib/local-backend";
import type {
  EditablePptConfig,
  EditablePptElementRecord,
  EditablePptExportRecord,
  EditablePptJobDetail,
  EditablePptJobRecord,
  EditablePptPageRecord,
  EditablePptStore,
} from "./types";

const APP_NAME = "环中AIStudio";
const STORE_DIR_NAME = "editable-ppt";
const STORE_FILE_NAME = "db.json";

const EMPTY_STORE: EditablePptStore = {
  version: 1,
  jobs: [],
  pages: [],
  elements: [],
  exports: [],
};

function nowIso() {
  return new Date().toISOString();
}

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) {
    return path.resolve(process.env.LOCAL_DATA_DIR);
  }

  if (process.env.DESKTOP_ENV_PATH) {
    return path.dirname(process.env.DESKTOP_ENV_PATH);
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_NAME);
  }

  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }
  if (process.platform === "linux") {
    return path.join(home, ".config", APP_NAME);
  }
  return path.join(process.cwd(), ".local-data", APP_NAME);
}

function getStoreRoot() {
  return path.join(getBaseDataDir(), STORE_DIR_NAME);
}

function getStorePath() {
  return path.join(getStoreRoot(), STORE_FILE_NAME);
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function ensureStoreShape(raw: unknown): EditablePptStore {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STORE };
  const obj = raw as Record<string, unknown>;
  return {
    version: typeof obj.version === "number" ? obj.version : 1,
    jobs: ensureArray<EditablePptJobRecord>(obj.jobs),
    pages: ensureArray<EditablePptPageRecord>(obj.pages),
    elements: ensureArray<EditablePptElementRecord>(obj.elements),
    exports: ensureArray<EditablePptExportRecord>(obj.exports),
  };
}

function ensureStore() {
  fs.mkdirSync(getStoreRoot(), { recursive: true });
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(EMPTY_STORE, null, 2), "utf8");
  }
}

function readStore(): EditablePptStore {
  ensureStore();
  try {
    return ensureStoreShape(JSON.parse(fs.readFileSync(getStorePath(), "utf8")));
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: EditablePptStore) {
  ensureStore();
  const storePath = getStorePath();
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempPath, storePath);
}

function withStore<T>(mutator: (store: EditablePptStore) => T): T {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function createEditablePptJob(
  userId: string | null,
  input: Omit<EditablePptJobRecord, "id" | "user_id" | "created_at" | "updated_at" | "completed_at" | "failed_at">,
) {
  return withStore((store) => {
    const now = nowIso();
    const record: EditablePptJobRecord = {
      id: randomUUID(),
      user_id: userId,
      ...input,
      created_at: now,
      updated_at: now,
      completed_at: null,
      failed_at: null,
    };
    store.jobs.push(record);
    return record;
  });
}

export function updateEditablePptJob(
  jobId: string,
  userId: string | null,
  updates: Partial<Omit<EditablePptJobRecord, "id" | "user_id" | "created_at">>,
) {
  return withStore((store) => {
    const job = store.jobs.find((item) => item.id === jobId && item.user_id === userId);
    if (!job) return null;
    Object.assign(job, updates);
    job.updated_at = nowIso();
    if (updates.status === "ready") {
      job.completed_at = nowIso();
      job.failed_at = null;
    } else if (updates.status === "failed") {
      job.failed_at = nowIso();
    }
    return job;
  });
}

export function listEditablePptJobs(userId: string | null, projectId?: string | null) {
  const store = readStore();
  return store.jobs
    .filter((job) => job.user_id === userId && (!projectId || job.project_id === projectId))
    .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
}

export function getEditablePptJob(jobId: string, userId: string | null) {
  const store = readStore();
  return store.jobs.find((job) => job.id === jobId && job.user_id === userId) || null;
}

export function listEditablePptPages(jobId: string, userId: string | null) {
  const job = getEditablePptJob(jobId, userId);
  if (!job) return [];
  const store = readStore();
  return store.pages
    .filter((page) => page.job_id === jobId)
    .sort((a, b) => a.page_number - b.page_number);
}

export function getEditablePptPage(pageId: string, userId: string | null) {
  const store = readStore();
  const page = store.pages.find((item) => item.id === pageId);
  if (!page) return null;
  const job = store.jobs.find((item) => item.id === page.job_id && item.user_id === userId);
  return job ? page : null;
}

export function replaceEditablePptPages(jobId: string, userId: string | null, pages: EditablePptPageRecord[]) {
  return withStore((store) => {
    const job = store.jobs.find((item) => item.id === jobId && item.user_id === userId);
    if (!job) return [];
    const previousPages = store.pages.filter((item) => item.job_id === jobId);
    previousPages.forEach((page) => {
      deleteLocalFileByKey(page.preview_image_key);
      deleteLocalFileByKey(page.cleaned_background_key);
      if (pages.every((nextPage) => nextPage.id !== page.id)) {
        deleteLocalFileByKey(page.source_image_key);
      }
    });
    store.pages = store.pages.filter((item) => item.job_id !== jobId);
    store.pages.push(...pages);
    return pages;
  });
}

export function updateEditablePptPage(
  pageId: string,
  userId: string | null,
  updates: Partial<Omit<EditablePptPageRecord, "id" | "job_id" | "created_at">>,
) {
  return withStore((store) => {
    const page = store.pages.find((item) => item.id === pageId);
    if (!page) return null;
    const job = store.jobs.find((item) => item.id === page.job_id && item.user_id === userId);
    if (!job) return null;
    Object.assign(page, updates);
    page.updated_at = nowIso();
    return page;
  });
}

export function listEditablePptElementsByPage(pageId: string, userId: string | null) {
  const page = getEditablePptPage(pageId, userId);
  if (!page) return [];
  const store = readStore();
  return store.elements
    .filter((item) => item.page_id === pageId)
    .sort((a, b) => a.z_index - b.z_index);
}

export function replaceEditablePptElementsForPage(
  pageId: string,
  jobId: string,
  userId: string | null,
  elements: EditablePptElementRecord[],
) {
  return withStore((store) => {
    const job = store.jobs.find((item) => item.id === jobId && item.user_id === userId);
    if (!job) return [];
    const oldElements = store.elements.filter((item) => item.page_id === pageId);
    oldElements.forEach((element) => {
      if (element.asset_key && elements.every((next) => next.id !== element.id)) {
        deleteLocalFileByKey(element.asset_key);
      }
    });
    store.elements = store.elements.filter((item) => item.page_id !== pageId);
    store.elements.push(...elements);
    return elements;
  });
}

export function updateEditablePptElement(
  elementId: string,
  userId: string | null,
  updates: Partial<Omit<EditablePptElementRecord, "id" | "job_id" | "page_id" | "created_at">>,
) {
  return withStore((store) => {
    const element = store.elements.find((item) => item.id === elementId);
    if (!element) return null;
    const job = store.jobs.find((item) => item.id === element.job_id && item.user_id === userId);
    if (!job) return null;
    Object.assign(element, updates);
    element.updated_at = nowIso();
    return element;
  });
}

export function createEditablePptExport(
  userId: string | null,
  input: Omit<EditablePptExportRecord, "id" | "user_id" | "created_at" | "updated_at" | "completed_at">,
) {
  return withStore((store) => {
    const now = nowIso();
    const record: EditablePptExportRecord = {
      id: randomUUID(),
      user_id: userId,
      ...input,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    store.exports.push(record);
    return record;
  });
}

export function updateEditablePptExport(
  exportId: string,
  userId: string | null,
  updates: Partial<Omit<EditablePptExportRecord, "id" | "job_id" | "user_id" | "created_at">>,
) {
  return withStore((store) => {
    const record = store.exports.find((item) => item.id === exportId && item.user_id === userId);
    if (!record) return null;
    Object.assign(record, updates);
    record.updated_at = nowIso();
    if (updates.status === "ready") record.completed_at = nowIso();
    return record;
  });
}

export function listEditablePptExports(jobId: string, userId: string | null) {
  const store = readStore();
  return store.exports
    .filter((item) => item.job_id === jobId && item.user_id === userId)
    .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
}

export function getEditablePptJobDetail(jobId: string, userId: string | null): EditablePptJobDetail | null {
  const job = getEditablePptJob(jobId, userId);
  if (!job) return null;
  const pages = listEditablePptPages(jobId, userId);
  const store = readStore();
  const elements = store.elements.filter((item) => item.job_id === jobId);
  const elementsByPage = pages.reduce<Record<string, EditablePptElementRecord[]>>((acc, page) => {
    acc[page.id] = elements.filter((item) => item.page_id === page.id).sort((a, b) => a.z_index - b.z_index);
    return acc;
  }, {});
  return {
    job,
    pages,
    elementsByPage,
    exports: listEditablePptExports(jobId, userId),
  };
}

export function deleteEditablePptJobCascade(jobId: string, userId: string | null) {
  return withStore((store) => {
    const job = store.jobs.find((item) => item.id === jobId && item.user_id === userId);
    if (!job) return false;

    const pages = store.pages.filter((item) => item.job_id === jobId);
    pages.forEach((page) => {
      deleteLocalFileByKey(page.source_image_key);
      deleteLocalFileByKey(page.preview_image_key);
      deleteLocalFileByKey(page.cleaned_background_key);
    });

    store.elements
      .filter((item) => item.job_id === jobId)
      .forEach((element) => deleteLocalFileByKey(element.asset_key));

    store.exports
      .filter((item) => item.job_id === jobId && item.user_id === userId)
      .forEach((record) => deleteLocalFileByKey(record.file_key));

    store.jobs = store.jobs.filter((item) => !(item.id === jobId && item.user_id === userId));
    store.pages = store.pages.filter((item) => item.job_id !== jobId);
    store.elements = store.elements.filter((item) => item.job_id !== jobId);
    store.exports = store.exports.filter((item) => !(item.job_id === jobId && item.user_id === userId));
    return true;
  });
}

export function parseWarnings(value: string | null | undefined) {
  return parseJsonArray(value);
}

export function serializeWarnings(values: string[]) {
  return JSON.stringify(Array.from(new Set(values.filter(Boolean))));
}

export function serializeConfig(config: EditablePptConfig) {
  return JSON.stringify(config);
}

export function parseConfig<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(value) as object) } as T;
  } catch {
    return fallback;
  }
}
