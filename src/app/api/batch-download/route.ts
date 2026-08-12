import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";

interface ImageRecord {
  id: string;
  image_url: string;
  prompt?: string;
  file_name?: string;
  [key: string]: unknown;
}

// POST /api/batch-download - Create zip of selected images
export async function POST(req: NextRequest) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const body = await req.json();
  const { ids, type } = body as { ids: string[]; type?: string };

  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  let tableName = "image_records";
  if (type === "inspiration") {
    tableName = "inspiration_items";
  } else if (type === "reference") {
    tableName = "reference_images";
  }

  const selectFields = type === "inspiration"
    ? "id,image_url,file_name"
    : type === "reference"
      ? "id,image_url,file_name"
      : "id,image_url,prompt";

  let query = supabase.from(tableName).select(selectFields).in("id", ids);

  // Filter by user ownership
  if (tableName === "image_records") {
    query = query.eq("user_id", userId);
  }

  const { data: records, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!records || records.length === 0) return NextResponse.json({ error: "No records found" }, { status: 404 });

  const typedRecords = records as unknown as ImageRecord[];

  // Fetch all images in parallel
  const imageBuffers: { name: string; buffer: Buffer }[] = [];
  const fetchPromises = typedRecords.map(async (record, idx) => {
    const imageUrl = record.image_url;
    if (!imageUrl) return;
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) return;
      const arrayBuf = await resp.arrayBuffer();
      const ext = imageUrl.includes(".png") ? "png" : imageUrl.includes(".webp") ? "webp" : "jpg";
      const name = record.file_name || record.prompt?.slice(0, 30) || `image_${idx + 1}`;
      const safeName = name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "_").slice(0, 50);
      imageBuffers.push({ name: `${safeName}.${ext}`, buffer: Buffer.from(arrayBuf) });
    } catch { /* skip failed */ }
  });

  await Promise.all(fetchPromises);

  if (imageBuffers.length === 0) {
    return NextResponse.json({ error: "Failed to download any images" }, { status: 500 });
  }

  // Create zip using JSZip
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const { name, buffer } of imageBuffers) {
    zip.file(name, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const uint8 = new Uint8Array(zipBuffer);

  return new NextResponse(uint8, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="images_${Date.now()}.zip"`,
    },
  });
}
