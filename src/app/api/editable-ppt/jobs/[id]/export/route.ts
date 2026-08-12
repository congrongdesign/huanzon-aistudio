import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { exportEditablePptDeck } from "@/lib/editable-ppt/export";
import {
  createEditablePptExport,
  getEditablePptJobDetail,
  updateEditablePptExport,
} from "@/lib/editable-ppt/store";
import { resolveLocalFilePath } from "@/lib/local-backend";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { id } = await params;
    const detail = getEditablePptJobDetail(id, userId);
    if (!detail) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const exportRecord = createEditablePptExport(userId, {
      job_id: id,
      export_type: "pptx",
      status: "processing",
      page_range: JSON.stringify(detail.pages.map((page) => page.id)),
      file_url: null,
      file_key: null,
      file_size: 0,
      warnings: detail.job.warnings,
      error_message: null,
    });

    try {
      const saved = await exportEditablePptDeck({
        projectName: detail.job.name,
        aspectRatio: detail.job.aspect_ratio_guess,
        pages: detail.pages,
        elementsByPage: detail.elementsByPage,
      });

      const fileSize = saved.key ? fs.statSync(resolveLocalFilePath(saved.key)).size : 0;

      const updated = updateEditablePptExport(exportRecord.id, userId, {
        status: "ready",
        file_url: saved.url,
        file_key: saved.key,
        file_size: fileSize,
        error_message: null,
      });

      return NextResponse.json({ export: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败";
      const updated = updateEditablePptExport(exportRecord.id, userId, {
        status: "failed",
        error_message: message,
      });
      return NextResponse.json({ error: message, export: updated }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
