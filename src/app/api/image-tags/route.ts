import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  createImageTag,
  deleteImageTagById,
  deleteImageTagByImageAndTag,
  isLocalBackendEnabled,
  listImageTagsForImage,
  listImageTagSummary,
} from "@/lib/local-backend";

export async function GET(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  const imageId = req.nextUrl.searchParams.get("imageId");

  if (isLocalBackendEnabled()) {
    if (imageId) {
      const tags = listImageTagsForImage(imageId, userId);
      return NextResponse.json({ tags: tags || [], imageTagMap: {} });
    }

    return NextResponse.json(listImageTagSummary(userId, projectId));
  }

  const supabase = getSupabaseClient();

  if (imageId) {
    // Verify the image belongs to the user
    const { data: img } = await supabase
      .from("image_records")
      .select("id")
      .eq("id", imageId)
      .eq("user_id", userId)
      .single();

    if (!img) {
      return NextResponse.json({ tags: [], imageTagMap: {} });
    }

    const { data, error } = await supabase
      .from("image_tags")
      .select("id, tag, created_at")
      .eq("image_id", imageId)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tags: data });
  }

  // Get all image IDs for this user
  const { data: userImages } = await supabase
    .from("image_records")
    .select("id")
    .eq("user_id", userId)
    .eq("deleted_at", null);

  const userImageIds = (userImages || []).map((r: { id: string }) => r.id);

  if (userImageIds.length === 0) {
    return NextResponse.json({ tags: [], imageTagMap: {} });
  }

  let query = supabase.from("image_tags").select("tag, image_id").order("tag");

  if (projectId) {
    const { data: projectImages } = await supabase
      .from("image_records")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", userId);
    const projectImageIds = (projectImages || []).map((r: { id: string }) => r.id);
    query = query.in("image_id", projectImageIds.length > 0 ? projectImageIds : ["__none__"]);
  } else {
    query = query.in("image_id", userImageIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build both: per-image tag map and aggregated tag counts
  const tagCounts: Record<string, number> = {};
  const imageTagMap: Record<string, string[]> = {};
  for (const row of data || []) {
    tagCounts[row.tag] = (tagCounts[row.tag] || 0) + 1;
    if (!imageTagMap[row.image_id]) imageTagMap[row.image_id] = [];
    imageTagMap[row.image_id].push(row.tag);
  }
  const tags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags, imageTagMap });
}

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  const { imageId, tag } = body;
  if (!imageId || !tag) return NextResponse.json({ error: "imageId and tag required" }, { status: 400 });

  if (isLocalBackendEnabled()) {
    const result = createImageTag(userId, imageId, tag);
    if (result.status === "forbidden") {
      return NextResponse.json({ error: "图片不存在或无权限" }, { status: 403 });
    }
    if (result.status === "duplicate") {
      return NextResponse.json({ error: "Tag already exists" }, { status: 409 });
    }
    return NextResponse.json({ tag: result.tag });
  }

  const supabase = getSupabaseClient();

  // Verify the image belongs to the user
  const { data: img } = await supabase
    .from("image_records")
    .select("id")
    .eq("id", imageId)
    .eq("user_id", userId)
    .single();

  if (!img) {
    return NextResponse.json({ error: "图片不存在或无权限" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("image_tags")
    .insert({ image_id: imageId, tag: tag.trim() })
    .select("id, tag, created_at")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Tag already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tag: data });
}

export async function DELETE(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  let id = params.get("id") || "";
  let imageId = params.get("imageId") || "";
  let tag = params.get("tag") || "";

  if (!id && (!imageId || !tag)) {
    try {
      const body = await req.json();
      id = body.id || "";
      imageId = body.imageId || "";
      tag = body.tag || "";
    } catch {
      // DELETE is also called with query params by the frontend.
    }
  }

  if (isLocalBackendEnabled()) {
    if (id) {
      const ok = deleteImageTagById(id, userId);
      if (!ok) return NextResponse.json({ error: "无权限" }, { status: 403 });
      return NextResponse.json({ success: true });
    }
    if (imageId && tag) {
      const ok = deleteImageTagByImageAndTag(imageId, tag, userId);
      if (!ok) return NextResponse.json({ error: "无权限" }, { status: 403 });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "id or (imageId, tag) required" }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  // If deleting by id, verify ownership first
  if (id) {
    const { data: tagRecord } = await supabase
      .from("image_tags")
      .select("image_id")
      .eq("id", id)
      .single();

    if (tagRecord) {
      const { data: img } = await supabase
        .from("image_records")
        .select("id")
        .eq("id", tagRecord.image_id)
        .eq("user_id", userId)
        .single();

      if (!img) {
        return NextResponse.json({ error: "无权限" }, { status: 403 });
      }
    }

    const { error } = await supabase.from("image_tags").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (imageId && tag) {
    // Verify image ownership
    const { data: img } = await supabase
      .from("image_records")
      .select("id")
      .eq("id", imageId)
      .eq("user_id", userId)
      .single();

    if (!img) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { error } = await supabase.from("image_tags").delete().eq("image_id", imageId).eq("tag", tag);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "id or (imageId, tag) required" }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
