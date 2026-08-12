"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  GripVertical,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import NeutralSelect from "@/components/ui/neutral-select";

type ConversionSourceType = "images" | "pdf";
type ConversionTaskStatus =
  | "draft"
  | "preparing_pdf"
  | "uploading"
  | "estimating"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

type ConversionSourceFile = {
  name: string;
  size: number;
  type: string;
  origin?: "upload" | "canvas" | "url";
  source_url?: string | null;
  thumbnail_url?: string | null;
  width?: number | null;
  height?: number | null;
};

type ConversionTask = {
  id: string;
  project_id?: string | null;
  codia_task_id: string | null;
  source_type: ConversionSourceType;
  source_name: string;
  source_files: ConversionSourceFile[];
  page_count: number;
  status: ConversionTaskStatus;
  progress: number;
  estimated_credits: number | null;
  charged_credits: number | null;
  upload_id: string | null;
  codia_status?: string | null;
  prepared_pdf_url: string | null;
  ppt_url: string | null;
  archived_asset_id?: string | null;
  archived_at?: string | null;
  error_message: string | null;
  sync_error?: string | null;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

type CanvasConversionImage = {
  id: string;
  image_url: string;
  project_id?: string | null;
  prompt?: string | null;
  model?: string | null;
  size?: string | null;
  canvas_width?: number | null;
  canvas_height?: number | null;
  created_at?: string | null;
};

type DraftPage =
  | {
      key: string;
      type: "upload";
      file: File;
    }
  | {
      key: string;
      type: "canvas";
      image: CanvasConversionImage;
    };

type ProjectOption = {
  id: string;
  name: string;
};

type BatchProjectGroup = {
  key: string;
  projectId: string | null;
  name: string;
  images: CanvasConversionImage[];
};

type BuildConversionFormDataOptions = {
  files?: File[];
  images?: CanvasConversionImage[];
  taskName?: string;
  projectIdOverride?: string | null;
};

type ConversionCenterProps = {
  projectId: string | null;
  authHeaders: () => Record<string, string>;
  codiaApiKey?: string;
  codiaBaseUrl?: string;
  codiaProviderLabel?: string;
  onOpenConfig?: () => void;
  canvasImages?: CanvasConversionImage[];
};

const ALL_PROJECTS = "all";
const ALL_TASKS = "all";
const ACTIVE_TASKS = "active";
const SYNC_PENDING_TASKS = "sync_pending";
const STORAGE_CODIA_API_KEY = "hz_codia_api_key";

const STATUS_LABEL: Record<ConversionTaskStatus, string> = {
  draft: "待开始",
  preparing_pdf: "准备文件",
  uploading: "上传中",
  estimating: "预估点数",
  queued: "排队中",
  processing: "转换中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

const ACTIVE_STATUSES = new Set<ConversionTaskStatus>([
  "preparing_pdf",
  "uploading",
  "estimating",
  "queued",
  "processing",
]);

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCredits(data: unknown) {
  if (!data || typeof data !== "object") return null;
  return asNumber((data as Record<string, unknown>).available_credits);
}

function extractUsedCredits(data: unknown) {
  if (!data || typeof data !== "object") return null;
  return asNumber((data as Record<string, unknown>).used_credits);
}

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function formatCredits(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1);
}

function usageItemLabel(item: Record<string, unknown>) {
  const raw = firstText(item, ["operation", "endpoint", "action", "type", "name", "task_name"]);
  if (!raw) return "open_api";
  return raw.replace(/^\/?v\d+\/open\//, "").replace(/_/g, " ");
}

function usageItemCredits(item: Record<string, unknown>) {
  return firstNumber(item, ["credits_used", "credits", "charged_credits", "used_credits", "amount", "cost"]);
}

function usageItemTime(item: Record<string, unknown>) {
  return firstText(item, ["created_at", "createdAt", "created_time", "timestamp", "time", "date"]);
}

function statusClass(status: ConversionTaskStatus) {
  if (status === "succeeded") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (status === "failed") return "border-red-500/25 bg-red-500/10 text-red-500";
  if (status === "canceled") return "border-border bg-muted text-muted-foreground";
  return "border-border bg-muted text-foreground";
}

function isTaskActive(task: ConversionTask) {
  return ACTIVE_STATUSES.has(task.status);
}

function needsTaskResultSync(task: ConversionTask) {
  return Boolean(task.codia_task_id && task.status === "succeeded" && !task.ppt_url);
}

function taskStatusMatches(task: ConversionTask, filter: string) {
  if (filter === ALL_TASKS) return true;
  if (filter === ACTIVE_TASKS) return isTaskActive(task);
  if (filter === SYNC_PENDING_TASKS) return needsTaskResultSync(task);
  if (filter === "succeeded") return task.status === "succeeded" && Boolean(task.ppt_url);
  return task.status === filter;
}

function isPdfFileLike(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function uploadFileKey(file: File) {
  return `upload:${file.name}:${file.size}`;
}

function canvasImageKey(image: CanvasConversionImage) {
  return `canvas:${image.image_url}`;
}

function createDraftPages(inputFiles: File[], images: CanvasConversionImage[]) {
  if (inputFiles.some(isPdfFileLike)) return [];
  return [
    ...inputFiles
      .filter((file) => !isPdfFileLike(file))
      .map((file) => ({ key: uploadFileKey(file), type: "upload" as const, file })),
    ...images.map((image) => ({ key: canvasImageKey(image), type: "canvas" as const, image })),
  ] satisfies DraftPage[];
}

function imageDisplayName(image: CanvasConversionImage, index: number) {
  const prompt = (image.prompt || "").replace(/\s+/g, " ").trim();
  if (prompt) return prompt.slice(0, 42);
  return `${image.model || "画布图片"}-${String(index + 1).padStart(2, "0")}`;
}

function imageSourceLabel(image: CanvasConversionImage) {
  if (image.id.startsWith("ppt-workshop-") || image.model === "PPT工作台" || image.model === "PPT导入") return "PPT导入";
  if (image.id.startsWith("task-") || image.model === "转换任务") return "历史任务";
  if (image.project_id) return "项目图片";
  return "画布图片";
}

function imageAspectRatio(image: CanvasConversionImage) {
  const width = Number(image.canvas_width);
  const height = Number(image.canvas_height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${width} / ${height}`;
  }

  const size = (image.size || "").trim();
  const xy = size.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (xy) return `${xy[1]} / ${xy[2]}`;
  const ratio = size.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (ratio) return `${ratio[1]} / ${ratio[2]}`;
  return "16 / 9";
}

function sourceOriginLabel(file: ConversionSourceFile) {
  if (file.origin === "canvas") return "画布";
  if (file.origin === "url") return "链接";
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "PDF" : "上传";
}

function sourceDimensions(file: ConversionSourceFile) {
  if (file.width && file.height) return `${Math.round(file.width)} x ${Math.round(file.height)}`;
  return "";
}

function taskStageHint(task: ConversionTask) {
  if (task.sync_error) return "最近一次同步失败，可手动同步重试";
  if (task.status === "preparing_pdf") return "正在按原图片比例生成高清 PDF";
  if (task.status === "uploading") return "正在上传 PDF 到 Codia";
  if (task.status === "estimating") return "正在预估转换点数";
  if (task.status === "queued") return "已提交，等待 Codia 处理";
  if (task.status === "processing") return "Codia 正在生成可编辑 PPT";
  if (task.status === "succeeded") return task.ppt_url ? "转换完成，可下载 PPTX" : "转换完成，正在同步下载地址";
  if (task.status === "failed") return "转换失败，请查看错误信息";
  if (task.status === "canceled") return "任务已取消";
  return "等待开始";
}

function taskIssueDiagnosis(task: ConversionTask, accountError?: string) {
  const rawError = (task.error_message || "").trim();
  const rawSyncError = (task.sync_error || "").trim();
  const text = `${rawError} ${rawSyncError} ${accountError || ""}`.toLowerCase();
  const hasPreparedPdf = Boolean(task.prepared_pdf_url);
  const base = {
    rawError,
    canRetry: hasPreparedPdf && !ACTIVE_STATUSES.has(task.status),
    canOpenConfig: false,
    canRefreshAccount: false,
  };

  if (task.status === "canceled") {
    return {
      ...base,
      title: "任务已取消",
      summary: "这个任务已停止，不会继续消耗点数。",
      action: hasPreparedPdf ? "如需继续，可使用中间 PDF 重试。" : "如需继续，请重新创建转换任务。",
    };
  }

  if (!rawError && !rawSyncError && task.status !== "failed") {
    return {
      ...base,
      title: "任务正常",
      summary: taskStageHint(task),
      action: "等待任务状态刷新即可。",
    };
  }

  if (/api\s*key|unauthori[sz]ed|forbidden|\b401\b|\b403\b|鉴权|认证|未配置|token|invalid\s*key|permission/.test(text)) {
    return {
      ...base,
      title: "Codia Key 或权限异常",
      summary: rawError || rawSyncError || "当前 Codia 配置不可用。",
      action: "检查并重新保存 Codia API Key，然后刷新账户状态再重试。",
      canOpenConfig: true,
      canRefreshAccount: true,
    };
  }

  if (/余额|点数|credit|credits|balance|quota|insufficient|payment|billing/.test(text)) {
    return {
      ...base,
      title: "Codia 余额不足",
      summary: rawError || rawSyncError || "账户余额不足，任务没有成功创建。",
      action: "充值或更换可用 Key 后，刷新余额并重试。",
      canOpenConfig: true,
      canRefreshAccount: true,
    };
  }

  if (/timeout|timed\s*out|超时|network|fetch|econn|enotfound|socket|请求失败|服务不可用|temporarily|gateway|\b502\b|\b503\b|\b504\b/.test(text)) {
    return {
      ...base,
      title: "网络或服务临时异常",
      summary: rawError || rawSyncError || "请求 Codia 时出现网络或服务波动。",
      action: hasPreparedPdf ? "中间 PDF 已保留，可直接重试。" : "请稍后重新创建任务。",
      canRefreshAccount: true,
    };
  }

  if (/pdf|upload|file|image|格式|文件|下载|读取|解析|invalid|unsupported|too\s*large|大小|尺寸/.test(text)) {
    return {
      ...base,
      title: "源文件处理异常",
      summary: rawError || rawSyncError || "源图片或 PDF 在准备/上传时失败。",
      action: hasPreparedPdf ? "可直接重试；如果连续失败，导出任务包用于排查。" : "检查源图链接、文件格式和文件大小后重新提交。",
    };
  }

  return {
    ...base,
    title: "Codia 转换失败",
    summary: rawError || rawSyncError || "第三方转换任务返回失败。",
    action: hasPreparedPdf ? "建议先重试；如果连续失败，导出任务包用于排查。" : "请重新创建任务或更换源文件。",
    canRefreshAccount: true,
  };
}

function downloadUrl(url: string, filename: string) {
  if (!url.startsWith("/api/local-file/")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}download=1&filename=${encodeURIComponent(filename)}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function filenameFromDisposition(value: string | null) {
  if (!value) return "";
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

function safeDownloadName(value: string, fallback: string) {
  return (value || fallback).replace(/[\\/:*?"<>|\r\n]+/g, "-").trim() || fallback;
}

function sanitizeDraftTaskName(value: string) {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

function fileBaseName(name: string) {
  return (name || "").replace(/\.[^.]+$/, "").trim();
}

function normalizeImageRecord(record: Record<string, unknown>): CanvasConversionImage | null {
  const id = typeof record.id === "string" ? record.id : "";
  const imageUrl = typeof record.image_url === "string" ? record.image_url : "";
  if (!id || !imageUrl || imageUrl.startsWith("blob:")) return null;
  if (record.status && typeof record.status === "string" && record.status !== "completed") return null;
  return {
    id,
    image_url: imageUrl,
    project_id: typeof record.project_id === "string" ? record.project_id : null,
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    model: typeof record.model === "string" ? record.model : "",
    size: typeof record.size === "string" ? record.size : "",
    canvas_width: typeof record.canvas_width === "number" ? record.canvas_width : null,
    canvas_height: typeof record.canvas_height === "number" ? record.canvas_height : null,
    created_at: typeof record.created_at === "string" ? record.created_at : null,
  };
}

function uniqueImages(images: CanvasConversionImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (!image.id || !image.image_url || seen.has(image.id) || seen.has(image.image_url)) return false;
    seen.add(image.image_url);
    seen.add(image.id);
    return true;
  });
}

function taskToDraftImages(task: ConversionTask): CanvasConversionImage[] {
  if (task.source_type !== "images") return [];
  const images: CanvasConversionImage[] = (task.source_files || []).flatMap((file, index) => {
    const imageUrl = file.source_url || file.thumbnail_url || "";
    if (!imageUrl) return [];
    return [{
      id: `task-${task.id}-${index}-${imageUrl}`,
      image_url: imageUrl,
      project_id: task.project_id || null,
      prompt: file.name,
      model: "转换任务",
      size: sourceDimensions(file),
      canvas_width: file.width ?? null,
      canvas_height: file.height ?? null,
      created_at: task.created_at,
    }];
  });
  return uniqueImages(images);
}

export default function ConversionCenter({
  projectId,
  authHeaders,
  codiaApiKey = "",
  codiaBaseUrl = "https://api.codia.ai",
  codiaProviderLabel = "Codia",
  onOpenConfig,
  canvasImages = [],
}: ConversionCenterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const authHeadersRef = useRef(authHeaders);
  const draftPageNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const draftPageRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const draggingPageKeyRef = useRef("");
  const dragGrabOffsetYRef = useRef(0);
  const dragPointerYRef = useRef<number | null>(null);
  const dragLatestClientYRef = useRef<number | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartClientYRef = useRef<number | null>(null);
  const dragActivatedRef = useRef(false);
  const draggingPageOffsetRef = useRef(0);
  const applyDraftPageDragRef = useRef<(clientY: number) => void>(() => {});
  const dragWindowCleanupRef = useRef<() => void>(() => {});
  const previousBodyCursorRef = useRef("");
  const previousBodyUserSelectRef = useRef("");
  const [localCodiaApiKey, setLocalCodiaApiKey] = useState(codiaApiKey);
  const [codiaConfigOpen, setCodiaConfigOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pickedImages, setPickedImages] = useState<CanvasConversionImage[]>([]);
  const [pageOrder, setPageOrder] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId || ALL_PROJECTS);
  const [projectImages, setProjectImages] = useState<CanvasConversionImage[]>([]);
  const [imageQuery, setImageQuery] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageMessage, setImageMessage] = useState("");
  const [tasks, setTasks] = useState<ConversionTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>(ALL_TASKS);
  const [taskProjectFilter, setTaskProjectFilter] = useState<string>(ALL_TASKS);
  const [taskQuery, setTaskQuery] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [usedCredits, setUsedCredits] = useState<number | null>(null);
  const [accountMessage, setAccountMessage] = useState("");
  const [usageItems, setUsageItems] = useState<Array<Record<string, unknown>>>([]);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [retryingTaskId, setRetryingTaskId] = useState("");
  const [exportingPackageTaskId, setExportingPackageTaskId] = useState("");
  const [archivingTaskId, setArchivingTaskId] = useState("");
  const [syncingTaskId, setSyncingTaskId] = useState("");
  const [batchTaskAction, setBatchTaskAction] = useState("");
  const [message, setMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [draggingPageKey, setDraggingPageKey] = useState("");
  const [showOnlyPicked, setShowOnlyPicked] = useState(false);
  const [imageSortMode, setImageSortMode] = useState<"recent" | "oldest">("recent");
  const [lastPickedImageId, setLastPickedImageId] = useState("");
  const [taskCompactMode, setTaskCompactMode] = useState(true);

  useEffect(() => {
    authHeadersRef.current = authHeaders;
  }, [authHeaders]);

  useEffect(() => {
    setLocalCodiaApiKey(codiaApiKey);
  }, [codiaApiKey]);

  const setDraggingPageVisualOffset = useCallback((offset: number) => {
    draggingPageOffsetRef.current = offset;
    const activeKey = draggingPageKeyRef.current;
    const node = activeKey ? draftPageNodeRefs.current.get(activeKey) : null;
    if (!node) return;
    if (Math.abs(offset) < 0.5) {
      node.style.removeProperty("--draft-page-drag-transform");
      return;
    }
    node.style.setProperty("--draft-page-drag-transform", `translate3d(0, ${offset.toFixed(2)}px, 0)`);
  }, []);

  useEffect(() => {
    return () => {
      dragWindowCleanupRef.current();
      if (dragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAnimationFrameRef.current);
      }
      setDraggingPageVisualOffset(0);
      document.body.style.cursor = previousBodyCursorRef.current;
      document.body.style.userSelect = previousBodyUserSelectRef.current;
    };
  }, [setDraggingPageVisualOffset]);

  const getAuthHeaders = useCallback(() => authHeadersRef.current(), []);

  const conversionHeaders = useCallback((apiKeyOverride?: string) => {
    const headers = { ...getAuthHeaders() };
    const key = (apiKeyOverride !== undefined ? apiKeyOverride : localCodiaApiKey).trim();
    if (key) headers["x-codia-api-key"] = key;
    if (codiaBaseUrl.trim()) headers["x-codia-base-url"] = codiaBaseUrl.trim();
    return headers;
  }, [codiaBaseUrl, getAuthHeaders, localCodiaApiKey]);

  const validSeedImages = useMemo(
    () => uniqueImages(canvasImages.filter((image) => image.image_url && !image.image_url.startsWith("blob:"))),
    [canvasImages],
  );

  useEffect(() => {
    if (validSeedImages.length === 0) return;
    setPickedImages((current) => uniqueImages([...validSeedImages, ...current]));
    const seedProjectId = validSeedImages[0]?.project_id;
    if (seedProjectId) setSelectedProjectId(seedProjectId);
  }, [validSeedImages]);

  useEffect(() => {
    if (projectId && selectedProjectId === ALL_PROJECTS) {
      setSelectedProjectId(projectId);
    }
  }, [projectId, selectedProjectId]);

  const activeTaskCount = useMemo(
    () => tasks.filter(isTaskActive).length,
    [tasks],
  );
  const resultSyncTaskCount = useMemo(
    () => tasks.filter(needsTaskResultSync).length,
    [tasks],
  );
  const succeededTaskCount = useMemo(
    () => tasks.filter((task) => task.status === "succeeded" && Boolean(task.ppt_url)).length,
    [tasks],
  );
  const failedTaskCount = useMemo(
    () => tasks.filter((task) => task.status === "failed").length,
    [tasks],
  );

  const pickedIdSet = useMemo(() => new Set(pickedImages.map((image) => image.id)), [pickedImages]);

  const uploadPdfCount = useMemo(() => files.filter(isPdfFileLike).length, [files]);
  const uploadPdfFiles = useMemo(() => files.filter(isPdfFileLike), [files]);
  const uploadImageCount = files.length - uploadPdfCount;
  const baseDraftPages = useMemo(() => createDraftPages(files, pickedImages), [files, pickedImages]);
  const baseDraftPageKeys = useMemo(() => baseDraftPages.map((page) => page.key), [baseDraftPages]);
  const draftPages = useMemo(() => {
    const pages = baseDraftPages;
    if (pages.length === 0) return pages;
    const pageMap = new Map(pages.map((page) => [page.key, page]));
    const orderedKeys = pageOrder.filter((key) => pageMap.has(key));
    const orderedSet = new Set(orderedKeys);
    return [
      ...orderedKeys.map((key) => pageMap.get(key)).filter((page): page is DraftPage => Boolean(page)),
      ...pages.filter((page) => !orderedSet.has(page.key)),
    ];
  }, [baseDraftPages, pageOrder]);
  const canReorderPages = uploadPdfCount === 0 && draftPages.length > 1;
  const draftPageOrderSignature = useMemo(() => draftPages.map((page) => page.key).join("|"), [draftPages]);
  const mixedPdfAndImages = uploadPdfCount > 0 && (pickedImages.length > 0 || files.length > 1);
  const submitPageCount = uploadPdfCount > 0 ? uploadPdfCount : uploadImageCount + pickedImages.length;
  const submitDisabled = submitting || batchSubmitting || submitPageCount === 0 || mixedPdfAndImages;
  const createReadiness = useMemo(() => {
    if (mixedPdfAndImages) {
      return {
        tone: "error" as const,
        title: "PDF 不能和图片混合提交",
        detail: "请先移除 PDF 或图片，只保留一种输入类型。",
      };
    }
    if (submitPageCount === 0) {
      return {
        tone: "muted" as const,
        title: "等待选择转换内容",
        detail: "选择项目图片、上传图片或 PDF 后，可以直接创建转换任务。",
      };
    }
    if (accountMessage) {
      return {
        tone: "warning" as const,
        title: "Codia 状态需要确认",
        detail: `${accountMessage}。建议先检查 Key 或刷新余额，再创建任务。`,
      };
    }
    if (credits !== null && credits <= 0) {
      return {
        tone: "warning" as const,
        title: "余额不足",
        detail: "当前 Codia 余额为 0，创建任务可能失败。",
      };
    }
    if (credits !== null && submitPageCount > 0 && credits < submitPageCount) {
      return {
        tone: "warning" as const,
        title: "余额可能偏低",
        detail: `当前余额 ${credits}，本次 ${submitPageCount} 页。实际消耗以 Codia 预估为准。`,
      };
    }
    return {
      tone: "ready" as const,
      title: "可以创建任务",
      detail: uploadPdfCount > 0 ? "将直接提交上传 PDF。" : "将按当前页序生成高清 PDF 后提交。",
    };
  }, [accountMessage, credits, mixedPdfAndImages, submitPageCount, uploadPdfCount]);

  const projectImageOrderMap = useMemo(
    () => new Map(projectImages.map((image, index) => [image.id, index])),
    [projectImages],
  );

  const filteredProjectImages = useMemo(() => {
    const query = imageQuery.trim().toLowerCase();
    let images = query
      ? projectImages.filter((image, index) => {
        const text = `${imageDisplayName(image, index)} ${image.prompt || ""} ${image.model || ""} ${image.size || ""}`.toLowerCase();
        return text.includes(query);
      })
      : projectImages.slice();

    images.sort((a, b) => {
      const aTime = Date.parse(a.created_at || "");
      const bTime = Date.parse(b.created_at || "");
      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      if (safeATime !== safeBTime) {
        return imageSortMode === "recent" ? safeBTime - safeATime : safeATime - safeBTime;
      }
      return (projectImageOrderMap.get(a.id) ?? 0) - (projectImageOrderMap.get(b.id) ?? 0);
    });

    if (showOnlyPicked) {
      images = images.filter((image) => pickedIdSet.has(image.id));
    }

    return images;
  }, [imageQuery, imageSortMode, pickedIdSet, projectImageOrderMap, projectImages, showOnlyPicked]);

  const fileSummary = useMemo(() => {
    const pdfCount = files.filter(isPdfFileLike).length;
    const imageCount = files.length - pdfCount;
    const canvasCount = pickedImages.length;
    if (files.length === 0 && canvasCount === 0) return "未选择内容";
    const parts: string[] = [];
    if (pdfCount > 0) parts.push(`${pdfCount} 个 PDF`);
    if (imageCount > 0) parts.push(`${imageCount} 张上传图片`);
    if (canvasCount > 0) parts.push(`${canvasCount} 张项目图片`);
    return parts.join(" + ");
  }, [files, pickedImages.length]);

  const pickedSourceSummary = useMemo(() => {
    if (pickedImages.length === 0) return "";
    const counts = new Map<string, number>();
    pickedImages.forEach((image) => {
      const label = imageSourceLabel(image);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([label, count]) => `${label} ${count}`).join(" / ");
  }, [pickedImages]);

  const projectName = useCallback((id?: string | null) => {
    if (!id) return "未归属项目";
    return projects.find((project) => project.id === id)?.name || "项目图片";
  }, [projects]);

  const autoTaskName = useMemo(() => {
    if (files.length === 1 && uploadPdfCount === 1 && pickedImages.length === 0) {
      return sanitizeDraftTaskName(fileBaseName(files[0].name) || "PDF转PPT");
    }

    const totalImageCount = uploadImageCount + pickedImages.length;
    if (totalImageCount > 0) {
      if (pickedImages.length > 0 && uploadImageCount === 0) {
        const projectIds = Array.from(new Set(pickedImages.map((image) => image.project_id).filter(Boolean))) as string[];
        const base = projectIds.length === 1 ? projectName(projectIds[0]) : "多项目图片";
        return sanitizeDraftTaskName(`${base}-图片转PPT-${pickedImages.length}页`);
      }
      if (uploadImageCount > 0 && pickedImages.length === 0) {
        const firstName = fileBaseName(files.find((file) => !isPdfFileLike(file))?.name || "");
        return sanitizeDraftTaskName(`${firstName || "上传图片"}-图片转PPT-${uploadImageCount}页`);
      }
      return sanitizeDraftTaskName(`混合图片转PPT-${totalImageCount}页`);
    }

    return "图片转可编辑PPT";
  }, [files, pickedImages, projectName, uploadImageCount, uploadPdfCount]);

  const orderedPickedImages = useMemo(
    () => draftPages.flatMap((page) => page.type === "canvas" ? [page.image] : []),
    [draftPages],
  );
  const pickedImageOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    draftPages.forEach((page, index) => {
      if (page.type === "canvas") {
        map.set(page.image.id, index + 1);
      }
    });
    return map;
  }, [draftPages]);

  const batchProjectGroups = useMemo<BatchProjectGroup[]>(() => {
    const groups = new Map<string, BatchProjectGroup>();
    orderedPickedImages.forEach((image) => {
      const projectIdValue = image.project_id || null;
      const key = projectIdValue || "__unassigned";
      const existing = groups.get(key);
      if (existing) {
        existing.images.push(image);
        return;
      }
      groups.set(key, {
        key,
        projectId: projectIdValue,
        name: projectName(projectIdValue),
        images: [image],
      });
    });
    return Array.from(groups.values());
  }, [orderedPickedImages, projectName]);

  const canCreateProjectBatches = files.length === 0 && batchProjectGroups.length > 1;
  const recentUsageItems = useMemo(() => usageItems.slice(0, 5), [usageItems]);
  const recentUsageCredits = useMemo(
    () => recentUsageItems.reduce((sum, item) => sum + (usageItemCredits(item) || 0), 0),
    [recentUsageItems],
  );
  const chargedTaskCredits = useMemo(
    () => tasks.reduce((sum, task) => sum + (task.charged_credits || 0), 0),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (!taskStatusMatches(task, taskStatusFilter)) return false;
      if (taskProjectFilter !== ALL_TASKS && (task.project_id || "") !== taskProjectFilter) return false;
      if (!query) return true;
      const searchText = [
        task.source_name,
        STATUS_LABEL[task.status],
        task.codia_status || "",
        task.error_message || "",
        task.sync_error || "",
        projectName(task.project_id),
      ].join(" ").toLowerCase();
      return searchText.includes(query);
    });
  }, [projectName, taskProjectFilter, taskQuery, taskStatusFilter, tasks]);

  const selectableFilteredTaskIds = useMemo(
    () => filteredTasks.filter((task) => !isTaskActive(task)).map((task) => task.id),
    [filteredTasks],
  );

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const selectedTaskCount = selectedTaskIds.length;
  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedTaskIdSet.has(task.id) && !isTaskActive(task)),
    [selectedTaskIdSet, tasks],
  );
  const selectedDownloadableTasks = useMemo(
    () => selectedTasks.filter((task) => Boolean(task.ppt_url)),
    [selectedTasks],
  );
  const selectedArchivableTasks = useMemo(
    () => selectedDownloadableTasks.filter((task) => !task.archived_asset_id),
    [selectedDownloadableTasks],
  );
  const selectedSyncableTasks = useMemo(
    () => selectedTasks.filter((task) => Boolean(task.codia_task_id)),
    [selectedTasks],
  );
  const selectedRetryableTasks = useMemo(
    () => selectedTasks.filter((task) => Boolean(task.prepared_pdf_url)),
    [selectedTasks],
  );

  const selectedTask = useMemo(
    () => {
      const current = tasks.find((task) => task.id === selectedTaskId);
      if (current && filteredTasks.some((task) => task.id === current.id)) return current;
      return filteredTasks[0] || null;
    },
    [filteredTasks, selectedTaskId, tasks],
  );

  const selectedTaskIssue = useMemo(
    () => selectedTask ? taskIssueDiagnosis(selectedTask, accountMessage) : null,
    [accountMessage, selectedTask],
  );

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((id) => tasks.some((task) => task.id === id && !isTaskActive(task))));
  }, [tasks]);

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    const activeKey = draggingPageKeyRef.current;
    draftPageNodeRefs.current.forEach((node, key) => {
      node.getAnimations().forEach((animation) => animation.cancel());
      const rect = node.getBoundingClientRect();
      const isActive = key === activeKey;
      nextRects.set(
        key,
        isActive ? new DOMRect(rect.x, rect.y - draggingPageOffsetRef.current, rect.width, rect.height) : rect,
      );
    });

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prefersReducedMotion) {
      nextRects.forEach((rect, key) => {
        const previousRect = draftPageRectsRef.current.get(key);
        const node = draftPageNodeRefs.current.get(key);
        if (!previousRect || !node) return;
        if (key === activeKey) {
          const currentOffset = draggingPageOffsetRef.current;
          const nextOffset = previousRect.top + currentOffset - rect.top;
          if (Math.abs(nextOffset - draggingPageOffsetRef.current) > 0.5) {
            setDraggingPageVisualOffset(nextOffset);
          }
          return;
        }
        const deltaX = previousRect.left - rect.left;
        const deltaY = previousRect.top - rect.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

        node.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: 140,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
        );
      });
    }

    draftPageRectsRef.current = nextRects;
  }, [draftPageOrderSignature, draggingPageKey, setDraggingPageVisualOffset]);

  useEffect(() => {
    if (uploadPdfCount > 0 || baseDraftPageKeys.length === 0) {
      setPageOrder((current) => current.length > 0 ? [] : current);
      return;
    }

    setPageOrder((current) => {
      const keySet = new Set(baseDraftPageKeys);
      const kept = current.filter((key) => keySet.has(key));
      const keptSet = new Set(kept);
      const next = [...kept, ...baseDraftPageKeys.filter((key) => !keptSet.has(key))];
      if (current.length === next.length && current.every((key, index) => key === next[index])) return current;
      return next;
    });
  }, [baseDraftPageKeys, uploadPdfCount]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch("/api/projects", { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "读取项目失败");
      const items = Array.isArray(data.projects) ? data.projects as ProjectOption[] : [];
      setProjects(items.map((item) => ({ id: item.id, name: item.name || "未命名项目" })));
      setImageMessage("");
    } catch (error) {
      setImageMessage(error instanceof Error ? error.message : "读取项目失败");
    } finally {
      setLoadingProjects(false);
    }
  }, [getAuthHeaders]);

  const loadProjectImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      const params = new URLSearchParams({ pageSize: "240" });
      if (selectedProjectId !== ALL_PROJECTS) params.set("projectId", selectedProjectId);
      const res = await fetch(`/api/history?${params.toString()}`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "读取项目图片失败");
      const records = Array.isArray(data.records) ? data.records as Array<Record<string, unknown>> : [];
      setProjectImages(uniqueImages(records.map(normalizeImageRecord).filter((image): image is CanvasConversionImage => Boolean(image))));
      setImageMessage("");
    } catch (error) {
      setProjectImages([]);
      setImageMessage(error instanceof Error ? error.message : "读取项目图片失败");
    } finally {
      setLoadingImages(false);
    }
  }, [getAuthHeaders, selectedProjectId]);

  const loadAccount = useCallback(async (apiKeyOverride?: string) => {
    setLoadingAccount(true);
    try {
      const [creditsRes, usageRes] = await Promise.all([
        fetch("/api/codia/credits", { headers: conversionHeaders(apiKeyOverride) }),
        fetch("/api/codia/usage?page=1&page_size=10", { headers: conversionHeaders(apiKeyOverride) }),
      ]);
      const creditsJson = await creditsRes.json().catch(() => ({}));
      const usageJson = await usageRes.json().catch(() => ({}));
      if (!creditsRes.ok) throw new Error(creditsJson.error || "Codia 未连接");
      setCredits(extractCredits(creditsJson.data));
      setUsedCredits(extractUsedCredits(creditsJson.data));
      const usageData = usageJson.data && typeof usageJson.data === "object" ? usageJson.data as Record<string, unknown> : {};
      const items = Array.isArray(usageData.items) ? usageData.items : Array.isArray(usageData.records) ? usageData.records : [];
      setUsageItems(items as Array<Record<string, unknown>>);
      setAccountMessage("");
    } catch (error) {
      setCredits(null);
      setUsedCredits(null);
      setUsageItems([]);
      setAccountMessage(error instanceof Error ? error.message : "Codia 状态读取失败");
    } finally {
      setLoadingAccount(false);
    }
  }, [conversionHeaders]);

  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) setLoadingTasks(true);
    try {
      const res = await fetch("/api/conversion/tasks", { headers: conversionHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "读取转换任务失败");
      const items = Array.isArray(data.items) ? data.items as ConversionTask[] : [];
      setTasks(items);
      setSelectedTaskId((current) => current && items.some((task) => task.id === current) ? current : items[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取转换任务失败");
    } finally {
      if (!silent) setLoadingTasks(false);
    }
  }, [conversionHeaders]);

  useEffect(() => {
    void loadProjects();
    void loadAccount();
    void loadTasks();
  }, [loadAccount, loadProjects, loadTasks]);

  useEffect(() => {
    void loadProjectImages();
  }, [loadProjectImages]);

  useEffect(() => {
    if (activeTaskCount + resultSyncTaskCount === 0) return;
    const timer = window.setInterval(() => void loadTasks(true), 3000);
    return () => window.clearInterval(timer);
  }, [activeTaskCount, loadTasks, resultSyncTaskCount]);

  const appendFiles = useCallback((input: FileList | File[]) => {
    const nextFiles = Array.from(input);
    setFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}-${file.size}`));
      const merged = nextFiles.filter((file) => !seen.has(`${file.name}-${file.size}`));
      return [...prev, ...merged].slice(0, 200);
    });
    setMessage("");
  }, []);

  const toggleImage = useCallback((image: CanvasConversionImage, options?: { silentMessage?: boolean }) => {
    setPickedImages((current) => {
      if (current.some((item) => item.id === image.id)) return current.filter((item) => item.id !== image.id);
      return uniqueImages([...current, image]);
    });
    setLastPickedImageId(image.id);
    if (!options?.silentMessage) setMessage("");
  }, []);

  const clearPickedImages = useCallback(() => {
    setPickedImages([]);
    setLastPickedImageId("");
  }, []);

  const selectVisibleImages = useCallback(() => {
    setPickedImages((current) => uniqueImages([...current, ...filteredProjectImages]));
    if (filteredProjectImages.length > 0) {
      setLastPickedImageId(filteredProjectImages[filteredProjectImages.length - 1].id);
    }
    setMessage(filteredProjectImages.length > 0 ? `已加入当前视图 ${filteredProjectImages.length} 张图片` : "当前视图没有可选图片");
  }, [filteredProjectImages]);

  const selectCurrentProjectImages = useCallback(() => {
    const targetProjectId = selectedProjectId !== ALL_PROJECTS ? selectedProjectId : projectId;
    const images = selectedProjectId !== ALL_PROJECTS
      ? projectImages
      : projectImages.filter((image) => image.project_id === targetProjectId);
    const nextImages = uniqueImages(images);
    if (!targetProjectId || nextImages.length === 0) {
      setMessage("当前项目没有可选图片，可切换项目后再试");
      return;
    }
    setPickedImages((current) => uniqueImages([...current, ...nextImages]));
    setLastPickedImageId(nextImages[nextImages.length - 1]?.id || "");
    setMessage(`已加入${projectName(targetProjectId)} ${nextImages.length} 张图片`);
  }, [projectId, projectImages, projectName, selectedProjectId]);

  const invertVisibleImages = useCallback(() => {
    if (filteredProjectImages.length === 0) return;
    setPickedImages((current) => {
      const visibleSet = new Set(filteredProjectImages.map((image) => image.id));
      const currentSet = new Set(current.map((image) => image.id));
      const keepHiddenSelections = current.filter((image) => !visibleSet.has(image.id));
      const toggledVisible = filteredProjectImages.filter((image) => !currentSet.has(image.id));
      return uniqueImages([...keepHiddenSelections, ...toggledVisible]);
    });
    setLastPickedImageId(filteredProjectImages[filteredProjectImages.length - 1]?.id || "");
    setMessage(`已反选当前视图 ${filteredProjectImages.length} 张图片`);
  }, [filteredProjectImages]);

  const handleProjectImageClick = useCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    image: CanvasConversionImage,
    index: number,
  ) => {
    if (event.shiftKey && filteredProjectImages.length > 0) {
      const anchorId = lastPickedImageId || image.id;
      const anchorIndex = filteredProjectImages.findIndex((item) => item.id === anchorId);
      if (anchorIndex >= 0) {
        const [start, end] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
        const range = filteredProjectImages.slice(start, end + 1);
        setPickedImages((current) => uniqueImages([...current, ...range]));
        setLastPickedImageId(image.id);
        setMessage(`已连续选择 ${range.length} 张图片`);
        return;
      }
    }

    toggleImage(image, { silentMessage: true });
  }, [filteredProjectImages, lastPickedImageId, toggleImage]);

  const captureDraftPageRects = useCallback((mode: "flow" | "visual" = "flow") => {
    const rects = new Map<string, DOMRect>();
    const activeKey = draggingPageKeyRef.current;
    draftPageNodeRefs.current.forEach((node, key) => {
      const rect = node.getBoundingClientRect();
      const shouldCaptureFlowRect = mode === "flow" && key === activeKey;
      rects.set(
        key,
        shouldCaptureFlowRect ? new DOMRect(rect.x, rect.y - draggingPageOffsetRef.current, rect.width, rect.height) : rect,
      );
    });
    draftPageRectsRef.current = rects;
  }, []);

  const moveDraftPageToIndex = useCallback((fromKey: string, targetIndex: number) => {
    if (!fromKey) return;
    captureDraftPageRects();
    setPageOrder((current) => {
      const order = current.length > 0 ? current : baseDraftPageKeys;
      if (!order.includes(fromKey)) return current;
      const withoutDragged = order.filter((key) => key !== fromKey);
      const next = [...withoutDragged];
      const insertIndex = Math.max(0, Math.min(targetIndex, next.length));
      next.splice(insertIndex, 0, fromKey);
      if (order.length === next.length && order.every((key, index) => key === next[index])) return current;
      return next;
    });
  }, [baseDraftPageKeys, captureDraftPageRects]);

  const moveDraftPageByProjectedPosition = useCallback((
    activeKey: string,
    projectedTop: number,
    projectedBottom: number,
    direction: "up" | "down" | null,
  ) => {
    const activeIndex = draftPages.findIndex((page) => page.key === activeKey);
    if (activeIndex < 0) return;

    const withoutActive = draftPages.filter((page) => page.key !== activeKey);
    const earlyOverlap = (rect: DOMRect) => Math.min(18, Math.max(8, rect.height * 0.12));

    if (direction === "down") {
      let targetKey = "";
      for (let index = activeIndex + 1; index < draftPages.length; index += 1) {
        const page = draftPages[index];
        const rect = draftPageNodeRefs.current.get(page.key)?.getBoundingClientRect();
        if (!rect) continue;
        if (projectedBottom >= rect.top + earlyOverlap(rect)) {
          targetKey = page.key;
        }
      }
      if (targetKey) {
        const targetIndex = withoutActive.findIndex((page) => page.key === targetKey);
        if (targetIndex >= 0) moveDraftPageToIndex(activeKey, targetIndex + 1);
      }
      return;
    }

    if (direction === "up") {
      let targetKey = "";
      for (let index = activeIndex - 1; index >= 0; index -= 1) {
        const page = draftPages[index];
        const rect = draftPageNodeRefs.current.get(page.key)?.getBoundingClientRect();
        if (!rect) continue;
        if (projectedTop <= rect.bottom - earlyOverlap(rect)) {
          targetKey = page.key;
        }
      }
      if (targetKey) {
        const targetIndex = withoutActive.findIndex((page) => page.key === targetKey);
        if (targetIndex >= 0) moveDraftPageToIndex(activeKey, targetIndex);
      }
    }
  }, [draftPages, moveDraftPageToIndex]);

  const applyDraftPageDrag = useCallback((clientY: number) => {
    const activeKey = draggingPageKeyRef.current;
    if (!activeKey) return;
    const previousY = dragPointerYRef.current;
    const deltaY = previousY === null ? 0 : clientY - previousY;
    const direction = Math.abs(deltaY) < 0.5 ? null : deltaY > 0 ? "down" : "up";
    dragPointerYRef.current = clientY;
    const activeNode = draftPageNodeRefs.current.get(activeKey);
    if (!activeNode) return;
    const activeRect = activeNode.getBoundingClientRect();
    const flowTop = activeRect.top - draggingPageOffsetRef.current;
    const nextOffset = clientY - dragGrabOffsetYRef.current - flowTop;
    const projectedTop = flowTop + nextOffset;
    const projectedBottom = projectedTop + activeRect.height;

    setDraggingPageVisualOffset(nextOffset);
    moveDraftPageByProjectedPosition(activeKey, projectedTop, projectedBottom, direction);
  }, [moveDraftPageByProjectedPosition, setDraggingPageVisualOffset]);

  useEffect(() => {
    applyDraftPageDragRef.current = applyDraftPageDrag;
  }, [applyDraftPageDrag]);

  const scheduleDraftPageDrag = useCallback((clientY: number) => {
    dragLatestClientYRef.current = clientY;
    if (dragAnimationFrameRef.current !== null) return;
    dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
      dragAnimationFrameRef.current = null;
      const nextClientY = dragLatestClientYRef.current;
      if (nextClientY !== null) {
        applyDraftPageDragRef.current(nextClientY);
      }
    });
  }, []);

  const finishDraftPageDrag = useCallback(() => {
    if (!draggingPageKeyRef.current) return;
    dragWindowCleanupRef.current();
    dragWindowCleanupRef.current = () => {};
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }
    captureDraftPageRects("visual");
    setDraggingPageVisualOffset(0);
    draggingPageKeyRef.current = "";
    dragGrabOffsetYRef.current = 0;
    dragPointerYRef.current = null;
    dragLatestClientYRef.current = null;
    dragPointerIdRef.current = null;
    dragStartClientYRef.current = null;
    dragActivatedRef.current = false;
    setDraggingPageKey("");
    document.body.style.cursor = previousBodyCursorRef.current;
    document.body.style.userSelect = previousBodyUserSelectRef.current;
  }, [captureDraftPageRects, setDraggingPageVisualOffset]);

  const startDraftPageDrag = useCallback((event: ReactPointerEvent<HTMLElement>, pageKey: string) => {
    if (!canReorderPages || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    if (draggingPageKeyRef.current) finishDraftPageDrag();
    dragWindowCleanupRef.current();
    captureDraftPageRects();
    previousBodyCursorRef.current = document.body.style.cursor;
    previousBodyUserSelectRef.current = document.body.style.userSelect;
    draggingPageKeyRef.current = pageKey;
    dragPointerIdRef.current = event.pointerId;
    dragGrabOffsetYRef.current = event.clientY - event.currentTarget.getBoundingClientRect().top;
    dragPointerYRef.current = event.clientY;
    dragLatestClientYRef.current = event.clientY;
    dragStartClientYRef.current = event.clientY;
    dragActivatedRef.current = false;
    setDraggingPageVisualOffset(0);
    setDraggingPageKey(pageKey);

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (dragPointerIdRef.current !== pointerEvent.pointerId) return;
      const startY = dragStartClientYRef.current;
      if (!dragActivatedRef.current) {
        if (startY === null || Math.abs(pointerEvent.clientY - startY) < 5) return;
        dragActivatedRef.current = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      pointerEvent.preventDefault();
      scheduleDraftPageDrag(pointerEvent.clientY);
    };
    const handlePointerEnd = (pointerEvent: PointerEvent) => {
      if (dragPointerIdRef.current !== pointerEvent.pointerId) return;
      if (dragActivatedRef.current) pointerEvent.preventDefault();
      finishDraftPageDrag();
    };
    const handleWindowBlur = () => finishDraftPageDrag();
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd, { passive: false });
    window.addEventListener("pointercancel", handlePointerEnd, { passive: false });
    window.addEventListener("blur", handleWindowBlur);
    dragWindowCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [canReorderPages, captureDraftPageRects, finishDraftPageDrag, scheduleDraftPageDrag, setDraggingPageVisualOffset]);

  const copyTaskToDraft = useCallback((task: ConversionTask) => {
    const images = taskToDraftImages(task);
    if (images.length === 0) {
      setMessage("这个任务没有可恢复的源图片，可直接重试中间 PDF");
      return;
    }
    setFiles([]);
    setPickedImages(images);
    setPageOrder(images.map(canvasImageKey));
    if (task.project_id) setSelectedProjectId(task.project_id);
    setMessage(`已复制 ${images.length} 页到待转换内容，可调整顺序后重新创建任务`);
  }, []);

  const saveCodiaKey = useCallback(async () => {
    const key = localCodiaApiKey.trim();
    if (key) {
      window.localStorage.setItem(STORAGE_CODIA_API_KEY, key);
      setLocalCodiaApiKey(key);
      setMessage("Codia Key 已保存，正在刷新账户状态");
    } else {
      window.localStorage.removeItem(STORAGE_CODIA_API_KEY);
      setMessage("已清空本地 Codia Key，将尝试使用服务端配置");
    }
    await loadAccount(key);
  }, [loadAccount, localCodiaApiKey]);

  const toggleTaskSelection = useCallback((task: ConversionTask) => {
    if (isTaskActive(task)) {
      setMessage("进行中的任务需要先取消，再删除历史记录");
      return;
    }
    setSelectedTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]);
  }, []);

  const toggleFilteredTaskSelection = useCallback(() => {
    if (selectableFilteredTaskIds.length === 0) return;
    setSelectedTaskIds((current) => {
      const visible = new Set(selectableFilteredTaskIds);
      const allVisibleSelected = selectableFilteredTaskIds.every((id) => current.includes(id));
      if (allVisibleSelected) return current.filter((id) => !visible.has(id));
      return Array.from(new Set([...current, ...selectableFilteredTaskIds]));
    });
  }, [selectableFilteredTaskIds]);

  const deleteSelectedTasks = useCallback(async () => {
    const ids = selectedTaskIds.filter((id) => tasks.some((task) => task.id === id && !isTaskActive(task)));
    if (ids.length === 0) {
      setMessage("请选择已完成、失败或已取消的历史任务");
      return;
    }
    if (!window.confirm(`删除选中的 ${ids.length} 个转换任务？此操作会移除历史记录和中间 PDF。`)) return;

    setMessage("");
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: conversionHeaders(),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "删除任务失败");
        }
        return id;
      }));
      setSelectedTaskIds([]);
      setMessage(`已删除 ${results.length} 个转换任务`);
      await loadTasks(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量删除任务失败");
    }
  }, [conversionHeaders, loadTasks, selectedTaskIds, tasks]);

  const buildConversionFormData = useCallback((options?: BuildConversionFormDataOptions) => {
    const targetFiles = options?.files ?? files;
    const targetImages = options?.images ?? pickedImages;
    const targetPages = options ? createDraftPages(targetFiles, targetImages) : draftPages;
    if (targetFiles.length === 0 && targetImages.length === 0) {
      throw new Error("请先选择项目图片、上传图片或 PDF");
    }
    const hasPdf = targetFiles.some(isPdfFileLike);
    if (hasPdf && (targetImages.length > 0 || targetFiles.length > 1)) {
      throw new Error("PDF 和图片请分开转换");
    }

    const form = new FormData();
    const taskProjectId = options?.projectIdOverride !== undefined
      ? options.projectIdOverride || ""
      : targetImages[0]?.project_id ?? (selectedProjectId !== ALL_PROJECTS ? selectedProjectId : projectId || "");
    if (taskProjectId) form.set("projectId", taskProjectId);
    const totalImageCount = targetFiles.filter((file) => !isPdfFileLike(file)).length + targetImages.length;
    form.set("name", options?.taskName || autoTaskName || (targetFiles.length === 1 && targetImages.length === 0 ? targetFiles[0].name.replace(/\.[^.]+$/, "") : `图片转PPT-${totalImageCount || targetFiles.length}页`));
    targetFiles.forEach((file) => form.append("files", file, file.name));
    if (!hasPdf && targetPages.length > 0) {
      form.set("pageOrder", JSON.stringify(targetPages.map((page) => page.key)));
    }
    if (targetImages.length > 0) {
      form.set("imageUrls", JSON.stringify(targetImages.map((image) => image.image_url)));
      form.set("imageMeta", JSON.stringify(targetImages.map((image, index) => ({
        url: image.image_url,
        name: imageDisplayName(image, index),
        width: image.canvas_width ?? null,
        height: image.canvas_height ?? null,
      }))));
    }

    return form;
  }, [autoTaskName, draftPages, files, pickedImages, projectId, selectedProjectId]);

  const createConversionTaskFromForm = useCallback(async (form: FormData) => {
    const res = await fetch("/api/conversion/ppt", {
      method: "POST",
      headers: conversionHeaders(),
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "创建转换任务失败");
    return data.task as ConversionTask | undefined;
  }, [conversionHeaders]);

  const submit = useCallback(async () => {
    let form: FormData;
    try {
      form = buildConversionFormData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请先选择转换内容");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const task = await createConversionTaskFromForm(form);
      setFiles([]);
      setPickedImages([]);
      setPageOrder([]);
      setSelectedTaskId(task?.id || "");
      setMessage("转换任务已创建");
      await Promise.all([loadTasks(true), loadAccount()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建转换任务失败");
    } finally {
      setSubmitting(false);
    }
  }, [buildConversionFormData, createConversionTaskFromForm, loadAccount, loadTasks]);

  const submitProjectBatches = useCallback(async () => {
    if (!canCreateProjectBatches) {
      setMessage("按项目批量创建只支持已选项目图片，不能混合上传文件");
      return;
    }

    setBatchSubmitting(true);
    setMessage("");
    try {
      const created: ConversionTask[] = [];
      for (const group of batchProjectGroups) {
        const form = buildConversionFormData({
          files: [],
          images: group.images,
          projectIdOverride: group.projectId,
          taskName: `${group.name}-图片转PPT-${group.images.length}页`,
        });
        try {
          const task = await createConversionTaskFromForm(form);
          if (task) created.push(task);
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "创建失败";
          throw new Error(`${group.name}：${messageText}`);
        }
      }
      setFiles([]);
      setPickedImages([]);
      setPageOrder([]);
      setSelectedTaskId(created[0]?.id || "");
      setMessage(`已按项目创建 ${created.length} 个转换任务`);
      await Promise.all([loadTasks(true), loadAccount()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量创建转换任务失败");
    } finally {
      setBatchSubmitting(false);
    }
  }, [batchProjectGroups, buildConversionFormData, canCreateProjectBatches, createConversionTaskFromForm, loadAccount, loadTasks]);

  const cancelTask = useCallback(async (task: ConversionTask) => {
    try {
      const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}/cancel`, {
        method: "POST",
        headers: conversionHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "取消任务失败");
      await loadTasks(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消任务失败");
    }
  }, [conversionHeaders, loadTasks]);

  const deleteTask = useCallback(async (task: ConversionTask) => {
    try {
      const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        headers: conversionHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "删除任务失败");
      await loadTasks(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除任务失败");
    }
  }, [conversionHeaders, loadTasks]);

  const retryTask = useCallback(async (task: ConversionTask) => {
    if (!task.prepared_pdf_url) {
      setMessage("这个任务没有中间 PDF，无法直接重试");
      return;
    }
    setRetryingTaskId(task.id);
    setMessage("");
    try {
      const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}/retry`, {
        method: "POST",
        headers: conversionHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "重试任务失败");
      setSelectedTaskId(data.task?.id || task.id);
      setMessage("已创建重试任务");
      await Promise.all([loadTasks(true), loadAccount()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重试任务失败");
    } finally {
      setRetryingTaskId("");
    }
  }, [conversionHeaders, loadAccount, loadTasks]);

  const syncTask = useCallback(async (task: ConversionTask) => {
    if (!task.codia_task_id) {
      setMessage("这个任务还没有 Codia 任务 ID");
      return;
    }

    setSyncingTaskId(task.id);
    setMessage("");
    try {
      const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}`, {
        headers: conversionHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步任务失败");
      const nextTask = data.task as ConversionTask | undefined;
      if (!nextTask) throw new Error("同步任务返回为空");
      setTasks((current) => current.map((item) => item.id === nextTask.id ? nextTask : item));
      setSelectedTaskId(nextTask.id);
      setMessage(nextTask.sync_error ? "同步失败，已记录错误信息" : "任务状态已同步");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步任务失败");
    } finally {
      setSyncingTaskId("");
    }
  }, [conversionHeaders]);

  const batchSyncTasks = useCallback(async (mode: "selected" | "result_pending") => {
    const selectedMode = mode === "selected";
    const ids = selectedMode ? selectedSyncableTasks.map((task) => task.id) : [];
    if (selectedMode && ids.length === 0) {
      setMessage("所选任务里没有可同步的 Codia 任务");
      return;
    }
    if (!selectedMode && resultSyncTaskCount === 0) {
      setMessage("当前没有待同步结果的任务");
      return;
    }

    setBatchTaskAction(selectedMode ? "sync-selected" : "sync-pending");
    setMessage("");
    try {
      const projectIdValue = !selectedMode && taskProjectFilter !== ALL_TASKS ? taskProjectFilter : "";
      const res = await fetch("/api/conversion/tasks/batch-sync", {
        method: "POST",
        headers: {
          ...conversionHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedMode ? { ids } : { scope: "result_pending", projectId: projectIdValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "批量同步失败");
      const items = Array.isArray(data.items) ? data.items as Array<{ task?: ConversionTask }> : [];
      const syncedTasks = items.map((item) => item.task).filter((task): task is ConversionTask => Boolean(task?.id));
      if (syncedTasks.length > 0) {
        setTasks((current) => {
          const nextById = new Map(syncedTasks.map((task) => [task.id, task]));
          return current.map((task) => nextById.get(task.id) || task);
        });
      }
      const synced = Number(data.synced || 0);
      const failed = Number(data.failed || 0);
      const skipped = Number(data.skipped || 0);
      setMessage(`同步完成：成功 ${synced} 个${failed > 0 ? `，失败 ${failed} 个` : ""}${skipped > 0 ? `，跳过 ${skipped} 个` : ""}`);
      await loadTasks(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量同步失败");
    } finally {
      setBatchTaskAction("");
    }
  }, [conversionHeaders, loadTasks, resultSyncTaskCount, selectedSyncableTasks, taskProjectFilter]);

  const exportTaskPackage = useCallback(async (task: ConversionTask) => {
    setExportingPackageTaskId(task.id);
    setMessage("");
    try {
      const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}/package`, {
        headers: conversionHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "导出任务包失败");
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(res.headers.get("content-disposition"))
        || safeDownloadName(`${task.source_name}_转换任务包.zip`, "转换任务包.zip");
      downloadBlob(blob, filename);
      setMessage("转换任务包已导出");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出任务包失败");
    } finally {
      setExportingPackageTaskId("");
    }
  }, [conversionHeaders]);

  const batchDownloadSelectedTasks = useCallback(async (mode: "pptx" | "package") => {
    const ids = mode === "pptx"
      ? selectedDownloadableTasks.map((task) => task.id)
      : selectedTasks.map((task) => task.id);
    if (ids.length === 0) {
      setMessage(mode === "pptx" ? "所选任务里没有可下载的 PPTX" : "请选择要导出的历史任务");
      return;
    }

    setBatchTaskAction(mode === "pptx" ? "download-pptx" : "export-package");
    setMessage("");
    try {
      const res = await fetch("/api/conversion/tasks/batch-download", {
        method: "POST",
        headers: {
          ...conversionHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids, mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "批量导出失败");
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(res.headers.get("content-disposition"))
        || (mode === "pptx" ? "PPTX批量下载.zip" : "转换任务包批量导出.zip");
      downloadBlob(blob, filename);
      const included = Number(res.headers.get("x-export-included") || ids.length);
      const requested = Number(res.headers.get("x-export-requested") || ids.length);
      setMessage(`${mode === "pptx" ? "PPTX" : "任务包"}批量导出完成：${included}/${requested}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量导出失败");
    } finally {
      setBatchTaskAction("");
    }
  }, [conversionHeaders, selectedDownloadableTasks, selectedTasks]);

  const archiveTaskResult = useCallback(async (task: ConversionTask) => {
    if (!task.ppt_url) {
      setMessage("转换结果还没有 PPTX 地址，请先同步结果");
      return;
    }

    setArchivingTaskId(task.id);
    setMessage("");
    try {
      const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}/archive`, {
        method: "POST",
        headers: conversionHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "归档转换结果失败");
      if (data.task) {
        setTasks((current) => current.map((item) => item.id === task.id ? data.task as ConversionTask : item));
      }
      setSelectedTaskId(data.task?.id || task.id);
      setMessage(data.alreadyArchived ? "这个转换结果已在资产库中" : "转换结果已归档到资产库");
      await loadTasks(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "归档转换结果失败");
    } finally {
      setArchivingTaskId("");
    }
  }, [conversionHeaders, loadTasks]);

  const archiveSelectedTaskResults = useCallback(async () => {
    const targets = selectedArchivableTasks;
    if (targets.length === 0) {
      setMessage("所选任务里没有可归档的 PPTX 结果");
      return;
    }

    setBatchTaskAction("archive");
    setMessage("");
    try {
      let archived = 0;
      let alreadyArchived = 0;
      for (const task of targets) {
        const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}/archive`, {
          method: "POST",
          headers: conversionHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `${task.source_name} 归档失败`);
        if (data.alreadyArchived) alreadyArchived += 1;
        else archived += 1;
      }
      setMessage(`批量归档完成：新增 ${archived} 个${alreadyArchived > 0 ? `，已存在 ${alreadyArchived} 个` : ""}`);
      await loadTasks(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量归档失败");
    } finally {
      setBatchTaskAction("");
    }
  }, [conversionHeaders, loadTasks, selectedArchivableTasks]);

  const retrySelectedTasks = useCallback(async () => {
    const targets = selectedRetryableTasks;
    if (targets.length === 0) {
      setMessage("所选任务里没有可重试的中间 PDF");
      return;
    }

    setBatchTaskAction("retry");
    setMessage("");
    try {
      const created: ConversionTask[] = [];
      let failed = 0;
      for (const task of targets) {
        try {
          const res = await fetch(`/api/conversion/tasks/${encodeURIComponent(task.id)}/retry`, {
            method: "POST",
            headers: conversionHeaders(),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `${task.source_name} 重试失败`);
          if (data.task) created.push(data.task as ConversionTask);
        } catch {
          failed += 1;
        }
      }
      if (created[0]?.id) setSelectedTaskId(created[0].id);
      setMessage(`批量重试完成：新建 ${created.length} 个任务${failed > 0 ? `，失败 ${failed} 个` : ""}`);
      await Promise.all([loadTasks(true), loadAccount()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量重试失败");
    } finally {
      setBatchTaskAction("");
    }
  }, [conversionHeaders, loadAccount, loadTasks, selectedRetryableTasks]);

  return (
    <div className="flex h-full max-h-[100dvh] min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground">
      <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">转换中心</div>
            <div className="truncate text-[10px] text-muted-foreground">图片 / PDF 转可编辑 PPT</div>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadProjects();
              void loadProjectImages();
              void loadAccount();
              void loadTasks();
            }}
            className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className={`h-4 w-4 ${loadingProjects || loadingImages || loadingAccount || loadingTasks ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="shrink-0 border-b border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium">Codia 配置</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{codiaProviderLabel} · {localCodiaApiKey.trim() ? "已使用路由/本地 Key" : "未填写本地 Key"}</div>
            </div>
            <button
              type="button"
              onClick={() => setCodiaConfigOpen((current) => !current)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {codiaConfigOpen ? "收起" : "配置"}
            </button>
          </div>
          {codiaConfigOpen && (
            <div className="mb-3 rounded-xl border border-border bg-background p-3">
              <input
                type="password"
                value={localCodiaApiKey}
                onChange={(event) => setLocalCodiaApiKey(event.target.value)}
                placeholder="输入 Codia API Key"
                className="h-8 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-border-secondary"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveCodiaKey()}
                  className="h-7 rounded-lg bg-foreground px-3 text-[10px] font-medium text-background hover:bg-foreground/90"
                >
                  保存并刷新
                </button>
                {onOpenConfig && (
                  <button
                    type="button"
                    onClick={onOpenConfig}
                    className="h-7 rounded-lg border border-border bg-card px-3 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    全局配置
                  </button>
                )}
              </div>
              <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">当前路由地址：{codiaBaseUrl || "https://api.codia.ai"}。本面板保存后只影响转换中心任务。</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-[10px] text-muted-foreground">余额</div>
              <div className="mt-1 text-lg font-semibold">{formatCredits(credits)}</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-[10px] text-muted-foreground">已用</div>
              <div className="mt-1 text-lg font-semibold">{formatCredits(usedCredits)}</div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-border bg-background">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div>
                <div className="text-xs font-medium">用量与扣费</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  任务实扣 {formatCredits(chargedTaskCredits)} · 最近记录 {formatCredits(recentUsageCredits)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadAccount()}
                className="rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                刷新
              </button>
            </div>
            {recentUsageItems.length > 0 ? (
              <div className="max-h-36 overflow-y-auto">
                {recentUsageItems.map((item, index) => (
                  <div key={`${index}-${String(item.request_id || item.id || usageItemTime(item))}`} className="border-b border-border/50 px-3 py-2 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 truncate text-[11px] text-foreground">{usageItemLabel(item)}</div>
                      <div className="shrink-0 text-[10px] text-muted-foreground">{formatCredits(usageItemCredits(item))} credits</div>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{formatDate(usageItemTime(item))}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-3 text-[10px] leading-relaxed text-muted-foreground">
                {loadingAccount ? "正在读取 Codia 用量..." : "暂无最近用量记录，创建任务后会在这里显示。"}
              </div>
            )}
          </div>
          {accountMessage && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <div>{accountMessage}</div>
              {onOpenConfig && (
                <button
                  type="button"
                  onClick={onOpenConfig}
                  className="mt-2 rounded-md border border-red-500/25 bg-background px-2 py-1 text-[10px] text-foreground hover:bg-muted"
                >
                  打开配置
                </button>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/avif,application/pdf,.png,.jpg,.jpeg,.webp,.avif,.pdf"
            className="hidden"
            onChange={(event) => {
              if (event.target.files) appendFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />

          <div className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">页面顺序确认</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{fileSummary}</div>
              </div>
              {(pickedImages.length > 0 || files.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setFiles([]);
                    clearPickedImages();
                    setPageOrder([]);
                  }}
                  className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  清空
                </button>
              )}
            </div>

            {files.some(isPdfFileLike) && (
              <div className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                PDF 会作为单独任务转换，不能和图片混合提交。
              </div>
            )}
            {pickedSourceSummary && (
              <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-[10px] text-muted-foreground">
                来源：{pickedSourceSummary}
              </div>
            )}

            {draftPages.length > 0 && (
              <div className="relative mt-3 max-h-[420px] space-y-2 overflow-y-auto overscroll-contain pr-1">
                {draftPages.map((page, index) => {
                  const isCanvasPage = page.type === "canvas";
                  const image = isCanvasPage ? page.image : null;
                  const label = isCanvasPage ? imageSourceLabel(page.image) : "本地上传";
                  const title = isCanvasPage ? imageDisplayName(page.image, index) : page.file.name;
                  const subtitle = isCanvasPage ? projectName(page.image.project_id) : formatBytes(page.file.size);
                  const isDraggingPage = draggingPageKey === page.key;
                  const imageOrder = isCanvasPage ? pickedImageOrderMap.get(page.image.id) : null;
                  return (
                    <div
                      key={page.key}
                      ref={(node) => {
                        if (node) {
                          draftPageNodeRefs.current.set(page.key, node);
                        } else {
                          draftPageNodeRefs.current.delete(page.key);
                        }
                      }}
                      style={isDraggingPage ? {
                        cursor: "grabbing",
                        transform: "var(--draft-page-drag-transform, translate3d(0, 0, 0))",
                        zIndex: 30,
                      } : undefined}
                      className={`group relative flex items-center gap-2 rounded-xl border bg-card p-2 shadow-sm will-change-transform transition-[border-color,box-shadow] duration-150 ${isDraggingPage ? "border-foreground shadow-[0_18px_44px_rgba(0,0,0,0.28)] ring-1 ring-foreground/10" : "border-border hover:border-border-secondary hover:shadow-md"}`}
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[10px] font-semibold text-foreground">
                        {index + 1}
                      </div>
                      <div className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                        {image ? (
                          <img src={image.image_url} alt="" draggable={false} className="h-full w-full object-contain" />
                        ) : (
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          第 {index + 1} 页 · {label}{imageOrder ? ` · 已选 #${imageOrder}` : ""}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{title}</div>
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">{subtitle}</div>
                      </div>
                      {canReorderPages && (
                        <button
                          type="button"
                          onPointerDown={(event) => startDraftPageDrag(event, page.key)}
                          className="flex h-7 w-7 shrink-0 touch-none items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground active:cursor-grabbing"
                          title="拖动调整顺序"
                          aria-label="拖动调整顺序"
                        >
                          <GripVertical className="h-4 w-4 cursor-grab" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (page.type === "upload") {
                            setFiles((prev) => prev.filter((item) => item !== page.file));
                          } else {
                            toggleImage(page.image);
                          }
                        }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="移除这一页"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {pickedImages.length === 0 && files.length === 0 && (
              <div className="mt-3 rounded-lg border border-dashed border-border bg-card px-3 py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
                从中间项目图片区选择图片，或上传本地图片 / PDF。
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              appendFiles(event.dataTransfer.files);
            }}
            className={`mt-3 flex w-full flex-col items-center justify-center rounded-xl border border-dashed p-5 text-center transition-colors ${dragOver ? "border-border-secondary bg-muted" : "border-border bg-background hover:bg-muted"}`}
          >
            <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
            <div className="text-xs font-medium">上传本地图片或 PDF</div>
            <div className="mt-1 text-[10px] text-muted-foreground">PDF 需单独转换，图片会按原比例生成 PDF</div>
          </button>

          {uploadPdfFiles.length > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-medium">上传 PDF</span>
                <button type="button" onClick={() => setFiles([])} className="text-[10px] text-muted-foreground hover:text-foreground">清空</button>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {uploadPdfFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs">{file.name}</div>
                      <div className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((item) => item !== file))}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="移除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`mt-3 rounded-xl border px-3 py-2 text-[10px] leading-relaxed ${
            createReadiness.tone === "error"
              ? "border-red-500/20 bg-red-500/10 text-red-500"
              : createReadiness.tone === "warning"
                ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-border bg-background text-muted-foreground"
          }`}>
            <div className="font-medium text-foreground">{createReadiness.title}</div>
            <div className="mt-1">{createReadiness.detail}</div>
            {submitPageCount > 0 && (
              <div className="mt-1">
                本次 {submitPageCount} 页{credits !== null ? ` · 当前余额 ${credits}` : " · 余额待刷新"}
              </div>
            )}
          </div>

          {canCreateProjectBatches && (
            <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2">
              <div className="text-[10px] font-medium text-foreground">可按项目拆成 {batchProjectGroups.length} 个转换任务</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {batchProjectGroups.map((group) => (
                  <span key={group.key} className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {group.name} · {group.images.length} 页
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitDisabled}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              创建任务
            </button>
          </div>

          {canCreateProjectBatches && (
            <button
              type="button"
              onClick={() => void submitProjectBatches()}
              disabled={submitting || batchSubmitting}
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              {batchSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              按项目创建 {batchProjectGroups.length} 个任务
            </button>
          )}

          {message && <div className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{message}</div>}
        </div>
      </aside>

      <main className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_390px] overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold">选择项目图片</div>
              <div className="truncate text-[10px] text-muted-foreground">可在转换中心直接浏览所有项目图片，多选后创建转换任务</div>
            </div>
            <div className="flex items-center gap-2">
              <NeutralSelect
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="h-8 w-[188px] max-w-[188px] text-[11px]"
                aria-label="选择项目"
              >
                <option value={ALL_PROJECTS}>全部项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </NeutralSelect>
              <button type="button" onClick={() => void loadProjectImages()} className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                刷新
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input
                value={imageQuery}
                onChange={(event) => setImageQuery(event.target.value)}
                placeholder="搜索提示词、模型、比例"
                className="h-8 w-full max-w-[360px] rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-border-secondary"
              />
              <span className="text-[10px] text-muted-foreground">
                {loadingImages ? "读取中..." : `${filteredProjectImages.length} 张可选`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowOnlyPicked((current) => !current)}
                className={`h-8 rounded-lg border px-3 text-xs transition-colors ${showOnlyPicked ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {showOnlyPicked ? "显示全部" : "只看已选"}
              </button>
              <NeutralSelect
                value={imageSortMode}
                onChange={(event) => setImageSortMode(event.target.value === "oldest" ? "oldest" : "recent")}
                className="h-8 w-[108px] text-[11px]"
                aria-label="图片排序"
              >
                <option value="recent">最新优先</option>
                <option value="oldest">最早优先</option>
              </NeutralSelect>
              <button type="button" onClick={selectCurrentProjectImages} disabled={projectImages.length === 0} className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                当前项目全部
              </button>
              <button type="button" onClick={selectVisibleImages} disabled={filteredProjectImages.length === 0} className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                选择当前视图
              </button>
              <button type="button" onClick={invertVisibleImages} disabled={filteredProjectImages.length === 0} className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                反选当前
              </button>
              <button type="button" onClick={clearPickedImages} disabled={pickedImages.length === 0} className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                清空选择
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {imageMessage && <div className="mb-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{imageMessage}</div>}
            {pickedImages.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[11px]">
                <span className="text-muted-foreground">
                  已选 {pickedImages.length} 张，拖到左侧可调整最终页序
                </span>
                <button
                  type="button"
                  onClick={clearPickedImages}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  清空已选
                </button>
              </div>
            )}
            {loadingImages && projectImages.length === 0 ? (
              <div className="columns-2 gap-4 sm:columns-3 xl:columns-4 2xl:columns-5">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div
                    key={index}
                    className="mb-4 break-inside-avoid animate-pulse rounded-2xl border border-border bg-muted"
                    style={{ height: index % 3 === 0 ? 150 : index % 3 === 1 ? 190 : 120 }}
                  />
                ))}
              </div>
            ) : filteredProjectImages.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-8 text-center">
                <FileText className="mb-3 h-9 w-9 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">当前项目没有可转换图片</div>
                <div className="mt-1 max-w-[360px] text-xs leading-relaxed text-muted-foreground">
                  可以切换到“全部项目”，或从左侧上传本地图片/PDF 创建转换任务。
                </div>
              </div>
            ) : (
              <div className="columns-2 gap-4 sm:columns-3 xl:columns-4 2xl:columns-5">
                {filteredProjectImages.map((image, index) => {
                  const checked = pickedIdSet.has(image.id);
                  const order = pickedImageOrderMap.get(image.id);
                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={(event) => handleProjectImageClick(event, image, index)}
                      title={imageDisplayName(image, index)}
                      className={`group relative mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${checked ? "border-foreground ring-2 ring-foreground/12" : "border-border hover:border-border-secondary"}`}
                    >
                      <span className={`absolute left-2 top-2 z-20 flex h-6 min-w-6 items-center justify-center rounded-md border px-1 text-[10px] font-semibold shadow-sm ${checked ? "border-white bg-white text-black" : "border-white/70 bg-black/35 text-white"}`}>
                        {order || ""}
                      </span>
                      <span
                        role="checkbox"
                        aria-checked={checked}
                        className={`absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm ${checked ? "border-white bg-white text-black" : "border-white/70 bg-black/30 text-white"}`}
                      >
                        {checked && <CheckCircle2 className="h-4 w-4" />}
                      </span>
                      <div className="relative w-full bg-muted" style={{ aspectRatio: imageAspectRatio(image) }}>
                        <img src={image.image_url} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy" />
                      </div>
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0 opacity-80 transition-opacity group-hover:opacity-95" />
                      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                        <span className="truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{projectName(image.project_id)}</span>
                        <span className="truncate rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] text-white/85">{image.model || "未标注模型"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-card">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div>
              <div className="text-sm font-semibold">转换任务</div>
              <div className="text-[10px] text-muted-foreground">
                {tasks.length} 个任务，{activeTaskCount} 个进行中{resultSyncTaskCount > 0 ? `，${resultSyncTaskCount} 个待同步` : ""}{failedTaskCount > 0 ? `，${failedTaskCount} 个失败` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {resultSyncTaskCount > 0 && (
                <button
                  type="button"
                  onClick={() => void batchSyncTasks("result_pending")}
                  disabled={Boolean(batchTaskAction)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  同步待同步
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadTasks()}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                刷新
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <div className="sticky top-0 z-10 mb-3 rounded-2xl border border-border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
              <div className="mb-2 grid grid-cols-5 gap-1.5">
                {[
                  { key: ALL_TASKS, label: "全部", count: tasks.length },
                  { key: ACTIVE_TASKS, label: "进行中", count: activeTaskCount },
                  { key: SYNC_PENDING_TASKS, label: "待同步", count: resultSyncTaskCount },
                  { key: "succeeded", label: "可下载", count: succeededTaskCount },
                  { key: "failed", label: "失败", count: failedTaskCount },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTaskStatusFilter(item.key)}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      taskStatusFilter === item.key
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <div className="text-[10px]">{item.label}</div>
                    <div className="mt-0.5 text-xs font-semibold">{item.count}</div>
                  </button>
                ))}
              </div>
              <input
                value={taskQuery}
                onChange={(event) => setTaskQuery(event.target.value)}
                placeholder="搜索任务名称 / 失败原因"
                className="h-8 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-border-secondary"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NeutralSelect
                  value={taskStatusFilter}
                  onChange={(event) => setTaskStatusFilter(event.target.value)}
                  className="h-8 text-[11px]"
                  aria-label="筛选任务状态"
                >
                  <option value={ALL_TASKS}>全部状态</option>
                  <option value={ACTIVE_TASKS}>进行中</option>
                  <option value={SYNC_PENDING_TASKS}>待同步结果</option>
                  <option value="succeeded">可下载</option>
                  <option value="failed">失败</option>
                  <option value="canceled">已取消</option>
                </NeutralSelect>
                <NeutralSelect
                  value={taskProjectFilter}
                  onChange={(event) => setTaskProjectFilter(event.target.value)}
                  className="h-8 text-[11px]"
                  aria-label="筛选任务项目"
                >
                  <option value={ALL_TASKS}>全部项目</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </NeutralSelect>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[10px] text-muted-foreground">当前显示 {filteredTasks.length} 个任务</div>
                <button
                  type="button"
                  onClick={() => setTaskCompactMode((current) => !current)}
                  className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${taskCompactMode ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {taskCompactMode ? "紧凑模式" : "标准模式"}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleFilteredTaskSelection}
                    disabled={selectableFilteredTaskIds.length === 0}
                    className="rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    {selectableFilteredTaskIds.length > 0 && selectableFilteredTaskIds.every((id) => selectedTaskIdSet.has(id)) ? "取消全选" : "全选当前"}
                  </button>
                  {selectedTaskCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTaskIds([])}
                      className="rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
              {selectedTaskCount > 0 && (
                <div className="mt-2 rounded-lg border border-border bg-card px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      已选 {selectedTaskCount} 个历史任务 · 可同步 {selectedSyncableTasks.length} · 可重试 {selectedRetryableTasks.length} · 可下载 {selectedDownloadableTasks.length} · 可归档 {selectedArchivableTasks.length}
                    </span>
                    {batchTaskAction && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void batchSyncTasks("selected")}
                      disabled={selectedSyncableTasks.length === 0 || Boolean(batchTaskAction)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      同步所选
                    </button>
                    <button
                      type="button"
                      onClick={() => void batchDownloadSelectedTasks("pptx")}
                      disabled={selectedDownloadableTasks.length === 0 || Boolean(batchTaskAction)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      批量 PPTX
                    </button>
                    <button
                      type="button"
                      onClick={() => void retrySelectedTasks()}
                      disabled={selectedRetryableTasks.length === 0 || Boolean(batchTaskAction)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      批量重试
                    </button>
                    <button
                      type="button"
                      onClick={() => void batchDownloadSelectedTasks("package")}
                      disabled={selectedTasks.length === 0 || Boolean(batchTaskAction)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      批量任务包
                    </button>
                    <button
                      type="button"
                      onClick={() => void archiveSelectedTaskResults()}
                      disabled={selectedArchivableTasks.length === 0 || Boolean(batchTaskAction)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      批量归档
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSelectedTasks()}
                      disabled={Boolean(batchTaskAction)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      删除所选
                    </button>
                  </div>
                </div>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 text-center">
                <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">暂无转换任务</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">选择图片后创建任务，进度和结果会显示在这里。</div>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 text-center">
                <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">没有匹配任务</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">调整状态、项目或关键词筛选。</div>
              </div>
            ) : (
              <div className={taskCompactMode ? "space-y-2" : "space-y-3"}>
                {filteredTasks.map((task) => {
                  const filesForTask = task.source_files || [];
                  const previews = filesForTask.filter((file) => file.thumbnail_url).slice(0, 4);
                  const selected = selectedTask?.id === task.id;
                  const batchSelected = selectedTaskIdSet.has(task.id);
                  const canSelectTask = !isTaskActive(task);
                  const issue = taskIssueDiagnosis(task, accountMessage);
                  const resultSyncPending = needsTaskResultSync(task);
                  if (taskCompactMode) {
                    return (
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedTaskId(task.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedTaskId(task.id);
                          }
                        }}
                        className={`w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition-all hover:border-border-secondary ${selected ? "border-foreground ring-2 ring-foreground/10" : batchSelected ? "border-foreground/70 ring-2 ring-foreground/8" : "border-border bg-background"}`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleTaskSelection(task);
                            }}
                            disabled={!canSelectTask}
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${batchSelected ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"} disabled:cursor-not-allowed disabled:opacity-35`}
                            title={canSelectTask ? "选择任务" : "进行中任务不能批量删除"}
                          >
                            {batchSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
                          </button>
                          <div className="grid h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                            {previews.length > 0 ? (
                              <div className={`grid h-full w-full ${previews.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                                {previews.slice(0, 4).map((file, index) => (
                                  <div key={`${task.id}-compact-${file.name}-${index}`} className="min-h-0 min-w-0 overflow-hidden border-border bg-muted odd:border-r even:border-l">
                                    <img src={file.thumbnail_url || ""} alt="" className="h-full w-full object-contain" />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-xs font-medium">{task.source_name}</div>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${resultSyncPending ? "border-border bg-muted text-foreground" : statusClass(task.status)}`}>
                                {resultSyncPending ? "待同步" : STATUS_LABEL[task.status]}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                              <span>{task.source_type === "pdf" ? "PDF" : "图片"}</span>
                              <span>{task.page_count || filesForTask.length} 页</span>
                              <span>{task.estimated_credits === null ? "点数待估算" : `${task.estimated_credits} credits`}</span>
                              <span>{formatDate(task.created_at)}</span>
                            </div>
                            {(task.status === "failed" || task.sync_error) && (
                              <div className="mt-1 line-clamp-1 text-[10px] text-red-500">
                                {issue.title}：{issue.action}
                              </div>
                            )}
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.max(4, Math.min(100, task.progress || 0))}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTaskId(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTaskId(task.id);
                        }
                      }}
                      className={`w-full cursor-pointer overflow-hidden rounded-2xl border bg-background text-left transition-all hover:border-border-secondary ${selected ? "border-foreground ring-2 ring-foreground/10" : batchSelected ? "border-foreground/70 ring-2 ring-foreground/8" : "border-border"}`}
                    >
                      <div className="relative aspect-[16/9] bg-muted">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleTaskSelection(task);
                          }}
                          disabled={!canSelectTask}
                          className={`absolute left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-colors ${batchSelected ? "border-white bg-white text-black" : "border-white/70 bg-black/30 text-white hover:bg-black/50"} disabled:cursor-not-allowed disabled:opacity-35`}
                          title={canSelectTask ? "选择任务" : "进行中任务不能批量删除"}
                        >
                          {batchSelected && <CheckCircle2 className="h-4 w-4" />}
                        </button>
                        {previews.length > 0 ? (
                          <div className={`grid h-full w-full ${previews.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                            {previews.map((file, index) => (
                              <div key={`${task.id}-${file.name}-${index}`} className="min-h-0 min-w-0 overflow-hidden border-border bg-muted odd:border-r even:border-l">
                                <img src={file.thumbnail_url || ""} alt="" className="h-full w-full object-contain" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <FileText className="h-9 w-9 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-xs font-medium text-white">{task.source_name}</div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${resultSyncPending ? "border-border bg-muted text-foreground" : statusClass(task.status)} bg-background/90`}>
                              {resultSyncPending ? "待同步" : STATUS_LABEL[task.status]}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          <span>{task.source_type === "pdf" ? "PDF" : "图片"}</span>
                          <span>{task.page_count || filesForTask.length} 页</span>
                          <span>{task.estimated_credits === null ? "点数待估算" : `${task.estimated_credits} credits`}</span>
                          <span>{formatDate(task.created_at)}</span>
                        </div>
                        {(task.status === "failed" || task.sync_error) && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-red-500">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">{issue.title}：{issue.action}</span>
                          </div>
                        )}
                        {resultSyncPending && !task.sync_error && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                            <RefreshCw className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">Codia 已完成，正在同步 PPTX 下载地址。</span>
                          </div>
                        )}
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.max(4, Math.min(100, task.progress || 0))}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedTask && (
              <div className="mt-4 rounded-2xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
	                  <div className="min-w-0">
	                    <div className="truncate text-sm font-medium">{selectedTask.source_name}</div>
	                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{taskStageHint(selectedTask)}</div>
	                    {selectedTask.archived_at && (
	                      <div className="mt-1 text-[10px] text-muted-foreground">已归档到资产库 · {formatDate(selectedTask.archived_at)}</div>
	                    )}
	                  </div>
	                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusClass(selectedTask.status)}`}>{selectedTask.progress}%</span>
	                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-border bg-card p-2">
                    <div className="text-[10px] text-muted-foreground">页数</div>
                    <div className="mt-1 font-medium">{selectedTask.page_count || selectedTask.source_files.length}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2">
                    <div className="text-[10px] text-muted-foreground">预估</div>
                    <div className="mt-1 font-medium">{selectedTask.estimated_credits ?? "-"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2">
                    <div className="text-[10px] text-muted-foreground">实际</div>
                    <div className="mt-1 font-medium">{selectedTask.charged_credits ?? "-"}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-3 py-2 text-xs font-medium">源文件</div>
                  <div className="max-h-44 overflow-y-auto">
                    {(selectedTask.source_files || []).map((file, index) => (
                      <div key={`${selectedTask.id}-${file.name}-${file.size}-${index}`} className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0">
                        <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                          {file.thumbnail_url ? <img src={file.thumbnail_url} alt="" className="h-full w-full object-contain" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{file.name}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                            <span>{sourceOriginLabel(file)}</span>
                            <span>{formatBytes(file.size)}</span>
                            {sourceDimensions(file) && <span>{sourceDimensions(file)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedTaskIssue && (selectedTask.status === "failed" || selectedTask.status === "canceled" || selectedTask.error_message) && (
                  <div className={`mt-3 rounded-xl border p-3 ${selectedTask.status === "failed" ? "border-red-500/20 bg-red-500/10 text-red-500" : "border-border bg-card text-muted-foreground"}`}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold">{selectedTaskIssue.title}</div>
                        <div className="mt-1 text-[10px] leading-relaxed">{selectedTaskIssue.summary}</div>
                        <div className="mt-1 text-[10px] leading-relaxed">{selectedTaskIssue.action}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedTaskIssue.canRetry && (
                        <button
                          type="button"
                          onClick={() => void retryTask(selectedTask)}
                          disabled={retryingTaskId === selectedTask.id}
                          className="rounded-md border border-border bg-background px-2.5 py-1 text-[10px] text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {retryingTaskId === selectedTask.id ? "重试中..." : "重试任务"}
                        </button>
                      )}
                      {selectedTaskIssue.canRefreshAccount && (
                        <button
                          type="button"
                          onClick={() => void loadAccount()}
                          className="rounded-md border border-border bg-background px-2.5 py-1 text-[10px] text-foreground hover:bg-muted"
                        >
                          刷新余额
                        </button>
                      )}
                      {selectedTaskIssue.canOpenConfig && onOpenConfig && (
                        <button
                          type="button"
                          onClick={onOpenConfig}
                          className="rounded-md border border-border bg-background px-2.5 py-1 text-[10px] text-foreground hover:bg-muted"
                        >
                          检查 Key
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedTask.prepared_pdf_url && (
                    <a
                      href={downloadUrl(selectedTask.prepared_pdf_url, `${selectedTask.source_name}.pdf`)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Download className="h-4 w-4" />
                      下载 PDF
                    </a>
                  )}
                  {selectedTask.ppt_url && (
                    <a
                      href={selectedTask.ppt_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90"
                    >
                      <Download className="h-4 w-4" />
	                      下载 PPTX
	                    </a>
	                  )}
	                  {selectedTask.ppt_url && (
	                    <button
	                      type="button"
	                      onClick={() => void archiveTaskResult(selectedTask)}
	                      disabled={Boolean(selectedTask.archived_asset_id) || archivingTaskId === selectedTask.id}
	                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
	                    >
	                      {archivingTaskId === selectedTask.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
	                      {selectedTask.archived_asset_id ? "已归档" : "归档结果"}
	                    </button>
	                  )}
	                  {taskToDraftImages(selectedTask).length > 0 && (
	                    <button
                      type="button"
                      onClick={() => copyTaskToDraft(selectedTask)}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="h-4 w-4" />
                      复制页序
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void exportTaskPackage(selectedTask)}
                    disabled={exportingPackageTaskId === selectedTask.id}
                    className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {exportingPackageTaskId === selectedTask.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    导出任务包
                  </button>
                  {selectedTask.prepared_pdf_url && !isTaskActive(selectedTask) && (
                    <button
                      type="button"
                      onClick={() => void retryTask(selectedTask)}
                      disabled={retryingTaskId === selectedTask.id}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      {retryingTaskId === selectedTask.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      重试
                    </button>
                  )}
                  {selectedTask.codia_task_id && (
                    <button
                      type="button"
                      onClick={() => void syncTask(selectedTask)}
                      disabled={syncingTaskId === selectedTask.id}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${syncingTaskId === selectedTask.id ? "animate-spin" : ""}`} />
                      {syncingTaskId === selectedTask.id ? "同步中" : "同步状态"}
                    </button>
                  )}
                  {isTaskActive(selectedTask) && (
                    <button
                      type="button"
                      onClick={() => void cancelTask(selectedTask)}
                      className="flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      取消
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteTask(selectedTask)}
                    className="flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="删除记录"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {selectedTask.codia_task_id && (
                  <div className="mt-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-medium text-muted-foreground">Codia 同步</div>
                      <button
                        type="button"
                        onClick={() => void syncTask(selectedTask)}
                        disabled={syncingTaskId === selectedTask.id}
                        className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        {syncingTaskId === selectedTask.id ? "同步中" : "手动同步"}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                      <div className="rounded-md border border-border bg-background p-2">
                        <div>Codia 状态</div>
                        <div className="mt-0.5 truncate text-xs text-foreground">{selectedTask.codia_status || STATUS_LABEL[selectedTask.status]}</div>
                      </div>
                      <div className="rounded-md border border-border bg-background p-2">
                        <div>上次同步</div>
                        <div className="mt-0.5 truncate text-xs text-foreground">{formatDate(selectedTask.last_synced_at)}</div>
                      </div>
                    </div>
                    {selectedTask.sync_error && (
                      <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-red-500">
                        同步失败：{selectedTask.sync_error}
                      </div>
                    )}
                    <div className="mt-2 break-all text-[10px] text-muted-foreground">任务 ID：{selectedTask.codia_task_id}</div>
                    {selectedTask.upload_id && <div className="mt-1 break-all text-[10px] text-muted-foreground">上传 ID：{selectedTask.upload_id}</div>}
                  </div>
                )}
              </div>
            )}

          </div>
        </aside>
      </main>
    </div>
  );
}
