import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { buildEditablePptJobPayload, importEditablePptFiles } from "@/lib/editable-ppt/import";
import { createEditablePptJob, replaceEditablePptElementsForPage, replaceEditablePptPages } from "@/lib/editable-ppt/store";

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && Boolean(value.name));
    const singleFile = formData.get("file");
    const allFiles = files.length > 0 ? files : singleFile instanceof File ? [singleFile] : [];
    if (allFiles.length === 0) {
      return NextResponse.json({ error: "请上传 PPTX、PDF、图片包或页面图片" }, { status: 400 });
    }

    const name = String(formData.get("name") || allFiles[0]?.name || "可编辑PPT任务");
    const projectIdValue = formData.get("projectId");
    const projectId = typeof projectIdValue === "string" && projectIdValue.trim() ? projectIdValue.trim() : null;
    const configValue = formData.get("config");
    let config = undefined;
    if (typeof configValue === "string" && configValue.trim()) {
      try {
        config = JSON.parse(configValue) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "config 格式不正确" }, { status: 400 });
      }
    }

    const imported = await importEditablePptFiles(userId, projectId, name, allFiles, config as never);
    const jobInput = buildEditablePptJobPayload(userId, projectId, name, imported);
    const job = createEditablePptJob(userId, jobInput);
    const pages = imported.pages.map((page) => ({ ...page, job_id: job.id }));
    const elements = imported.elements.map((element) => ({ ...element, job_id: job.id }));

    replaceEditablePptPages(job.id, userId, pages);
    for (const page of pages) {
      replaceEditablePptElementsForPage(
        page.id,
        job.id,
        userId,
        elements.filter((element) => element.page_id === page.id),
      );
    }

    return NextResponse.json({
      job,
      pages,
      warnings: imported.warnings,
      canExport: pages.length > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
