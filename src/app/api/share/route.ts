import { NextRequest, NextResponse } from "next/server";
import { S3Storage } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: "",
  secretKey: "",
  bucketName: process.env.COZE_BUCKET_NAME,
  region: "cn-beijing",
});

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { recordId, useEdited } = await request.json();
    if (!recordId) {
      return NextResponse.json({ error: "recordId is required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: record, error } = await supabase
      .from("image_records")
      .select("image_key, edited_image_key, image_url")
      .eq("id", recordId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!record) throw new Error("Record not found or no permission");

    const fileKey = useEdited ? record.edited_image_key : record.image_key;

    let downloadUrl: string;
    if (fileKey) {
      downloadUrl = await storage.generatePresignedUrl({
        key: fileKey,
        expireTime: 3600,
      });
    } else if (record.image_url) {
      const newKey = await storage.uploadFromUrl({ url: record.image_url, timeout: 30000 });
      downloadUrl = await storage.generatePresignedUrl({ key: newKey, expireTime: 3600 });

      await supabase
        .from("image_records")
        .update({ image_key: newKey })
        .eq("id", recordId);
    } else {
      return NextResponse.json({ error: "No image available" }, { status: 404 });
    }

    return NextResponse.json({ downloadUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
