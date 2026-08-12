import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import {
  createReferenceImage,
  deleteReferenceImage,
  getProjectById,
  isLocalBackendEnabled,
  listReferenceImages,
} from "@/lib/local-backend";

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const fetchAll = searchParams.get("all");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.max(1, Math.min(200, parseInt(searchParams.get("pageSize") || "80", 10)));

    if (isLocalBackendEnabled()) {
      if (!fetchAll && !projectId) {
        return NextResponse.json({ error: "projectId is required (or use ?all=true)" }, { status: 400 });
      }
      const allReferences = listReferenceImages(userId, fetchAll ? undefined : projectId);
      const total = allReferences.length;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const references = allReferences.slice(start, end);
      return NextResponse.json({ references, total, page, pageSize, hasMore: end < total });
    }

    const supabase = getSupabaseClient();

    // Query references via project ownership
    let query = supabase
      .from("reference_images")
      .select("*, projects!inner(user_id)", { count: "exact" })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (!fetchAll && !projectId) {
      return NextResponse.json({ error: "projectId is required (or use ?all=true)" }, { status: 400 });
    }

    if (!fetchAll && projectId) {
      query = query.eq("project_id", projectId);
    }

    query = query.eq("projects.user_id", userId);

    const { data, error, count } = await query.order("created_at", { ascending: true });
    if (error) throw error;

    // Refresh expired presigned URLs using stored image_key
    const s3 = new S3Storage(new S3Config());
    const references = await Promise.all(
      (data || []).map(async (ref: Record<string, unknown>) => {
        if (ref.image_key) {
          try {
            const freshUrl = await s3.generatePresignedUrl({ key: ref.image_key as string });
            ref.image_url = freshUrl;
          } catch {
            // Keep original URL if refresh fails
          }
        }
        // Remove the joined projects data from response
        delete ref.projects;
        return ref;
      })
    );

    const total = count || 0;
    return NextResponse.json({
      references,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch references" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, imageUrl, imageKey, fileName } = body;
    if (!projectId || !imageUrl) {
      return NextResponse.json({ error: "projectId and imageUrl are required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const project = getProjectById(projectId, userId);
      if (!project) {
        return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
      }
      const reference = createReferenceImage(userId, {
        project_id: projectId,
        image_url: imageUrl,
        image_key: imageKey || null,
        file_name: fileName || null,
      });
      return NextResponse.json({ reference });
    }

    // Verify the project belongs to the user
    const supabase = getSupabaseClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (!project) {
      return NextResponse.json({ error: "项目不存在或无权限" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("reference_images")
      .insert({ project_id: projectId, image_url: imageUrl, image_key: imageKey || null, file_name: fileName || null })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ reference: data });
  } catch {
    return NextResponse.json({ error: "Failed to save reference" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const ok = deleteReferenceImage(id, userId);
      if (!ok) {
        return NextResponse.json({ error: "无权限删除此参考图" }, { status: 403 });
      }
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // Verify ownership via project
    const { data: ref } = await supabase
      .from("reference_images")
      .select("id, projects!inner(user_id)")
      .eq("id", id)
      .single();

    if (!ref || (ref.projects as unknown as { user_id: string }[])[0]?.user_id !== userId) {
      return NextResponse.json({ error: "无权限删除此参考图" }, { status: 403 });
    }

    const { error } = await supabase.from("reference_images").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete reference" }, { status: 500 });
  }
}
