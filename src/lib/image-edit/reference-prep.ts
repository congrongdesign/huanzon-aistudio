import sharp from "sharp";
import { getKnowledgeHubItemById } from "@/lib/knowledge-hub-store";
import { isLocalBackendEnabled, resolveLocalFilePath } from "@/lib/local-backend";
import { MAX_MODEL_REFERENCE_IMAGES } from "@/lib/image-edit/reference-constants";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { S3Config, S3Storage } from "coze-coding-dev-sdk";

const DEFAULT_MAX_DATA_URL_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_EDGE = 3840;
const FALLBACK_MAX_EDGE = 2048;
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

function canRefreshRemoteReference(value: string): boolean {
  if (!value || value.startsWith("data:") || value.startsWith("/")) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

export async function refreshReferenceUrls(refs: string[]): Promise<string[]> {
  const source = Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0) : [];
  const deduped = Array.from(new Set(source.map((ref) => ref.trim())));
  if (deduped.length === 0 || isLocalBackendEnabled()) return deduped;

  const refreshable = deduped.filter(canRefreshRemoteReference);
  if (refreshable.length === 0) return deduped;

  const supabase = getSupabaseClient();
  const storage = new S3Storage(new S3Config());
  const mapping = new Map<string, string>();

  const tryRefreshFromTable = async (table: "image_records" | "reference_images", url: string) => {
    const exact = await supabase
      .from(table)
      .select("image_key, image_url")
      .eq("image_url", url)
      .limit(1);
    const exactRow = exact.data?.[0];
    if (exactRow?.image_key) {
      const freshUrl = await storage.generatePresignedUrl({ key: exactRow.image_key, expireTime: 86400 });
      mapping.set(url, freshUrl);
      return true;
    }

    const urlBase = url.split("?")[0];
    const fuzzy = await supabase
      .from(table)
      .select("image_key, image_url")
      .like("image_url", `${urlBase}%`)
      .limit(1);
    const fuzzyRow = fuzzy.data?.[0];
    if (fuzzyRow?.image_key) {
      const freshUrl = await storage.generatePresignedUrl({ key: fuzzyRow.image_key, expireTime: 86400 });
      mapping.set(url, freshUrl);
      return true;
    }

    return false;
  };

  await Promise.all(refreshable.map(async (url) => {
    try {
      if (await tryRefreshFromTable("image_records", url)) return;
      if (await tryRefreshFromTable("reference_images", url)) return;
    } catch {
      // fallback to original below
    }
    mapping.set(url, url);
  }));

  return deduped.map((url) => mapping.get(url) || url);
}

export type PreparedReferenceImage = {
  value: string;
  original: string;
  compressed: boolean;
  inputBytes?: number;
  outputBytes?: number;
};

export type PrepareReferenceImagesResult = {
  references: string[];
  items: PreparedReferenceImage[];
  warnings: string[];
};

function estimateBase64Bytes(value: string): number {
  return value.replace(/^data:[^;]+;base64,/, "").length;
}

function extToMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_BY_EXT[ext] || "image/png";
}

async function localFileToDataUrl(filePath: string): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const buffer = await fs.readFile(filePath);
    return `data:${extToMime(filePath)};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function resolveLocalReference(ref: string): Promise<string> {
  if (!ref || ref.startsWith("data:")) return ref;
  let parsed: URL;
  try {
    parsed = ref.startsWith("/") ? new URL(ref, "http://localhost") : new URL(ref);
  } catch {
    return ref;
  }

  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (!isLocalHost && !ref.startsWith("/")) return ref;

  if (parsed.pathname.startsWith("/api/local-file/")) {
    const key = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    return key ? (await localFileToDataUrl(resolveLocalFilePath(key))) || ref : ref;
  }

  if (parsed.pathname === "/api/knowledge-hub/preview") {
    const id = parsed.searchParams.get("id") || "";
    const item = id ? getKnowledgeHubItemById(id) : null;
    if ((item?.source === "nas" || item?.source === "local") && item.kind === "image") {
      return (await localFileToDataUrl(item.externalId)) || ref;
    }
  }

  return ref;
}

async function compressDataUrlIfNeeded(value: string, maxBytes: number, maxEdge: number): Promise<{ value: string; compressed: boolean; inputBytes: number; outputBytes: number }> {
  if (!value.startsWith("data:")) {
    return { value, compressed: false, inputBytes: 0, outputBytes: 0 };
  }
  const inputBytes = estimateBase64Bytes(value);
  if (inputBytes <= maxBytes) {
    return { value, compressed: false, inputBytes, outputBytes: inputBytes };
  }

  const raw = value.replace(/^data:[^;]+;base64,/, "");
  const input = Buffer.from(raw, "base64");
  const ladders = [
    { edge: maxEdge, quality: [85, 75, 65, 55] },
    { edge: FALLBACK_MAX_EDGE, quality: [75, 65, 55, 45] },
  ];

  for (const ladder of ladders) {
    for (const quality of ladder.quality) {
      const output = await sharp(input, { failOn: "none" })
        .rotate()
        .resize({ width: ladder.edge, height: ladder.edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, progressive: true })
        .toBuffer();
      const b64 = output.toString("base64");
      if (b64.length <= maxBytes) {
        return {
          value: `data:image/jpeg;base64,${b64}`,
          compressed: true,
          inputBytes,
          outputBytes: b64.length,
        };
      }
    }
  }

  return { value, compressed: false, inputBytes, outputBytes: inputBytes };
}

export async function prepareReferenceImagesForModel(
  refs: unknown,
  options: { maxCount?: number; maxDataUrlBytes?: number; maxEdge?: number } = {},
): Promise<PrepareReferenceImagesResult> {
  const maxCount = options.maxCount ?? MAX_MODEL_REFERENCE_IMAGES;
  const maxDataUrlBytes = options.maxDataUrlBytes ?? DEFAULT_MAX_DATA_URL_BYTES;
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const source = Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0) : [];
  const deduped = Array.from(new Set(source.map((ref) => ref.trim())));
  const selected = (await refreshReferenceUrls(deduped)).slice(0, maxCount);
  const warnings: string[] = [];
  if (deduped.length > maxCount) warnings.push(`参考图最多使用 ${maxCount} 张，已自动忽略后面的 ${deduped.length - maxCount} 张。`);

  const items: PreparedReferenceImage[] = [];
  for (const original of selected) {
    const resolved = await resolveLocalReference(original);
    const compressed = await compressDataUrlIfNeeded(resolved, maxDataUrlBytes, maxEdge);
    if (compressed.inputBytes > maxDataUrlBytes && !compressed.compressed) {
      warnings.push("有一张参考图过大，已尽量压缩但仍可能导致模型接口变慢。");
    }
    items.push({
      value: compressed.value,
      original,
      compressed: compressed.compressed,
      inputBytes: compressed.inputBytes,
      outputBytes: compressed.outputBytes,
    });
  }

  const compressedCount = items.filter((item) => item.compressed).length;
  if (compressedCount > 0) warnings.push(`已自动压缩 ${compressedCount} 张大尺寸参考图，提升生成稳定性。`);

  return { references: items.map((item) => item.value), items, warnings };
}
