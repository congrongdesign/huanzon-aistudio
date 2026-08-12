import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { S3Config, S3Storage } from "coze-coding-dev-sdk";
import { getCurrentUserId } from "@/lib/auth";
import {
  createChatMessage,
  createImageRecord,
  createProject,
  createPrompt,
  createReferenceImage,
  createSkill,
  getProjectById,
  isLocalBackendEnabled,
  listChatMessages,
  listImageRecords,
  listPrompts,
  listReferenceImages,
  listSkills,
  resolveLocalFilePath,
  saveBinaryFile,
} from "@/lib/local-backend";
import { getSupabaseClient } from "@/storage/database/supabase-client";

type Manifest = {
  format: "huanzon-aistudio-project";
  version: 1;
  exportedAt: string;
  project: Record<string, unknown>;
  imageRecords: Array<Record<string, unknown>>;
  chatMessages: Array<Record<string, unknown>>;
  referenceImages: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  assets: Array<{ originalUrl: string; fileName: string; contentType?: string }>;
};

const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

function safeFileName(value: string, fallback: string): string {
  return (value || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

export function safeBackupDir(raw: string): string {
  const resolved = path.resolve(raw || "");
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error("备份目录无效");
  }
  return resolved;
}

function extFromUrl(url: string): string {
  const ext = path.extname(url.split("?")[0]).replace(".", "").toLowerCase();
  return ext && ext.length <= 6 ? ext : "png";
}

function collectUrls(manifest: Omit<Manifest, "assets">): string[] {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) urls.add(value.trim());
  };
  const parseUrlArray = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) value.forEach(add);
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) parsed.forEach(add);
      } catch {
        add(value);
      }
    }
  };

  manifest.imageRecords.forEach((record) => {
    add(record.image_url);
    parseUrlArray(record.reference_images);
  });
  manifest.chatMessages.forEach((message) => {
    add(message.image_url);
    parseUrlArray(message.reference_image_urls);
  });
  manifest.referenceImages.forEach((ref) => add(ref.image_url));
  manifest.prompts.forEach((prompt) => add(prompt.image_url));
  return Array.from(urls).filter((url) => /^(https?:|\/api\/local-file\/|data:)/i.test(url));
}

async function readImageFromUrl(request: NextRequest, url: string): Promise<{ buffer: Buffer; contentType?: string; ext: string } | null> {
  try {
    if (url.startsWith("/api/local-file/")) {
      const key = decodeURIComponent(url.split("/").pop() || "");
      const filePath = resolveLocalFilePath(key);
      if (!fs.existsSync(filePath)) return null;
      return { buffer: fs.readFileSync(filePath), ext: path.extname(filePath).replace(".", "") || extFromUrl(url) };
    }
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
      if (!match) return null;
      const contentType = match[1] || "image/png";
      const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
      return { buffer, contentType, ext: IMAGE_EXT_BY_TYPE[contentType] || "png" };
    }
    const absolute = url.startsWith("/") ? new URL(url, request.nextUrl.origin).toString() : url;
    const res = await fetch(absolute, { cache: "no-store" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || undefined;
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType,
      ext: contentType ? IMAGE_EXT_BY_TYPE[contentType] || extFromUrl(url) : extFromUrl(url),
    };
  } catch {
    return null;
  }
}

async function loadProjectData(projectId: string, userId: string | null) {
  if (isLocalBackendEnabled()) {
    const project = getProjectById(projectId, userId);
    if (!project) throw new Error("项目不存在或无权限");
    const { records } = listImageRecords(userId, { projectId, includeDeleted: true, pageSize: 5000 });
    return {
      project,
      imageRecords: records,
      chatMessages: listChatMessages(projectId, userId, 5000, true),
      referenceImages: listReferenceImages(userId, projectId),
      prompts: listPrompts(userId, projectId),
      skills: listSkills(userId, projectId),
    };
  }

  const supabase = getSupabaseClient();
  const [{ data: project }, images, chats, refs, prompts, skills] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).eq("user_id", userId).single(),
    supabase.from("image_records").select("*").eq("project_id", projectId).eq("user_id", userId),
    supabase.from("chat_messages").select("*").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("reference_images").select("*").eq("project_id", projectId),
    supabase.from("prompt_library").select("*").eq("project_id", projectId).eq("user_id", userId),
    supabase.from("custom_skills").select("*").eq("project_id", projectId),
  ]);
  if (!project) throw new Error("项目不存在或无权限");
  return {
    project,
    imageRecords: images.data || [],
    chatMessages: chats.data || [],
    referenceImages: refs.data || [],
    prompts: prompts.data || [],
    skills: skills.data || [],
  };
}

