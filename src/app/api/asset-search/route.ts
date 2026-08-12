import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { listAssetIndexEntries, isLocalBackendEnabled } from "@/lib/local-backend";
import {
  extractSearchHighlights,
  matchesAssetSearchFilters,
  parseStringArray,
  scoreAssetIndexEntry,
  topFacet,
  type AssetSearchFilters,
} from "@/lib/asset-indexing";
import { normalizeOperationError, toOperationErrorPayload } from "@/lib/operation-error";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import type { AssetIndexEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchRequestBody = {
  query?: string;
  projectId?: string | null;
  sourceType?: "design_asset" | "image_record" | null;
  kinds?: string[] | string;
  models?: string[] | string;
  sizes?: string[] | string;
  tags?: string[] | string;
  tagMode?: "any" | "all";
  limit?: number;
  offset?: number;
  sortBy?: "relevance" | "recent";
  includeFacets?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceType(value: unknown): "design_asset" | "image_record" | null {
  if (value === "design_asset" || value === "image_record") return value;
  return null;
}

function normalizeSortBy(value: unknown): "relevance" | "recent" {
  return value === "recent" ? "recent" : "relevance";
}

function normalizeTagMode(value: unknown): "any" | "all" {
  return value === "all" ? "all" : "any";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeFilters(body: SearchRequestBody): AssetSearchFilters {
  return {
    projectId: body.projectId || null,
    sourceType: normalizeSourceType(body.sourceType),
    kinds: parseStringArray(body.kinds),
    models: parseStringArray(body.models),
    sizes: parseStringArray(body.sizes),
    tags: parseStringArray(body.tags),
    tagMode: normalizeTagMode(body.tagMode),
  };
}

function normalizeEntry(raw: unknown): AssetIndexEntry | null {
  const obj = asObject(raw);
  const sourceType = obj.source_type === "image_record" ? "image_record" : (obj.source_type === "design_asset" ? "design_asset" : null);
  if (!sourceType) return null;
  const sourceId = asString(obj.source_id);
  const url = asString(obj.url);
  if (!sourceId || !url) return null;

  const metadata = asObject(obj.metadata);
  const tags = parseStringArray(obj.tags);
  const keywords = parseStringArray(obj.keywords);
  const kind = asString(obj.kind) || (sourceType === "image_record" ? "image_record" : "image");

  return {
    id: asString(obj.id),
    user_id: asString(obj.user_id) || null,
    project_id: asString(obj.project_id) || null,
    source_type: sourceType,
    source_id: sourceId,
    kind: kind as AssetIndexEntry["kind"],
    url,
    key: asString(obj.key) || null,
    width: Math.max(0, Math.round(asNumber(obj.width, 0))),
    height: Math.max(0, Math.round(asNumber(obj.height, 0))),
    prompt: asString(obj.prompt),
    model: asString(obj.model),
    size: asString(obj.size),
    tags,
    caption: asString(obj.caption),
    ocr_text: asString(obj.ocr_text),
    dominant_color: asString(obj.dominant_color) || null,
    keywords,
    metadata,
    created_at: asString(obj.created_at) || new Date().toISOString(),
    updated_at: asString(obj.updated_at) || null,
  };
}

function compareByRecent(a: AssetIndexEntry, b: AssetIndexEntry): number {
  const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
  const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
  return bTime - aTime;
}

function toSearchPayload(entries: AssetIndexEntry[], query: string, sortBy: "relevance" | "recent") {
  const scored = entries.map((entry) => ({
    entry,
    score: query ? scoreAssetIndexEntry(entry, query) : 0,
    highlights: query ? extractSearchHighlights(entry, query) : [],
  }));

  if (query && sortBy === "relevance") {
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareByRecent(a.entry, b.entry);
    });
  } else {
    scored.sort((a, b) => compareByRecent(a.entry, b.entry));
  }

  return scored;
}

function buildFacets(entries: AssetIndexEntry[]) {
  return {
    models: topFacet(entries.map((entry) => entry.model), 12),
    sizes: topFacet(entries.map((entry) => entry.size), 12),
    tags: topFacet(entries.flatMap((entry) => entry.tags || []), 20),
    kinds: topFacet(entries.map((entry) => entry.kind), 12),
    projects: topFacet(entries.map((entry) => entry.project_id || "未分组"), 20),
  };
}

async function searchLocalAssets(userId: string, body: SearchRequestBody) {
  const query = asString(body.query);
  const filters = normalizeFilters(body);
  const limit = Math.min(Math.max(1, Math.round(asNumber(body.limit, 40))), 200);
  const offset = Math.max(0, Math.round(asNumber(body.offset, 0)));
  const sortBy = normalizeSortBy(body.sortBy);
  const includeFacets = normalizeBoolean(body.includeFacets, true);

  const all = listAssetIndexEntries(userId, {
    projectId: filters.projectId || undefined,
    sourceType: filters.sourceType || undefined,
  });

  const filtered = all.filter((entry) => matchesAssetSearchFilters(entry, filters));
  const searched = query
    ? filtered.filter((entry) => scoreAssetIndexEntry(entry, query) > 0)
    : filtered;
  const payload = toSearchPayload(searched, query, sortBy);
  const total = payload.length;
  const page = payload.slice(offset, offset + limit);

  return {
    records: page.map((item) => ({
      ...item.entry,
      score: item.score,
      highlights: item.highlights,
    })),
    total,
    offset,
    limit,
    facets: includeFacets ? buildFacets(searched) : undefined,
    needsIndex: total === 0 && all.length === 0,
  };
}

async function searchSupabaseAssets(userId: string, body: SearchRequestBody) {
  const query = asString(body.query);
  const filters = normalizeFilters(body);
  const limit = Math.min(Math.max(1, Math.round(asNumber(body.limit, 40))), 200);
  const offset = Math.max(0, Math.round(asNumber(body.offset, 0)));
  const sortBy = normalizeSortBy(body.sortBy);
  const includeFacets = normalizeBoolean(body.includeFacets, true);

  const supabase = getSupabaseClient();
  let qb = supabase
    .from("asset_index_entries")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(3000);
  if (filters.projectId) qb = qb.eq("project_id", filters.projectId);
  if (filters.sourceType) qb = qb.eq("source_type", filters.sourceType);

  const { data, error } = await qb;
  if (error) throw error;

  const normalized = (data || [])
    .map((item) => normalizeEntry(item))
    .filter((item): item is AssetIndexEntry => Boolean(item));

  const filtered = normalized.filter((entry) => matchesAssetSearchFilters(entry, filters));
  const searched = query
    ? filtered.filter((entry) => scoreAssetIndexEntry(entry, query) > 0)
    : filtered;
  const payload = toSearchPayload(searched, query, sortBy);
  const total = payload.length;
  const page = payload.slice(offset, offset + limit);

  return {
    records: page.map((item) => ({
      ...item.entry,
      score: item.score,
      highlights: item.highlights,
    })),
    total,
    offset,
    limit,
    facets: includeFacets ? buildFacets(searched) : undefined,
    needsIndex: total === 0 && normalized.length === 0,
  };
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request);
  if (!userId) {
    const normalized = normalizeOperationError({ message: "未登录", status: 401 });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }

  try {
    const body = await request.json() as SearchRequestBody;
    const result = isLocalBackendEnabled()
      ? await searchLocalAssets(userId, body)
      : await searchSupabaseAssets(userId, body);

    return NextResponse.json(result);
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "资产搜索失败",
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
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
    const body: SearchRequestBody = {
      query: searchParams.get("query") || "",
      projectId: searchParams.get("projectId"),
      sourceType: normalizeSourceType(searchParams.get("sourceType")),
      kinds: parseStringArray(searchParams.get("kinds")),
      models: parseStringArray(searchParams.get("models")),
      sizes: parseStringArray(searchParams.get("sizes")),
      tags: parseStringArray(searchParams.get("tags")),
      tagMode: normalizeTagMode(searchParams.get("tagMode")),
      limit: asNumber(searchParams.get("limit"), 40),
      offset: asNumber(searchParams.get("offset"), 0),
      sortBy: normalizeSortBy(searchParams.get("sortBy")),
      includeFacets: normalizeBoolean(searchParams.get("includeFacets"), true),
    };

    const result = isLocalBackendEnabled()
      ? await searchLocalAssets(userId, body)
      : await searchSupabaseAssets(userId, body);
    return NextResponse.json(result);
  } catch (err) {
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : "资产搜索失败",
      status: 500,
    });
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}
