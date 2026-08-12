import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled } from "@/lib/local-backend";

type LocalInspItem = {
  id: string;
  folder_id: string | null;
  project_id: string | null;
  user_id: string;
  image_url: string;
  image_key: string | null;
  file_name: string | null;
  source: string;
  dominant_color: string | null;
  width: number;
  height: number;
  created_at: string;
};

const localInspItemsStore = new Map<string, LocalInspItem[]>();

function getItems(userId: string) {
  return (localInspItemsStore.get(userId) || []).slice();
}

function setItems(userId: string, items: LocalInspItem[]) {
  localInspItemsStore.set(userId, items);
}

export async function GET(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const folderId = req.nextUrl.searchParams.get("folderId");
  const uncategorizedOnly = folderId === "none";
  const projectId = req.nextUrl.searchParams.get("projectId");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get("pageSize") || "80", 10)));

  if (isLocalBackendEnabled()) {
    let items = getItems(userId);
    if (uncategorizedOnly) items = items.filter((i) => !i.folder_id);
    else if (folderId) items = items.filter((i) => i.folder_id === folderId);
    else if (projectId) items = items.filter((i) => i.project_id === projectId);
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const total = items.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return NextResponse.json({
      items: items.slice(start, end),
      total,
      page,
      pageSize,
      hasMore: end < total,
    });
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("inspiration_items")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (uncategorizedOnly) {
    query = query.is("folder_id", null);
  } else if (folderId) {
    query = query.eq("folder_id", folderId);
  } else if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const total = count || 0;
  return NextResponse.json({
    items: data || [],
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  const { folder_id, project_id, image_url, image_key, file_name, source, dominant_color, width, height } = body;

  if (!image_url) return NextResponse.json({ error: "image_url required" }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const item: LocalInspItem = {
      id: crypto.randomUUID(),
      folder_id: folder_id || null,
      project_id: project_id || null,
      user_id: userId,
      image_url,
      image_key: image_key || null,
      file_name: file_name || null,
      source: source || "upload",
      dominant_color: dominant_color || null,
      width: width || 0,
      height: height || 0,
      created_at: new Date().toISOString(),
    };
    const items = getItems(userId);
    items.push(item);
    setItems(userId, items);
    return NextResponse.json({ item });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("inspiration_items")
    .insert({
      folder_id: folder_id || null,
      project_id: project_id || null,
      user_id: userId,
      image_url,
      image_key: image_key || null,
      file_name: file_name || null,
      source: source || "upload",
      dominant_color: dominant_color || null,
      width: width || 0,
      height: height || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  const { id, folder_id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const items = getItems(userId);
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return NextResponse.json({ error: "item not found" }, { status: 404 });
    items[idx].folder_id = folder_id || null;
    setItems(userId, items);
    return NextResponse.json({ item: items[idx] });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("inspiration_items")
    .update({ folder_id: folder_id || null })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const urlId = req.nextUrl.searchParams.get("id");

  if (isLocalBackendEnabled()) {
    let items = getItems(userId);
    if (urlId) {
      const before = items.length;
      items = items.filter((i) => i.id !== urlId);
      setItems(userId, items);
      if (before === items.length) return NextResponse.json({ error: "item not found" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] = body.ids || [];
    if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
    const idSet = new Set(ids);
    const before = items.length;
    items = items.filter((i) => !idSet.has(i.id));
    setItems(userId, items);
    return NextResponse.json({ success: true, deleted: before - items.length });
  }

  const supabase = getSupabaseClient();
  if (urlId) {
    const { data: item } = await supabase.from("inspiration_items").select("image_key, user_id").eq("id", urlId).single();
    if (!item || item.user_id !== userId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    if (item.image_key) {
      try {
        const { S3Storage } = await import("coze-coding-dev-sdk");
        const storage = new S3Storage();
        await storage.deleteFile(item.image_key);
      } catch {
        // skip
      }
    }
    const { error } = await supabase.from("inspiration_items").delete().eq("id", urlId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = body.ids || [];
  if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const { data: items } = await supabase.from("inspiration_items").select("id, image_key").in("id", ids).eq("user_id", userId);
  if (items) {
    for (const item of items) {
      if (item.image_key) {
        try {
          const { S3Storage } = await import("coze-coding-dev-sdk");
          const storage = new S3Storage();
          await storage.deleteFile(item.image_key);
        } catch {
          // skip
        }
      }
    }
  }

  const { error } = await supabase.from("inspiration_items").delete().in("id", ids).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deleted: ids.length });
}