export async function buildProjectZip(request: NextRequest, projectId: string, userId: string | null) {
  const data = await loadProjectData(projectId, userId);
  const baseManifest = {
    format: "huanzon-aistudio-project" as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    ...data,
  };

  const zip = new JSZip();
  const assets: Manifest["assets"] = [];
  const urls = collectUrls(baseManifest);
  const urlToAsset = new Map<string, string>();

  for (let i = 0; i < urls.length; i += 1) {
    const source = await readImageFromUrl(request, urls[i]);
    if (!source) continue;
    const fileName = `assets/${String(i + 1).padStart(4, "0")}.${source.ext || "png"}`;
    zip.file(fileName, source.buffer);
    assets.push({ originalUrl: urls[i], fileName, contentType: source.contentType });
    urlToAsset.set(urls[i], fileName);
  }

  const manifest: Manifest = { ...baseManifest, assets };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", [
    "环中AIStudio 项目画板文件",
    "",
    "包含：项目元数据、画布图片记录、对话记录、参考图、提示词、技能、图片资源。",
    "请在环中AIStudio中使用“导入项目包”恢复。",
    "",
    `图片资源数量：${urlToAsset.size}`,
  ].join("\n"));

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const projectName = safeFileName(String(data.project.name || "项目画板"), "项目画板");
  return { buffer, fileName: `${projectName}_${new Date().toISOString().slice(0, 10)}.hzproj.zip` };
}

async function saveImportedImage(
  zip: JSZip,
  manifest: Manifest,
  originalUrl: unknown,
  s3?: S3Storage,
): Promise<{ url: string; key: string | null }> {
  if (typeof originalUrl !== "string" || !originalUrl) return { url: "", key: null };
  const asset = manifest.assets.find((item) => item.originalUrl === originalUrl);
  if (!asset) return { url: originalUrl, key: null };
  const file = zip.file(asset.fileName);
  if (!file) return { url: originalUrl, key: null };
  const buffer = Buffer.from(await file.async("nodebuffer"));
  const name = path.basename(asset.fileName);
  if (isLocalBackendEnabled()) {
    const saved = saveBinaryFile(buffer, name, asset.contentType);
    return { url: saved.url, key: saved.key };
  }
  if (!s3) return { url: originalUrl, key: null };
  const key = await s3.uploadFile({ fileContent: buffer, fileName: name, contentType: asset.contentType || "image/png" });
  return { key, url: await s3.generatePresignedUrl({ key }) };
}

function rewriteJsonUrlArray(value: unknown, replacements: Map<string, string>): string | null {
  if (!value) return null;
  try {
    const arr = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(arr)) return typeof value === "string" ? value : null;
    return JSON.stringify(arr.map((url) => replacements.get(String(url)) || url));
  } catch {
    return typeof value === "string" ? value : null;
  }
}

