import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  hardDeleteImageRecord,
  isLocalBackendEnabled,
  listImageRecords,
  softDeleteImageRecord,
  updateImageRecord,
  upsertImageRecord,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";

const FAILED_HISTORY_STATUSES = new Set(["failed", "error", "cancelled"]);

function isClearableFailedHistoryRecord(record: { status?: unknown; image_url?: unknown }) {
  const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
  const imageUrl = typeof record.image_url === "string" ? record.image_url.trim() : "";
  if (FAILED_HISTORY_STATUSES.has(status)) return true;
  return !imageUrl && status !== "completed" && status !== "running" && status !== "generating";
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const includeDeleted = searchParams.get("includeDeleted") === "true";

    if (isLocalBackendEnabled()) {
      const { records, total } = listImageRecords(userId, {
        projectId,
        page,
        pageSize,
        includeDeleted,
      });
      return NextResponse.json({
        records,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      });
    }

    const supabase = getSupabaseClient();

    let query = supabase
      .from("image_records")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const s3 = new S3Storage(new S3Config());
    const records = await Promise.all(
      (data || []).map(async (record: Record<string, unknown>) => {
        if (record.image_key) {
          try {
            const freshUrl = await s3.generatePresignedUrl({ key: record.image_key as string });
            record.image_url = freshUrl;
          } catch {
            // ignore
          }
        }
        return record;
      }),
    );

    return NextResponse.json({
      records,
      total: count || 0,
      page,
      pageSize,
      hasMore: page * pageSize < (count || 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const {
      id,
      projectId,
      prompt,
      imageUrl,
      imageKey,
      size,
      model,
      referenceImages,
      canvasBlockId,
      blockOrder,
      canvasX,
      canvasY,
      canvasWidth,
      canvasHeight,
    } = body;

    if (!id || !projectId) {
      return NextResponse.json({ error: "id and projectId are required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const record = upsertImageRecord({
        id,
        project_id: projectId,
        user_id: userId,
        prompt: prompt || "",
        image_url: imageUrl || "",
        image_key: imageKey || null,
        size: size || "1:1",
        model: model || "gpt-image-2",
        status: "completed",
        is_favorite: false,
        reference_images: referenceImages ? JSON.stringify(referenceImages) : null,
        canvas_block_id: canvasBlockId || null,
        block_order: Math.round(blockOrder ?? 0),
        canvas_x: Math.round(canvasX ?? 40),
        canvas_y: Math.round(canvasY ?? 40),
        canvas_width: Math.round(canvasWidth ?? 320),
        canvas_height: Math.round(canvasHeight ?? 320),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        edited_image_key: null,
      });
      return NextResponse.json({ success: true, record });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("image_records")
      .upsert(
        {
          id,
          project_id: projectId,
          user_id: userId,
          prompt: prompt || "",
          image_url: imageUrl || null,
          image_key: imageKey || null,
          size: size || "1:1",
          model: model || "gpt-image-2",
          status: "completed",
          is_favorite: false,
          reference_images: referenceImages ? JSON.stringify(referenceImages) : null,
          canvas_block_id: canvasBlockId || null,
          block_order: Math.round(blockOrder ?? 0),
          canvas_x: Math.round(canvasX ?? 40),
          canvas_y: Math.round(canvasY ?? 40),
          canvas_width: Math.round(canvasWidth ?? 320),
          canvas_height: Math.round(canvasHeight ?? 320),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "id" },
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, record: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Insert failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      const record = updateImageRecord(id, userId, {
        is_favorite: updates.is_favorite,
        canvas_block_id: updates.canvas_block_id,
        block_order: updates.block_order,
        canvas_x: updates.canvas_x,
        canvas_y: updates.canvas_y,
        canvas_width: updates.canvas_width,
        canvas_height: updates.canvas_height,
        deleted_at: updates.restore !== undefined ? null : undefined,
      });
      if (!record) {
        return NextResponse.json({ error: "Record not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, record });
    }

    const supabase = getSupabaseClient();
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.is_favorite !== undefined) updateData.is_favorite = updates.is_favorite;
    if (updates.canvas_block_id !== undefined) updateData.canvas_block_id = updates.canvas_block_id;
    if (updates.block_order !== undefined) updateData.block_order = Math.round(updates.block_order);
    if (updates.canvas_x !== undefined) updateData.canvas_x = Math.round(updates.canvas_x);
    if (updates.canvas_y !== undefined) updateData.canvas_y = Math.round(updates.canvas_y);
    if (updates.canvas_width !== undefined) updateData.canvas_width = Math.round(updates.canvas_width);
    if (updates.canvas_height !== undefined) updateData.canvas_height = Math.round(updates.canvas_height);
    if (updates.restore !== undefined) updateData.deleted_at = null;

    const { data, error } = await supabase
      .from("image_records")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, record: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let id: string | null = searchParams.get("id");
    let permanent = searchParams.get("permanent") === "true";
    let clearFailed = searchParams.get("clearFailed") === "true";

    try {
      const body = await request.json();
      id = body.id || null;
      permanent = body.permanent === true;
      clearFailed = clearFailed || body.clearFailed === true || body.action === "clearFailed";
    } catch {
      // ignore
    }

    if (clearFailed) {
      if (isLocalBackendEnabled()) {
        const { records } = listImageRecords(userId, { includeDeleted: false, pageSize: 100000 });
        const failedRecords = records.filter(isClearableFailedHistoryRecord);
        const deletedIds: string[] = [];
        for (const record of failedRecords) {
          if (softDeleteImageRecord(record.id, userId)) deletedIds.push(record.id);
        }
        return NextResponse.json({ success: true, deletedCount: deletedIds.length, ids: deletedIds });
      }

      const supabase = getSupabaseClient();
      const { data: records, error: selectError } = await supabase
        .from("image_records")
        .select("id, status, image_url")
        .eq("user_id", userId)
        .is("deleted_at", null);

      if (selectError) throw selectError;

      const ids = (records || [])
        .filter(isClearableFailedHistoryRecord)
        .map((record: { id: string }) => record.id);

      if (ids.length > 0) {
        const { error: updateError } = await supabase
          .from("image_records")
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .in("id", ids);

        if (updateError) throw updateError;
      }

      return NextResponse.json({ success: true, deletedCount: ids.length, ids });
    }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (isLocalBackendEnabled()) {
      if (permanent) {
        const ok = hardDeleteImageRecord(id, userId);
        if (!ok) return NextResponse.json({ error: "记录不存在或无权限" }, { status: 403 });
      } else {
        const record = softDeleteImageRecord(id, userId);
        if (!record) return NextResponse.json({ error: "记录不存在或无权限" }, { status: 403 });
      }
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    if (permanent) {
      const { data: record } = await supabase
        .from("image_records")
        .select("image_key, edited_image_key")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (!record) {
        return NextResponse.json({ error: "记录不存在或无权限" }, { status: 403 });
      }

      const s3 = new S3Storage(new S3Config());
      const keysToDelete = [record.image_key, record.edited_image_key].filter(Boolean) as string[];
      for (const key of keysToDelete) {
        try {
          await s3.deleteFile({ fileKey: key });
        } catch {
          // ignore
        }
      }

      const { error } = await supabase
        .from("image_records")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("image_records")
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId);

      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
