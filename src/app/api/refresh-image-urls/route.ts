import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { S3Storage } from "coze-coding-dev-sdk";
import { isLocalBackendEnabled } from "@/lib/local-backend";

// POST /api/refresh-image-urls
// Given an array of URLs or image_keys, return fresh signed URLs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls = [], keys = [] } = body;

    if (isLocalBackendEnabled()) {
      const mapping: Record<string, string> = {};
      for (const key of keys) {
        if (key) mapping[key] = key;
      }
      for (const url of urls) {
        if (url) mapping[url] = url;
      }
      return NextResponse.json({ success: true, mapping });
    }

    const supabase = getSupabaseClient();
    const result: Record<string, string> = {}; // oldUrl/key → newUrl

    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });

    // Refresh by image_key
    for (const key of keys) {
      if (!key) continue;
      try {
        const freshUrl = await storage.generatePresignedUrl({ key, expireTime: 86400 });
        result[key] = freshUrl;
      } catch {
        // If S3 fails, try to find in DB
        const { data } = await supabase
          .from("image_records")
          .select("image_url")
          .eq("image_key", key)
          .limit(1);
        if (data && data.length > 0) {
          result[key] = data[0].image_url;
        }
      }
    }

    // Refresh by URL: find the image_key from DB, then get fresh URL
    for (const url of urls) {
      if (!url) continue;
      // Try to find by image_url in DB
      const { data } = await supabase
        .from("image_records")
        .select("image_key, image_url")
        .eq("image_url", url)
        .limit(1);

      if (data && data.length > 0 && data[0].image_key) {
        try {
          const freshUrl = await storage.generatePresignedUrl({ key: data[0].image_key, expireTime: 86400 });
          result[url] = freshUrl;
        } catch {
          result[url] = url; // fallback to original
        }
      } else {
        // Try matching by base URL (without query params)
        const urlBase = url.split("?")[0];
        const { data: data2 } = await supabase
          .from("image_records")
          .select("image_key, image_url")
          .like("image_url", `${urlBase}%`)
          .limit(1);

        if (data2 && data2.length > 0 && data2[0].image_key) {
          try {
            const freshUrl = await storage.generatePresignedUrl({ key: data2[0].image_key, expireTime: 86400 });
            result[url] = freshUrl;
          } catch {
            result[url] = url;
          }
        }
      }
    }

    return NextResponse.json({ success: true, mapping: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
