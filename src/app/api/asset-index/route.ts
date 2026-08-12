import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createAssetIndexJob,
  getAssetIndexEntryBySource,
  getAssetIndexJobById,
  isLocalBackendEnabled,
  listDesignAssets,
  listImageRecords,
  listAssetIndexJobs,
  updateAssetIndexJob,
  upsertAssetIndexEntry,
} from "@/lib/local-backend";
import {
  buildAssetIndexEntryFromDesignAsset,
  buildAssetIndexEntryFromImageRecord,
  parseStringArray,
} from "@/lib/asset-indexing";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import type { AssetIndexJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  mode?: "full" | "project" | "ids";
  projectId?: string | null;
  sourceType?: "design_asset" | "image_record" | "all";
  ids?: string[];
  includeImageRecords?: boolean;
  includeDesignAssets?: boolean;
  force?: boolean;
  waitForCompletion?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMode(value: unknown): "full" | "project" | "ids" {
  return value === "project" || value === "ids" ? value : "full";
}

function normalizeSourceType(value: unknown): "design_asset" | "image_record" | "all" {
  if (value === "design_asset" || value === "image_record") return value;
  return "all";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeIdList(value: unknown): string[] {
  return parseStringArray(value)
    .map((item) => item.trim())
    .filter((item) => item.length > 8);
}

function normalizeJob(job: AssetIndexJob): AssetIndexJob {
  return {
    ...job,
    params: asObject(job.params),
    stats: asObject(job.stats),
  };
}

function getSourceUpdatedAt(source: { updated_at?: string | null; created_at?: string | null }): string {
  return asString(source.updated_at) || asString(source.created_at);
}

function buildDesignAssetFingerprint(asset: {
  id: string;
  project_id?: string | null;
  kind?: string | null;
  url?: string | null;
  key?: string | null;
  width?: number;
  height?: number;
  metadata?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
}): string {
  return [
    asset.id,
    asString(asset.project_id),
    asString(asset.kind),
    asString(asset.url),
    asString(asset.key),
    String(Math.max(0, Math.round(Number(asset.width) || 0))),
    String(Math.max(0, Math.round(Number(asset.height) || 0))),
    getSourceUpdatedAt(asset),
    JSON.stringify(asObject(asset.metadata)),
  ].join("|");
}

function buildImageRecordFingerprint(record: {
  id: string;
  project_id?: string | null;
  image_url?: string | null;
  image_key?: string | null;
  prompt?: string | null;
  model?: string | null;
  size?: string | null;
  canvas_width?: number;
  canvas_height?: number;
  is_favorite?: boolean;
  reference_images?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}): string {
  return [
    record.id,
    asString(record.project_id),
    asString(record.image_url),
    asString(record.image_key),
    asString(record.prompt),
    asString(record.model),
    asString(record.size),
    String(Math.max(0, Math.round(Number(record.canvas_width) || 0))),
    String(Math.max(0, Math.round(Number(record.canvas_height) || 0))),
    String(Boolean(record.is_favorite)),
    asString(record.reference_images),
    asString(record.status),
    asString(record.deleted_at),
    getSourceUpdatedAt(record),
  ].join("|");
}

function shouldSkipReindex(
  existingMetadata: unknown,
  sourceUpdatedAt: string,
  sourceFingerprint: string,
): boolean {
  const meta = asObject(existingMetadata);
  const existingFingerprint = asString(meta.sourceFingerprint);
  if (existingFingerprint && sourceFingerprint && existingFingerprint === sourceFingerprint) return true;
  const existingSourceUpdatedAt = asString(meta.sourceUpdatedAt);
  if (existingSourceUpdatedAt && sourceUpdatedAt && existingSourceUpdatedAt === sourceUpdatedAt) return true;
  return false;
}

async function runLocalIndexJob(userId: string, input: {
  mode: "full" | "project" | "ids";
  projectId: string | null;
  sourceType: "design_asset" | "image_record" | "all";
  ids: string[];
  includeDesignAssets: boolean;
  includeImageRecords: boolean;
  force: boolean;
}): Promise<{
  job: AssetIndexJob;
  indexedCount: number;
  skippedCount: number;
  failedCount: number;
  sourceCount: number;
  entries: Array<{ id: string; sourceType: string; sourceId: string }>;
}> {
  const startedAt = new Date().toISOString();
  const job = createAssetIndexJob(userId, {
    mode: input.mode,
    project_id: input.projectId,
    status: "running",
    source_count: 0,
    indexed_count: 0,
    failed_count: 0,
    params: {
      sourceType: input.sourceType,
      ids: input.ids,
      includeDesignAssets: input.includeDesignAssets,
      includeImageRecords: input.includeImageRecords,
      force: input.force,
    },
    stats: {},
    started_at: startedAt,
  });

  try {
    const includeDesignAssets = input.sourceType === "all" ? input.includeDesignAssets : input.sourceType === "design_asset";
    const includeImageRecords = input.sourceType === "all" ? input.includeImageRecords : input.sourceType === "image_record";

    let designAssets = includeDesignAssets
      ? listDesignAssets(userId, { projectId: input.projectId || undefined })
      : [];
    let imageRecords = includeImageRecords
      ? listImageRecords(userId, { projectId: input.projectId || undefined, includeDeleted: false, page: 1, pageSize: 5000 }).records
      : [];

    if (input.mode === "ids" && input.ids.length > 0) {
      const idSet = new Set(input.ids);
      designAssets = designAssets.filter((asset) => idSet.has(asset.id));
      imageRecords = imageRecords.filter((record) => idSet.has(record.id));
    }

    const sourceCount = designAssets.length + imageRecords.length;
    updateAssetIndexJob(job.id, userId, { source_count: sourceCount });

    let indexedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const entries: Array<{ id: string; sourceType: string; sourceId: string }> = [];

    for (const asset of designAssets) {
      try {
        const sourceUpdatedAt = getSourceUpdatedAt(asset);
        const sourceCreatedAt = asString(asset.created_at);
        const sourceFingerprint = buildDesignAssetFingerprint(asset);
        if (!input.force) {
          const existing = getAssetIndexEntryBySource(userId, "design_asset", asset.id);
          if (existing && shouldSkipReindex(existing.metadata, sourceUpdatedAt, sourceFingerprint)) {
            skippedCount += 1;
            continue;
          }
        }
        const entry = buildAssetIndexEntryFromDesignAsset(asset);
        const upserted = upsertAssetIndexEntry(userId, {
          ...entry,
          id: undefined,
          metadata: {
            ...entry.metadata,
            indexSource: "asset-index",
            indexedAt: new Date().toISOString(),
            sourceUpdatedAt,
            sourceCreatedAt,
            sourceFingerprint,
          },
        });
        indexedCount += 1;
        entries.push({ id: upserted.id, sourceType: "design_asset", sourceId: asset.id });
      } catch {
        failedCount += 1;
      }
    }

    for (const record of imageRecords) {
      try {
        const sourceUpdatedAt = getSourceUpdatedAt(record);
        const sourceCreatedAt = asString(record.created_at);
        const sourceFingerprint = buildImageRecordFingerprint(record);
        if (!input.force) {
          const existing = getAssetIndexEntryBySource(userId, "image_record", record.id);
          if (existing && shouldSkipReindex(existing.metadata, sourceUpdatedAt, sourceFingerprint)) {
            skippedCount += 1;
            continue;
          }
        }
        const entry = buildAssetIndexEntryFromImageRecord(record);
        const upserted = upsertAssetIndexEntry(userId, {
          ...entry,
          id: undefined,
          metadata: {
            ...entry.metadata,
            indexSource: "asset-index",
            indexedAt: new Date().toISOString(),
            sourceUpdatedAt,
            sourceCreatedAt,
            sourceFingerprint,
          },
        });
        indexedCount += 1;
        entries.push({ id: upserted.id, sourceType: "image_record", sourceId: record.id });
      } catch {
        failedCount += 1;
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
    const updated = updateAssetIndexJob(job.id, userId, {
      status: failedCount > 0 && indexedCount === 0 ? "failed" : "completed",
      indexed_count: indexedCount,
      failed_count: failedCount,
      stats: {
        durationMs,
        sourceCount,
        indexedCount,
        skippedCount,
        failedCount,
        includeDesignAssets,
        includeImageRecords,
        force: input.force,
      },
      completed_at: completedAt,
      error: failedCount > 0 && indexedCount === 0 ? "资产索引全部失败" : null,
      error_code: failedCount > 0 && indexedCount === 0 ? "INDEX_FAILED" : null,
      retryable: failedCount > 0 && indexedCount === 0 ? true : null,
    });

    const finalJob = updated || getAssetIndexJobById(job.id, userId) || job;
    return {
      job: normalizeJob(finalJob),
      indexedCount,
      skippedCount,
      failedCount,
      sourceCount,
      entries,
    };
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "资产索引失败",
      status: 500,
    });
    const failed = updateAssetIndexJob(job.id, userId, {
      status: "failed",
      error: normalized.message,
      error_code: normalized.code,
      retryable: normalized.retryable,
      completed_at: new Date().toISOString(),
    });
    const finalJob = failed || getAssetIndexJobById(job.id, userId) || job;
    return {
      job: normalizeJob(finalJob),
      indexedCount: Number(finalJob.indexed_count || 0),
      skippedCount: Number(asObject(finalJob.stats).skippedCount || 0),
      failedCount: Number(finalJob.failed_count || 0),
      sourceCount: Number(finalJob.source_count || 0),
      entries: [],
    };
  }
}

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    const normalized = normalizeOperationError({ message: "未登录", status: 401 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const status = searchParams.get("status");
    const limit = Number(searchParams.get("limit") || 20);

    if (isLocalBackendEnabled()) {
      const jobs = listAssetIndexJobs(userId, {
        projectId: projectId || null,
        status: status || null,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20,
      }).map((job) => normalizeJob(job));
      return NextResponse.json({ jobs });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("asset_index_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    if (status) query = query.eq("status", status);
    if (Number.isFinite(limit) && limit > 0) query = query.limit(Math.min(limit, 200));
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ jobs: (data || []).map((item) => normalizeJob(item as AssetIndexJob)) });
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "读取索引任务失败",
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    const normalized = normalizeOperationError({ message: "未登录", status: 401 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }

  try {
    const body = await request.json() as RequestBody;
    const mode = normalizeMode(body.mode);
    const sourceType = normalizeSourceType(body.sourceType);
    const projectId = body.projectId || null;
    const ids = normalizeIdList(body.ids);
    const includeDesignAssets = normalizeBoolean(body.includeDesignAssets, true);
    const includeImageRecords = normalizeBoolean(body.includeImageRecords, true);
    const force = normalizeBoolean(body.force, false);
    const waitForCompletion = normalizeBoolean(body.waitForCompletion, true);

    if (mode === "project" && !projectId) {
      const normalized = normalizeOperationError({ message: "project 模式需要 projectId", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    if (mode === "ids" && ids.length === 0) {
      const normalized = normalizeOperationError({ message: "ids 模式需要至少一个 id", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    if (!includeDesignAssets && !includeImageRecords) {
      const normalized = normalizeOperationError({ message: "至少启用一种索引来源", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    if (isLocalBackendEnabled()) {
      const result = await runLocalIndexJob(userId, {
        mode,
        projectId,
        sourceType,
        ids,
        includeDesignAssets,
        includeImageRecords,
        force,
      });

      return NextResponse.json({
        job: result.job,
        summary: {
          sourceCount: result.sourceCount,
          indexedCount: result.indexedCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
          mode,
          sourceType,
        },
        entries: waitForCompletion ? result.entries : [],
      });
    }

    const supabase = getSupabaseClient();
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const insertPayload = {
      id: jobId,
      user_id: userId,
      project_id: projectId,
      mode,
      status: "queued",
      source_count: 0,
      indexed_count: 0,
      failed_count: 0,
      params: {
        sourceType,
        ids,
        includeDesignAssets,
        includeImageRecords,
        force,
      },
      stats: {},
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
      error: null,
      error_code: null,
      retryable: null,
    };
    const { data, error } = await supabase
      .from("asset_index_jobs")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({
      job: normalizeJob(data as AssetIndexJob),
      queued: true,
      summary: {
        sourceCount: 0,
        indexedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        mode,
        sourceType,
      },
      message: "已创建索引任务（Supabase 模式暂为排队占位）",
    });
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "创建索引任务失败",
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
