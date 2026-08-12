import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled } from "@/lib/local-backend";

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

function listLocalLibraries(userId: string | null, projectId?: string | null): LocalPromptLibrary[] {
  ensureDefaultLocalLibrary(userId);
  const store = readLocalStore();
  return store.libraries
    .filter((lib) => lib.user_id === userId && (!projectId || lib.project_id === null || lib.project_id === projectId))
    .sort((a, b) => (b.is_default - a.is_default) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function createLocalLibrary(userId: string | null, input: { projectId?: string | null; name: string; description?: string }): LocalPromptLibrary {
  const store = readLocalStore();
  const now = new Date().toISOString();
  const library: LocalPromptLibrary = {
    id: Math.max(0, ...store.libraries.map((lib) => lib.id || 0)) + 1,
    user_id: userId,
    project_id: input.projectId || null,
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

function updateLocalLibrary(userId: string | null, id: number, patch: { name?: string; description?: string }): LocalPromptLibrary | null {
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

function deleteLocalLibrary(userId: string | null, id: number): { ok: boolean; error?: string } {
  const store = readLocalStore();
  const target = store.libraries.find((lib) => lib.id === id && lib.user_id === userId);
  if (!target) return { ok: false, error: "提示词库不存在" };
  if (target.is_default === 1) return { ok: false, error: "不能删除默认提示词库" };
  store.libraries = store.libraries.filter((lib) => !(lib.id === id && lib.user_id === userId));
  writeLocalStore(store);
  return { ok: true };
}

// GET /api/prompt-libraries - List libraries
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: listLocalLibraries(userId, projectId) });
    }

    const supabase = getSupabaseClient();
    // Always include global libraries (no project_id) + project-specific ones
    let query = supabase.from("prompt_libraries").select("*").order("is_default", { ascending: false }).order("created_at", { ascending: true });

    if (projectId) {
      query = query.or(`project_id.is.null,project_id.eq.${projectId}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // If no libraries exist for this project, check if there's a global default
    if (!data || data.length === 0) {
      const { data: globalDefault } = await supabase
        .from("prompt_libraries")
        .select("*")
        .eq("is_default", 1)
        .limit(1);

      if (globalDefault && globalDefault.length > 0) {
        // Return the global default library
        return NextResponse.json({ data: globalDefault });
      }

      // No default exists at all, create one without project_id
      const { data: newLib } = await supabase
        .from("prompt_libraries")
        .insert({ project_id: null, name: "默认提示词库", description: "", is_default: 1 })
        .select()
        .single();
      return NextResponse.json({ data: newLib ? [newLib] : [] });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error("Get libraries error:", error);
    return NextResponse.json({ error: "获取提示词库列表失败" }, { status: 500 });
  }
}

// POST /api/prompt-libraries - Create library
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const projectId = body.project_id ?? body.projectId ?? null;
    const { name, description } = body;
    if (!name?.trim()) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = createLocalLibrary(userId, { projectId, name, description });
      return NextResponse.json({ data, id: data.id });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("prompt_libraries")
      .insert({ project_id: projectId, name: name.trim(), description: description || "", is_default: 0 })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Create library error:", error);
    return NextResponse.json({ error: "创建提示词库失败" }, { status: 500 });
  }
}

// PATCH /api/prompt-libraries - Update library
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id, name, description } = await request.json();
    if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const data = updateLocalLibrary(userId, Number(id), { name, description });
      if (!data) return NextResponse.json({ error: "提示词库不存在" }, { status: 404 });
      return NextResponse.json({ data });
    }

    const supabase = getSupabaseClient();
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabase.from("prompt_libraries").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Update library error:", error);
    return NextResponse.json({ error: "更新提示词库失败" }, { status: 500 });
  }
}

// DELETE /api/prompt-libraries - Delete library
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

    if (isLocalBackendEnabled()) {
      const result = deleteLocalLibrary(userId, Number(id));
      if (!result.ok) return NextResponse.json({ error: result.error || "删除失败" }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // Check if default
    const { data: lib } = await supabase.from("prompt_libraries").select("is_default").eq("id", id).single();
    if (lib?.is_default === 1) return NextResponse.json({ error: "不能删除默认提示词库" }, { status: 400 });

    // Delete all related data
    await supabase.from("prompt_atom").delete().eq("library_id", id);
    await supabase.from("prompt_package").delete().eq("library_id", id);
    await supabase.from("prompt_template").delete().eq("library_id", id);
    await supabase.from("prompt_versions").delete().eq("library_id", id);
    await supabase.from("prompt_libraries").delete().eq("id", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete library error:", error);
    return NextResponse.json({ error: "删除提示词库失败" }, { status: 500 });
  }
}
