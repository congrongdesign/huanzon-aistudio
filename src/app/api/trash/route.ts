import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import {
  hardDeleteImageRecord,
  hardDeleteTrashedBefore,
  isLocalBackendEnabled,
  listImageRecords,
  restoreImageRecord,
} from "@/lib/local-backend";

// GET /api/trash - list soft-deleted records
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (isLocalBackendEnabled()) {
      const { records } = listImageRecords(userId, {
        projectId,
        includeDeleted: true,
        page: 1,
        pageSize: 10000,
      });
      const trashed = records.filter((r) => r.deleted_at);
      return NextResponse.json({ records: trashed });
    }

    const supabase = getSupabaseClient();

    let query = supabase
      .from("image_records")
      .select("*")
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Refresh presigned URLs
    const s3 = new S3Storage(new S3Config());
    const records = await Promise.all(
      (data || []).map(async (record: Record<string, unknown>) => {
        if (record.image_key) {
          try {
            const freshUrl = await s3.generatePresignedUrl({ key: record.image_key as string });
            record.image_url = freshUrl;
          } catch {
            // Keep original URL if refresh fails
          }
        }
        return record;
      })
    );

    return NextResponse.json({ records });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/trash - restore a soft-deleted record
export async function POST(request: NextRequest) {
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
      const record = restoreImageRecord(id, userId);
      if (!record) {
        return NextResponse.json({ error: "记录不存在或无权限" }, { status: 403 });
      }
      return NextResponse.json({ success: true, record });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("image_records")
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, record: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/trash - permanently delete records
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, ids, olderThanDays } = body as { id?: string; ids?: string[]; olderThanDays?: number };

    if (isLocalBackendEnabled()) {
      if (Array.isArray(ids) && ids.length > 0) {
        let deleted = 0;
        for (const itemId of ids) {
          if (hardDeleteImageRecord(itemId, userId)) deleted += 1;
        }
        return NextResponse.json({ success: true, deleted });
      }
      if (id) {
        const ok = hardDeleteImageRecord(id, userId);
        if (!ok) {
          return NextResponse.json({ error: "记录不存在或无权限" }, { status: 403 });
        }
      } else if (olderThanDays) {
        hardDeleteTrashedBefore(userId, Number(olderThanDays));
      } else {
        return NextResponse.json({ error: "id、ids 或 olderThanDays 至少提供一个" }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    const deleteS3KeysIfUnreferenced = async (candidateKeys: string[]) => {
      const uniqueKeys = [...new Set(candidateKeys.filter(Boolean))];
      if (uniqueKeys.length === 0) return;
      const { data: archivedRefs } = await supabase
        .from("archived_images")
        .select("image_key")
        .eq("user_id", userId)
        .in("image_key", uniqueKeys);
      const archivedKeySet = new Set((archivedRefs || []).map((item: { image_key?: string | null }) => item.image_key).filter(Boolean));
      const s3 = new S3Storage(new S3Config());
      for (const key of uniqueKeys) {
        if (archivedKeySet.has(key)) continue;
        try { await s3.deleteFile({ fileKey: key }); } catch { /* ignore */ }
      }
    };

    if (Array.isArray(ids) && ids.length > 0) {
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      const { data: records } = await supabase
        .from("image_records")
        .select("id, image_key, edited_image_key")
        .eq("user_id", userId)
        .in("id", uniqueIds);

      if (!records || records.length === 0) {
        return NextResponse.json({ success: true, deleted: 0 });
      }

      await deleteS3KeysIfUnreferenced(records.flatMap((rec) => [rec.image_key, rec.edited_image_key].filter(Boolean) as string[]));

      const deleteIds = records.map((r: { id: string }) => r.id);
      const { error } = await supabase
        .from("image_records")
        .delete()
        .eq("user_id", userId)
        .in("id", deleteIds);
      if (error) throw error;
      return NextResponse.json({ success: true, deleted: deleteIds.length });
    }

    if (id) {
      // Permanently delete a specific record - verify ownership
      const { data: record } = await supabase
        .from("image_records")
        .select("image_key, edited_image_key")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (!record) {
        return NextResponse.json({ error: "记录不存在或无权限" }, { status: 403 });
      }

      if (record) {
        await deleteS3KeysIfUnreferenced([record.image_key, record.edited_image_key].filter(Boolean) as string[]);
      }

      const { error } = await supabase
        .from("image_records")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);

      if (error) throw error;
    } else if (olderThanDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);

      const { data: oldRecords } = await supabase
        .from("image_records")
        .select("id, image_key, edited_image_key")
        .eq("user_id", userId)
        .not("deleted_at", "is", null)
        .lt("deleted_at", cutoff.toISOString());

      if (oldRecords && oldRecords.length > 0) {
        await deleteS3KeysIfUnreferenced(oldRecords.flatMap((rec) => [rec.image_key, rec.edited_image_key].filter(Boolean) as string[]));

        const ids = oldRecords.map((r: { id: string }) => r.id);
        const { error } = await supabase
          .from("image_records")
          .delete()
          .in("id", ids);

        if (error) throw error;
      }
    } else {
      return NextResponse.json({ error: "id、ids 或 olderThanDays 至少提供一个" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
