import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { buildProjectArchive, importProjectArchiveBuffer, verifyProjectArchiveBuffer } from "@/lib/project-archive";
import { assertArchiveRoot, safeArchiveRoot } from "@/lib/project-archive-store";
import { isCozeCloudRuntime } from "@/lib/deploy-mode";

export const safeBackupDir = safeArchiveRoot;

export async function buildProjectZip(request: NextRequest, projectId: string, userId: string | null) {
  return buildProjectArchive({ projectId, userId, baseUrl: request.nextUrl.origin });
}

export async function importProjectZip(file: File, userId: string | null) {
  return (await importProjectArchiveBuffer(Buffer.from(await file.arrayBuffer()), userId)).project;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const projectId = request.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "请选择项目" }, { status: 400 });
    const { buffer, fileName } = await buildProjectZip(request, projectId, userId);
    return new NextResponse(new Uint8Array(buffer), { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, "Cache-Control": "no-store",
    } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导出失败" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "请上传项目包文件" }, { status: 400 });
      return NextResponse.json({ success: true, project: await importProjectZip(file, userId) });
    }
    if (isCozeCloudRuntime()) return NextResponse.json({ error: "云端版不能读取或写入本机 NAS 目录" }, { status: 403 });
    const body = await request.json();
    if (body.importPath) {
      const location = path.resolve(String(body.importPath));
      if (!location.endsWith(".zip")) throw new Error("只支持 ZIP 项目包");
      const buffer = fs.readFileSync(location);
      return NextResponse.json({ success: true, project: (await importProjectArchiveBuffer(buffer, userId)).project });
    }
    // Retain compatibility with old clients, using the complete, verified format.
    if (!body.projectId || !body.target) return NextResponse.json({ error: "请选择项目和备份目录" }, { status: 400 });
    const root = safeArchiveRoot(String(body.target));
    assertArchiveRoot(root);
    const { buffer, fileName } = await buildProjectZip(request, String(body.projectId), userId);
    await verifyProjectArchiveBuffer(buffer);
    const outputPath = path.join(root, fileName);
    fs.writeFileSync(`${outputPath}.part`, buffer);
    await verifyProjectArchiveBuffer(fs.readFileSync(`${outputPath}.part`));
    fs.renameSync(`${outputPath}.part`, outputPath);
    return NextResponse.json({ success: true, outputPath, fileName, size: buffer.length });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "项目包操作失败" }, { status: 500 }); }
}