export async function importProjectZip(file: File, userId: string | null) {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("项目包缺少 manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string")) as Manifest;
  if (manifest.format !== "huanzon-aistudio-project") throw new Error("不是有效的环中AIStudio项目包");

  if (!isLocalBackendEnabled()) {
    throw new Error("当前在线数据库导入暂未启用，请切换到本地模式导入项目包。");
  }

  const projectName = `${String(manifest.project?.name || "导入项目")}（导入）`;
  const newProject = createProject(userId, projectName);
  const s3 = isLocalBackendEnabled() ? undefined : new S3Storage(new S3Config());
  const replacements = new Map<string, string>();
  const imageCache = new Map<string, { url: string; key: string | null }>();
  const restoreImage = async (url: unknown) => {
    const raw = typeof url === "string" ? url : "";
    if (!raw) return { url: "", key: null };
    if (!imageCache.has(raw)) {
      imageCache.set(raw, await saveImportedImage(zip, manifest, raw, s3));
    }
    const saved = imageCache.get(raw) || { url: raw, key: null };
    if (saved.url) replacements.set(raw, saved.url);
    return saved;
  };

  for (const record of manifest.imageRecords || []) {
    const saved = await restoreImage(record.image_url);
    createImageRecord({
      id: crypto.randomUUID(),
      user_id: userId,
      project_id: newProject.id,
      prompt: String(record.prompt || ""),
      image_url: saved.url || String(record.image_url || ""),
      image_key: saved.key,
      reference_images: rewriteJsonUrlArray(record.reference_images, replacements),
      canvas_x: Number(record.canvas_x ?? 40),
      canvas_y: Number(record.canvas_y ?? 40),
      canvas_width: Number(record.canvas_width ?? 320),
      canvas_height: Number(record.canvas_height ?? 320),
      size: String(record.size || "1:1"),
      model: String(record.model || "gpt-image-2"),
      status: String(record.status || "completed"),
      is_favorite: Boolean(record.is_favorite),
      deleted_at: record.deleted_at ? String(record.deleted_at) : null,
      edited_image_key: null,
      created_at: String(record.created_at || new Date().toISOString()),
      updated_at: String(record.updated_at || new Date().toISOString()),
    });
  }

  for (const ref of manifest.referenceImages || []) {
    const saved = await restoreImage(ref.image_url);
    createReferenceImage(userId, {
      project_id: newProject.id,
      image_url: saved.url || String(ref.image_url || ""),
      image_key: saved.key,
      file_name: String(ref.file_name || "reference.png"),
    });
  }

  for (const message of manifest.chatMessages || []) {
    const saved = await restoreImage(message.image_url);
    createChatMessage(
      newProject.id,
      userId,
      message.role === "assistant" ? "assistant" : "user",
      String(message.content || ""),
      (() => {
        const rewritten = rewriteJsonUrlArray(message.reference_image_urls, replacements);
        try {
          return rewritten ? JSON.parse(rewritten) : null;
        } catch {
          return null;
        }
      })(),
      saved.url || (typeof message.image_url === "string" ? message.image_url : null),
    );
  }

  for (const prompt of manifest.prompts || []) {
    createPrompt(userId, {
      project_id: newProject.id,
      text: String(prompt.text || ""),
      category: String(prompt.category || "general"),
      image_url: replacements.get(String(prompt.image_url || "")) || (typeof prompt.image_url === "string" ? prompt.image_url : null),
    });
  }

  for (const skill of manifest.skills || []) {
    createSkill(userId, {
      project_id: newProject.id,
      name: String(skill.name || "导入技能"),
      description: String(skill.description || ""),
      steps: typeof skill.steps === "string" ? skill.steps : JSON.stringify(skill.steps || []),
    });
  }

  return newProject;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const projectId = request.nextUrl.searchParams.get("projectId") || "";
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    const { buffer, fileName } = await buildProjectZip(request, projectId, userId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "导出失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "请上传项目包文件" }, { status: 400 });
      const project = await importProjectZip(file, userId);
      return NextResponse.json({ success: true, project });
    }

    const body = await request.json();
    const importPath = String(body.importPath || "");
    if (importPath) {
      const resolved = path.resolve(importPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return NextResponse.json({ error: "项目包文件不存在" }, { status: 404 });
      }
      if (!resolved.endsWith(".zip")) {
        return NextResponse.json({ error: "只支持导入 .zip 项目包" }, { status: 400 });
      }
      const buffer = fs.readFileSync(resolved);
      const file = new File([new Uint8Array(buffer)], path.basename(resolved), { type: "application/zip" });
      const project = await importProjectZip(file, userId);
      return NextResponse.json({ success: true, project });
    }

    const projectId = String(body.projectId || "");
    const target = String(body.target || "");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    if (!target) return NextResponse.json({ error: "请填写备份目录" }, { status: 400 });
    const { buffer, fileName } = await buildProjectZip(request, projectId, userId);
    const dir = safeBackupDir(target);
    fs.mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, fileName);
    fs.writeFileSync(outputPath, buffer);
    return NextResponse.json({ success: true, fileName, outputPath, size: buffer.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "操作失败" }, { status: 500 });
  }
}
