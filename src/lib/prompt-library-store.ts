import fs from "fs";
import path from "path";

interface LocalPromptLibrary {
  id: number;
  user_id: string | null;
  project_id: string | null;
  name: string;
  description: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface LocalPromptLibraryStore {
  libraries: LocalPromptLibrary[];
  updatedAt?: string;
}

function getBaseDataDir(): string {
  if (process.env.LOCAL_DATA_DIR) return path.resolve(process.env.LOCAL_DATA_DIR);
  if (process.env.DESKTOP_ENV_PATH) return path.dirname(process.env.DESKTOP_ENV_PATH);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "环中AIStudio");
  const home = process.env.HOME || process.cwd();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "环中AIStudio");
  if (process.platform === "linux") return path.join(home, ".config", "环中AIStudio");
  return path.join(process.cwd(), ".local-data", "环中AIStudio");
}

function getLocalStorePath(): string {
  return path.join(getBaseDataDir(), "local-data", "prompt-libraries.json");
}

function readLocalStore(): LocalPromptLibraryStore {
  try {
    const file = getLocalStorePath();
    if (!fs.existsSync(file)) return { libraries: [] };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LocalPromptLibraryStore;
    return { libraries: Array.isArray(parsed.libraries) ? parsed.libraries : [], updatedAt: parsed.updatedAt };
  } catch {
    return { libraries: [] };
  }
}

function writeLocalStore(store: LocalPromptLibraryStore): void {
  const file = getLocalStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...store, updatedAt: new Date().toISOString() };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

function ensureDefaultLocalLibrary(userId: string | null): LocalPromptLibrary {
  const store = readLocalStore();
  const existing = store.libraries.find((lib) => lib.user_id === userId && lib.is_default === 1);
  if (existing) return existing;
  const now = new Date().toISOString();
  const library: LocalPromptLibrary = {
    id: Math.max(0, ...store.libraries.map((lib) => lib.id || 0)) + 1,
    user_id: userId,
    project_id: null,
    name: "默认提示词库",
    description: "",
    is_default: 1,
    created_at: now,
    updated_at: now,
  };
  store.libraries.push(library);
  writeLocalStore(store);
  return library;
}

export function listLocalLibraries(userId: string | null, projectId?: string | null): LocalPromptLibrary[] {
  void projectId;
  ensureDefaultLocalLibrary(userId);
  const store = readLocalStore();
  return store.libraries
    .filter((lib) => lib.user_id === userId)
    .sort((a, b) => (b.is_default - a.is_default) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function createLocalLibrary(userId: string | null, input: { projectId?: string | null; name: string; description?: string }): LocalPromptLibrary {
  const store = readLocalStore();
  const now = new Date().toISOString();
  const library: LocalPromptLibrary = {
    id: Math.max(0, ...store.libraries.map((lib) => lib.id || 0)) + 1,
    user_id: userId,
    project_id: null,
    name: input.name.trim(),
    description: input.description || "",
    is_default: 0,
    created_at: now,
    updated_at: now,
  };
  store.libraries.push(library);
  writeLocalStore(store);
  return library;
}

export function updateLocalLibrary(userId: string | null, id: number, patch: { name?: string; description?: string }): LocalPromptLibrary | null {
  const store = readLocalStore();
  const idx = store.libraries.findIndex((lib) => lib.id === id && lib.user_id === userId);
  if (idx < 0) return null;
  store.libraries[idx] = {
    ...store.libraries[idx],
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    updated_at: new Date().toISOString(),
  };
  writeLocalStore(store);
  return store.libraries[idx];
}

export function deleteLocalLibrary(userId: string | null, id: number): { ok: boolean; error?: string } {
  const store = readLocalStore();
  const target = store.libraries.find((lib) => lib.id === id && lib.user_id === userId);
  if (!target) return { ok: false, error: "提示词库不存在" };
  if (target.is_default === 1) return { ok: false, error: "不能删除默认提示词库" };
  store.libraries = store.libraries.filter((lib) => !(lib.id === id && lib.user_id === userId));
  writeLocalStore(store);
  return { ok: true };
}
