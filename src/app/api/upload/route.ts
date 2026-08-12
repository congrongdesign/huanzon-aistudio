import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import { isLocalBackendEnabled, saveBinaryFile } from "@/lib/local-backend";

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const s3 = new S3Storage(new S3Config());
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "png";
    const uploadName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const contentType = file.type || "image/png";

    if (isLocalBackendEnabled()) {
      const saved = saveBinaryFile(buffer, uploadName, contentType);
      return NextResponse.json({
        url: saved.url,
        key: saved.key,
        projectId,
        fileName: file.name,
      });
    }

    const objectKey = await s3.uploadFile({ fileContent: buffer, fileName: uploadName, contentType });
    const url = await s3.generatePresignedUrl({ key: objectKey });

    return NextResponse.json({
      url,
      key: objectKey,
      projectId,
      fileName: file.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
