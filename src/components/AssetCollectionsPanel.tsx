"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, PackageOpen, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { GenerationCase, GenerationStylePack } from "@/lib/generation-tools";
import JSZip from "jszip";
import NeutralSelect from "@/components/ui/neutral-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Mode = "cases" | "styles";

type Props = {
  mode: Mode;
  cases: GenerationCase[];
  stylePacks: GenerationStylePack[];
  selectedStylePackId: string;
  selectedAssetImageUrl?: string;
  currentReferenceImages: string[];
  onSaveCase: (item: GenerationCase) => void;
  onDeleteCase: (id: string) => void;
  onUseCase: (item: GenerationCase, mode: "fill" | "generate") => void;
  onSaveStylePack: (pack: GenerationStylePack) => void;
  onDeleteStylePack: (id: string) => void;
  onSelectStylePack: (packId: string) => void;
  onClearStylePack: () => void;
  onApplyStyleToPrompt: (pack: GenerationStylePack) => void;
  onImportStylePackImagesToCanvas: (urls: string[]) => void | Promise<void>;
};

type ImportedCaseSlide = {
  id: string;
  pageNumber: number;
  title: string;
  originalUrl?: string;
  imageUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
  role?: string;
  sourceText?: string;
  ocrText?: string;
  status?: string;
};

const DEFAULT_CASE: GenerationCase = {
  id: "",
  category: "未分类",
  title: "",
  description: "",
  prompt: "",
  aspectRatio: "16:9",
  count: 1,
  tags: [],
};

const DEFAULT_STYLE_PACK: GenerationStylePack = {
  id: "",
  name: "",
  category: "自定义",
  description: "",
  promptSuffix: "",
  palette: ["#ffffff", "#111827", "#7c3aed"],
  tags: [],
  referenceImages: [],
  trainingStatus: "idle",
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function fileExt(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

async function readImageDeckFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList);
  const imageFiles: Array<{ name: string; dataUrl: string }> = [];
  const warnings: string[] = [];

  for (const file of files) {
    const ext = fileExt(file.name);
    if (ext === ".zip") {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files)
        .filter((entry) => !entry.dir && IMAGE_EXTENSIONS.has(fileExt(entry.name)))
        .sort((a, b) => naturalSort(a.name, b.name));
      if (entries.length === 0) warnings.push(`${file.name} 中没有找到图片页面。`);
      for (const entry of entries) {
        const blob = await entry.async("blob");
        const dataUrl = await readFileAsDataUrl(new File([blob], entry.name, { type: blob.type || "image/png" }));
        imageFiles.push({ name: entry.name.split("/").pop() || entry.name, dataUrl });
      }
    } else if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith("image/")) {
      imageFiles.push({ name: file.name, dataUrl: await readFileAsDataUrl(file) });
    } else if (ext === ".pptx" || ext === ".ppt") {
      warnings.push(`${file.name} 是 PPT 文件。后端拆页失败时无法用浏览器兜底，请安装 LibreOffice/Poppler 后重试。`);
    } else {
      warnings.push(`${file.name} 已跳过，暂只识别图片或 ZIP 图片包。`);
    }
  }

  return {
    pages: imageFiles
      .sort((a, b) => naturalSort(a.name, b.name))
      .slice(0, 100)
      .map((item, index) => ({
        id: makeId("case-slide"),
        pageNumber: index + 1,
        title: `第 ${index + 1} 页`,
        imageUrl: item.dataUrl,
        fileName: item.name,
      })),
    warnings,
  };
}

function cleanCaseTitleFromFileName(name: string) {
  return name
    .replace(/\.(pptx?|zip|png|jpe?g|webp|gif|avif)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "PPT 案例";
}

function inferAspectRatioFromSlide(slide?: ImportedCaseSlide) {
  const w = Number(slide?.width || 0);
  const h = Number(slide?.height || 0);
  if (!w || !h) return "16:9";
  const ratio = w / h;
  const presets = [
    { value: "16:9", ratio: 16 / 9 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "1:1", ratio: 1 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "4:5", ratio: 4 / 5 },
    { value: "3:2", ratio: 3 / 2 },
    { value: "2:3", ratio: 2 / 3 },
  ];
  return presets.reduce((best, item) => Math.abs(item.ratio - ratio) < Math.abs(best.ratio - ratio) ? item : best).value;
}

function caseAspectClass(ratio?: string) {
  switch (ratio) {
    case "1:1":
      return "aspect-square";
    case "9:16":
      return "aspect-[9/16]";
    case "4:3":
      return "aspect-[4/3]";
    case "3:4":
      return "aspect-[3/4]";
    case "4:5":
      return "aspect-[4/5]";
    case "3:2":
      return "aspect-[3/2]";
    case "2:3":
      return "aspect-[2/3]";
    case "16:9":
    default:
      return "aspect-video";
  }
}

function inferCaseCategory(fileName: string, text: string) {
  const sample = `${fileName} ${text}`.toLowerCase();
  if (/运动|训练|球|网球|足球|篮球|健身|sports?|training|tennis/.test(sample) && /科技|技术|智能|ai|算法|系统|平台/.test(sample)) return "科技运动PPT";
  if (/地产|楼盘|住宅|商业地产|real estate/.test(sample)) return "地产PPT";
  if (/发布会|路演|演讲|大会|论坛|conference/.test(sample)) return "发布会PPT";
  if (/品牌|视觉|vi|logo|主视觉|海报/.test(sample)) return "品牌视觉";
  if (/科技|技术|智能|ai|算法|系统|平台|数据|数字化|云|saas|芯片|研发/.test(sample)) return "科技方案PPT";
  if (/运动|训练|球|网球|足球|篮球|健身|体育|赛事|sports?|training|tennis/.test(sample)) return "运动赛事PPT";
  if (/产品|新品|介绍|功能|技术/.test(sample)) return "产品介绍";
  if (/年度|总结|复盘|汇报|报告/.test(sample)) return "汇报总结";
  if (/招商|商业计划|融资|bp|business plan/.test(sample)) return "商业计划";
  return "PPT案例";
}

function collectCaseText(fileName: string, slides: ImportedCaseSlide[]) {
  return [
    fileName,
    ...slides.map((s) => [s.title, s.role, s.fileName, s.sourceText, s.ocrText].filter(Boolean).join(" ")),
  ].join(" ").replace(/\s+/g, " ").trim();
}

function topCaseKeywords(text: string) {
  const matches = text
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !/^(slide|pptx?|png|jpg|jpeg|webp|第\d+页|内容页|封面页|结尾页)$/i.test(word));
  const count = new Map<string, number>();
  for (const word of matches) count.set(word, (count.get(word) || 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 8);
}

function inferVisualStyleProfile(fileName: string, slides: ImportedCaseSlide[]) {
  const text = collectCaseText(fileName, slides);
  const sample = text.toLowerCase();
  const dark = /黑|深色|暗色|夜|black|dark/.test(sample);
  const tech = /科技|技术|智能|ai|算法|系统|平台|数据|数字化|云|saas|芯片|研发|solution|software/.test(sample);
  const sports = /运动|训练|球|网球|足球|篮球|健身|体育|赛事|sports?|training|tennis|player/.test(sample);
  const business = /市场|分析|商业|方案|产品|客户|服务|项目|行业|数据|专业|解决方案|roadmap|market/.test(sample);
  const brand = /品牌|视觉|logo|vi|主视觉|slogan|identity/.test(sample);
  const red = /红|中国|国旗|冠军|热血|red/.test(sample);
  const orange = /橙|金|黄|活力|orange|gold/.test(sample);
  const blue = /蓝|科技蓝|blue/.test(sample);

  const styleParts = [
    dark ? "深色高对比" : "",
    tech ? "科技感" : "",
    sports ? "运动能量感" : "",
    brand ? "品牌视觉化" : "",
    business ? "商业方案型" : "",
  ].filter(Boolean);

  const paletteParts = [
    dark ? "黑/深灰底" : "浅色或中性底",
    orange ? "橙金强调色" : "",
    red ? "红色情绪色" : "",
    blue ? "蓝色科技色" : "",
  ].filter(Boolean);

  const layoutParts = [
    slides.length >= 20 ? "完整长篇提案结构" : "轻量案例结构",
    "封面与内页统一视觉系统",
    business ? "多信息卡片、数据模块和图文分栏" : "图文主次清晰",
    sports ? "大图人物/运动场景强化冲击力" : "",
    tech ? "线性装饰、图标化信息和层级化标题" : "",
  ].filter(Boolean);

  return {
    category: inferCaseCategory(fileName, text),
    style: styleParts.length ? styleParts.join(" / ") : "现代简洁商务风",
    palette: paletteParts.join(" + "),
    layout: layoutParts.join("；"),
    scene: sports && tech ? "智能运动、体育科技、训练系统、解决方案汇报" : tech ? "科技产品、解决方案、平台介绍、商业汇报" : business ? "团队案例沉淀、客户提案、项目汇报" : "同类 PPT 案例参考",
    keywords: topCaseKeywords(text),
  };
}

function inferCaseDescription(fileName: string, slides: ImportedCaseSlide[]) {
  const ready = slides.filter((s) => s.originalUrl || s.imageUrl).length;
  const roles = Array.from(new Set(slides.map((s) => s.role).filter(Boolean))).slice(0, 6);
  const profile = inferVisualStyleProfile(fileName, slides);
  return [
    `画面风格：${profile.style}。`,
    `分类建议：${profile.category}。`,
    `配色倾向：${profile.palette || "中性商务配色"}。`,
    `版式特征：${profile.layout}。`,
    roles.length ? `页面结构：${roles.join("、")}。` : "",
    `适用场景：${profile.scene}。`,
    profile.keywords.length ? `识别关键词：${profile.keywords.join("、")}。` : "",
    `导入信息：共 ${slides.length} 页，已生成 ${ready} 张页面预览。`,
  ].filter(Boolean).join("\n");
}

function inferCaseTags(fileName: string, slides: ImportedCaseSlide[]) {
  const profile = inferVisualStyleProfile(fileName, slides);
  const tags = [
    profile.category,
    ...profile.style.split("/").map((item) => item.trim()).filter(Boolean),
    slides.length ? `${slides.length}页` : "",
    inferAspectRatioFromSlide(slides.find((slide) => slide.width && slide.height) || slides[0]),
    ...profile.keywords.slice(0, 5),
  ];
  return Array.from(new Set(tags.filter(Boolean))).slice(0, 10);
}

function normalizeCaseTags(value: string | string[] | undefined) {
  const source = Array.isArray(value) ? value.join("、") : value || "";
  return Array.from(new Set(source
    .split(/[、,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)))
    .slice(0, 12);
}

function displayCaseTags(item: GenerationCase) {
  const fallback = [
    item.category,
    item.slideCount || item.slides?.length ? `${item.slideCount || item.slides?.length}页` : "",
    item.aspectRatio,
  ];
  return Array.from(new Set([...(item.tags || []), ...fallback].filter(Boolean))).slice(0, 8);
}

function inferPaletteFromImages(imageCount: number) {
  if (imageCount >= 12) return ["#07111f", "#d8e7f5", "#3d7fa8", "#d4b16a", "#111827"];
  if (imageCount >= 6) return ["#0b1424", "#eef4fb", "#4d7fa5", "#6aa6bd", "#222f3f"];
  return ["#0f172a", "#f8fafc", "#64748b", "#256f91", "#c0a36d"];
}

function buildTrainedStylePrompt(pack: GenerationStylePack) {
  const count = pack.referenceImages?.length || 0;
  const tags = pack.tags.length ? `关键词：${pack.tags.join("、")}。` : "";
  return [
    pack.promptSuffix,
    `基于 ${count} 张参考图提炼统一风格，保持同一套视觉语言。`,
    "优先统一：版式节奏、留白比例、主辅色关系、字体气质、光影层级、材质颗粒和画面构图。",
    "生成时不要逐张照抄参考图内容，只迁移风格特征。",
    tags,
  ].filter(Boolean).join("\n");
}

function shortText(text: string, max = 110) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function dedupeUrls(urls: string[]) {
  return Array.from(new Set(urls.filter(Boolean)));
}

export default function AssetCollectionsPanel(props: Props) {
  const [caseQuery, setCaseQuery] = useState("");
  const [styleQuery, setStyleQuery] = useState("");
  const [editingCase, setEditingCase] = useState<GenerationCase | null>(null);
  const [previewCase, setPreviewCase] = useState<GenerationCase | null>(null);
  const [editingStylePack, setEditingStylePack] = useState<GenerationStylePack | null>(null);
  const [stylePackDetail, setStylePackDetail] = useState<GenerationStylePack | null>(null);
  const [stylePackPreviewUrl, setStylePackPreviewUrl] = useState("");
  const [caseImporting, setCaseImporting] = useState(false);
  const [styleTraining, setStyleTraining] = useState(false);

  const filteredCases = useMemo(() => {
    const query = caseQuery.trim().toLowerCase();
    if (!query) return props.cases;
    return props.cases.filter((item) => `${item.title} ${item.category} ${item.description} ${item.prompt} ${(item.tags || []).join(" ")}`.toLowerCase().includes(query));
  }, [props.cases, caseQuery]);

  const filteredStylePacks = useMemo(() => {
    const query = styleQuery.trim().toLowerCase();
    if (!query) return props.stylePacks;
    return props.stylePacks.filter((item) => `${item.name} ${item.category} ${item.description} ${item.promptSuffix} ${item.tags.join(" ")}`.toLowerCase().includes(query));
  }, [props.stylePacks, styleQuery]);

  const activeStylePack = useMemo(() => {
    if (editingStylePack && stylePackDetail && editingStylePack.id === stylePackDetail.id) return editingStylePack;
    return stylePackDetail || editingStylePack;
  }, [editingStylePack, stylePackDetail]);

  const saveCase = () => {
    if (!editingCase?.title.trim()) return;
    props.onSaveCase({
      ...editingCase,
      id: editingCase.id || makeId("case"),
      title: editingCase.title.trim(),
      category: editingCase.category.trim() || "未分类",
      description: editingCase.description.trim(),
      prompt: editingCase.prompt.trim(),
      tags: normalizeCaseTags(editingCase.tags),
      aspectRatio: editingCase.aspectRatio || "16:9",
      count: Math.max(1, Math.min(16, Number(editingCase.count) || 1)),
      updatedAt: new Date().toISOString(),
      createdAt: editingCase.createdAt || new Date().toISOString(),
    });
    setEditingCase(null);
  };

  const saveStylePack = () => {
    if (!editingStylePack?.name.trim()) return;
    props.onSaveStylePack({
      ...editingStylePack,
      id: editingStylePack.id || makeId("style"),
      name: editingStylePack.name.trim(),
      category: editingStylePack.category.trim() || "自定义",
      description: editingStylePack.description.trim(),
      promptSuffix: editingStylePack.promptSuffix.trim(),
      palette: editingStylePack.palette.filter(Boolean).slice(0, 8),
      tags: editingStylePack.tags.filter(Boolean).slice(0, 12),
      referenceImages: (editingStylePack.referenceImages || []).filter(Boolean).slice(0, 48),
      trainingStatus: editingStylePack.trainingStatus || "idle",
      trainingSummary: editingStylePack.trainingSummary,
      trainedAt: editingStylePack.trainedAt,
      updatedAt: new Date().toISOString(),
      createdAt: editingStylePack.createdAt || new Date().toISOString(),
    });
    setEditingStylePack(null);
  };

  const openStylePackDetail = (pack: GenerationStylePack) => {
    setStylePackDetail(pack);
    setStylePackPreviewUrl(pack.referenceImages?.[0] || "");
  };

  const closeStylePackDetail = () => {
    setStylePackDetail(null);
    setStylePackPreviewUrl("");
  };

  const saveStylePackDetail = (nextPack: GenerationStylePack) => {
    setStylePackDetail(nextPack);
    setStylePackPreviewUrl((prev) => (prev && nextPack.referenceImages?.includes(prev) ? prev : nextPack.referenceImages?.[0] || ""));
    setEditingStylePack((prev) => (prev?.id === nextPack.id ? nextPack : prev));
    props.onSaveStylePack(nextPack);
  };

  const appendStylePackImagesFromFiles = async (files: FileList | File[] | null) => {
    const target = activeStylePack;
    if (!target || !files?.length) return;
    const list = Array.from(files).slice(0, 24);
    const urls = dedupeUrls(await Promise.all(list.map(readFileAsDataUrl)));
    if (urls.length === 0) return;
    const nextPack = {
      ...target,
      referenceImages: dedupeUrls([...(target.referenceImages || []), ...urls]).slice(0, 48),
      updatedAt: new Date().toISOString(),
    };
    saveStylePackDetail(nextPack);
  };

  const removeStylePackImage = (index: number) => {
    const target = activeStylePack;
    if (!target) return;
    const current = target.referenceImages || [];
    const removedUrl = current[index];
    const nextImages = current.filter((_, i) => i !== index);
    const nextPack = {
      ...target,
      referenceImages: nextImages,
      updatedAt: new Date().toISOString(),
    };
    saveStylePackDetail(nextPack);
    if (stylePackPreviewUrl === removedUrl) setStylePackPreviewUrl(nextImages[0] || "");
  };

  const importStylePackImagesToCanvas = async (urls: string[]) => {
    const cleanUrls = dedupeUrls(urls).slice(0, 48);
    if (cleanUrls.length === 0) return;
    await props.onImportStylePackImagesToCanvas(cleanUrls);
  };

  const importCaseDeck = async (files: FileList | null) => {
    if (!files?.length) return;
    setCaseImporting(true);
    try {
      const fileArray = Array.from(files);
      const firstName = fileArray[0]?.name || "PPT图片集";
      const formData = new FormData();
      fileArray.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/ppt-workshop/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "后端拆页失败");
      }
      const data = await res.json();
      const importedSlides = Array.isArray(data.slides) ? data.slides as ImportedCaseSlide[] : [];
      const warnings = Array.isArray(data.warnings) ? data.warnings.map(String) : [];
      const pages = importedSlides
        .filter((slide) => slide.originalUrl || slide.imageUrl)
        .slice(0, 100)
        .map((slide, index) => ({
          id: slide.id || makeId("case-slide"),
          pageNumber: Number(slide.pageNumber || index + 1),
          title: slide.title || `第 ${index + 1} 页`,
          imageUrl: slide.originalUrl || slide.imageUrl || "",
          fileName: slide.fileName || `slide-${index + 1}.png`,
        }));
      if (pages.length === 0) {
        setEditingCase((prev) => prev ? { ...prev, importWarnings: warnings } : prev);
        return;
      }
      const allText = importedSlides.map((slide) => slide.sourceText || slide.ocrText || "").filter(Boolean).join(" ");
      setEditingCase((prev) => ({
        ...(prev || DEFAULT_CASE),
        title: prev?.title || cleanCaseTitleFromFileName(firstName),
        category: prev?.category || inferCaseCategory(firstName, allText),
        description: prev?.description || inferCaseDescription(firstName, importedSlides),
        prompt: prev?.prompt || "",
        tags: prev?.tags?.length ? prev.tags : inferCaseTags(firstName, importedSlides),
        aspectRatio: prev?.aspectRatio || inferAspectRatioFromSlide(importedSlides.find((slide) => slide.width && slide.height) || importedSlides[0]),
        coverImage: prev?.coverImage || pages[0]?.imageUrl,
        sourceFileName: firstName,
        slideCount: pages.length,
        slides: pages,
        importWarnings: warnings,
      }));
    } catch (err) {
      try {
        const { pages, warnings } = await readImageDeckFiles(files);
        if (pages.length === 0) {
          const message = err instanceof Error ? err.message : "导入失败";
          setEditingCase((prev) => prev ? { ...prev, importWarnings: [...warnings, message] } : prev);
          return;
        }
        const firstName = Array.from(files)[0]?.name || "PPT图片集";
        const fallbackText = pages.map((page) => `${page.title || ""} ${page.fileName || ""}`).join(" ");
        setEditingCase((prev) => ({
          ...(prev || DEFAULT_CASE),
          title: prev?.title || cleanCaseTitleFromFileName(firstName),
          category: prev?.category || inferCaseCategory(firstName, fallbackText),
          description: prev?.description || inferCaseDescription(firstName, pages),
          prompt: prev?.prompt || "",
          tags: prev?.tags?.length ? prev.tags : inferCaseTags(firstName, pages),
          coverImage: prev?.coverImage || pages[0]?.imageUrl,
          sourceFileName: firstName,
          slideCount: pages.length,
          slides: pages,
          importWarnings: warnings,
        }));
      } catch (fallbackErr) {
        const message = fallbackErr instanceof Error ? fallbackErr.message : err instanceof Error ? err.message : "导入失败";
        setEditingCase((prev) => prev ? { ...prev, importWarnings: [message] } : { ...DEFAULT_CASE, category: "PPT案例", importWarnings: [message] });
      }
    } finally {
      setCaseImporting(false);
    }
  };

  const trainStylePack = () => {
    if (!editingStylePack) return;
    setStyleTraining(true);
    window.setTimeout(() => {
      setEditingStylePack((prev) => {
        if (!prev) return prev;
        const referenceCount = prev.referenceImages?.length || 0;
        const trainedTags = Array.from(new Set([
          ...prev.tags,
          referenceCount >= 8 ? "批量参考" : "参考图",
          "统一风格",
          "可复用",
        ])).slice(0, 12);
        const trainedPack: GenerationStylePack = {
          ...prev,
          palette: prev.palette.length > 0 ? prev.palette : inferPaletteFromImages(referenceCount),
          tags: trainedTags,
          promptSuffix: buildTrainedStylePrompt({ ...prev, tags: trainedTags }),
          trainingStatus: "trained",
          trainingSummary: `已基于 ${referenceCount} 张参考图提炼风格约束：统一色彩、版式、光影、材质和构图，不复制具体内容。`,
          trainedAt: new Date().toISOString(),
        };
        return trainedPack;
      });
      setStyleTraining(false);
    }, 500);
  };

  if (props.mode === "cases") {
    return (
      <div className="asset-collections-panel space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
          <div className="min-w-[180px] flex-1">
            <div className="text-sm font-semibold text-foreground">案例中心</div>
            <div className="text-[11px] text-muted-foreground">这里只放你自己整理、上传、沉淀的案例，不再显示系统预设案例。</div>
          </div>
          <input value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} placeholder="搜索案例标题、分类、提示词" className="h-9 w-64 rounded-lg border border-border bg-muted px-3 text-xs outline-none focus:border-border-secondary" />
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted">
            <Upload className="h-3.5 w-3.5" /> 上传PPT/图片集
            <input type="file" multiple accept=".zip,image/*,.ppt,.pptx" className="hidden" onChange={async (e) => {
              setEditingCase({ ...DEFAULT_CASE, category: "PPT案例" });
              await importCaseDeck(e.currentTarget.files);
              e.currentTarget.value = "";
            }} />
          </label>
          <button onClick={() => setEditingCase({ ...DEFAULT_CASE })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> 新建案例
          </button>
        </div>

        {editingCase && (
          <div className="rounded-2xl border border-border-secondary/70 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">{editingCase.id ? "编辑案例" : "新建案例"}</div>
              <button onClick={() => setEditingCase(null)} className="text-xs text-muted-foreground hover:text-foreground">关闭</button>
            </div>
            <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
              <div className="space-y-2">
                <div className={`${caseAspectClass(editingCase.aspectRatio)} overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center`}>
                  {editingCase.coverImage ? <img src={editingCase.coverImage} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                </div>
                <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border text-xs text-foreground hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> 上传封面
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) {
                      const coverImage = await readFileAsDataUrl(file);
                      setEditingCase((prev) => prev ? { ...prev, coverImage } : prev);
                    }
                    e.currentTarget.value = "";
                  }} />
                </label>
                <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border-secondary/70 bg-primary/10 text-xs text-primary hover:bg-primary/15">
                  <Upload className="h-3.5 w-3.5" /> 上传图片集/ZIP
                  <input type="file" multiple accept=".zip,image/*,.ppt,.pptx" className="hidden" onChange={async (e) => {
                    await importCaseDeck(e.currentTarget.files);
                    e.currentTarget.value = "";
                  }} />
                </label>
                {caseImporting && <div className="rounded-lg border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">正在自动拆页、识别页数、比例和项目信息...</div>}
                {props.selectedAssetImageUrl && <button onClick={() => setEditingCase((prev) => prev ? { ...prev, coverImage: props.selectedAssetImageUrl } : prev)} className="w-full rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">使用当前资产图</button>}
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2 md:grid-cols-2">
                  <input value={editingCase.title} onChange={(e) => setEditingCase({ ...editingCase, title: e.target.value })} placeholder="案例名称，例如：地产发布会主视觉" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
                  <input value={editingCase.category} onChange={(e) => setEditingCase({ ...editingCase, category: e.target.value })} placeholder="分类，例如：PPT封面 / 海报 / 产品图" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
                </div>
                <input value={(editingCase.tags || []).join("、")} onChange={(e) => setEditingCase({ ...editingCase, tags: normalizeCaseTags(e.target.value) })} placeholder="项目标签，多个标签用顿号或逗号分隔" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
                <textarea value={editingCase.description} onChange={(e) => setEditingCase({ ...editingCase, description: e.target.value })} placeholder="案例说明：自动分析画面风格、配色、版式和分类" rows={5} className="rounded-lg border border-border bg-muted px-3 py-2 text-xs" />
                <textarea value={editingCase.prompt} onChange={(e) => setEditingCase({ ...editingCase, prompt: e.target.value })} placeholder="沉淀下来的提示词或生成方法，默认留空，可手动补充" rows={3} className="rounded-lg border border-border bg-muted px-3 py-2 text-xs" />
                {Boolean(editingCase.slides?.length) && (
                  <div className="rounded-xl border border-border bg-muted/30 p-2">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>PPT 页面已自动整理：{editingCase.slides?.length || 0} 页</span>
                      <span>{editingCase.sourceFileName ? `来源：${editingCase.sourceFileName}` : "按页码自然排序"}</span>
                    </div>
                    <div className="grid max-h-52 grid-cols-5 gap-2 overflow-y-auto pr-1">
                      {editingCase.slides?.map((slide) => (
                        <div key={slide.id} className="overflow-hidden rounded-lg border border-border bg-card">
                          <div className="aspect-video bg-muted"><img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-cover" /></div>
                          <div className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">#{slide.pageNumber} {slide.fileName}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Boolean(editingCase.importWarnings?.length) && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-600 dark:text-amber-200">
                    {editingCase.importWarnings?.map((warning) => <div key={warning}>{warning}</div>)}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <NeutralSelect value={editingCase.aspectRatio} onChange={(e) => setEditingCase({ ...editingCase, aspectRatio: e.target.value })} className="h-8 rounded-lg border border-border bg-muted px-2 text-xs">
                    {['1:1','16:9','9:16','4:3','3:4','4:5','3:2','2:3'].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                  </NeutralSelect>
                  <input type="number" min={1} max={16} value={editingCase.count} onChange={(e) => setEditingCase({ ...editingCase, count: Number(e.target.value) })} className="h-8 w-24 rounded-lg border border-border bg-muted px-2 text-xs" />
                  <button onClick={saveCase} className="ml-auto h-8 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!editingCase.title.trim()}>保存案例</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {filteredCases.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/70 p-8 text-center">
            <Sparkles className="mb-3 h-10 w-10 text-muted-foreground" />
            <div className="text-sm font-semibold text-foreground">还没有案例</div>
            <div className="mt-1 max-w-md text-xs leading-6 text-muted-foreground">案例中心现在是你的团队案例库。你可以把优秀作品、客户案例、固定提示词和封面图整理进来，后续直接套用或生成。</div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredCases.map((item) => {
              const tags = displayCaseTags(item);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewCase(item)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPreviewCase(item); }}
                  className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:border-border-secondary hover:shadow-md"
                >
                  <div className={`${caseAspectClass(item.aspectRatio)} bg-muted flex items-center justify-center overflow-hidden`}>
                    {item.coverImage ? <img src={item.coverImage} alt="" className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]" /> : <ImageIcon className="h-9 w-9 text-muted-foreground" />}
                  </div>
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-sm font-semibold text-foreground">{item.title}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">点击查看 {item.slideCount || item.slides?.length || 1} 页</div>
                      </div>
                      <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditingCase(item); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setEditingCase(item); } }}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); props.onDeleteCase(item.id); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); props.onDeleteCase(item.id); } }}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-red-500 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-foreground">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {previewCase && (
          <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setPreviewCase(null)}>
            <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-foreground">{previewCase.title}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {displayCaseTags(previewCase).map((tag) => (
                      <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-foreground">{tag}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => setPreviewCase(null)} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
                <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
                  <div className={`${caseAspectClass(previewCase.aspectRatio)} overflow-hidden rounded-2xl border border-border bg-muted flex items-center justify-center`}>
                    {previewCase.coverImage ? <img src={previewCase.coverImage} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="h-10 w-10 text-muted-foreground" />}
                  </div>
                  {previewCase.description && (
                    <div className="mt-4 whitespace-pre-line rounded-2xl border border-border bg-muted/30 p-3 text-xs leading-6 text-muted-foreground">
                      {previewCase.description}
                    </div>
                  )}
                </div>
                <div className="min-h-0 overflow-y-auto p-5">
                  <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>页面预览</span>
                    <span>{previewCase.slides?.length || previewCase.slideCount || 1} 页</span>
                  </div>
                  {previewCase.slides?.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {previewCase.slides.map((slide) => (
                        <div key={slide.id} className="overflow-hidden rounded-2xl border border-border bg-background">
                          <div className="aspect-video bg-muted">
                            <img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-cover" />
                          </div>
                          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                            <span>#{slide.pageNumber}</span>
                            <span className="truncate">{slide.fileName || slide.title}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                      这个案例还没有页面图片，编辑案例后上传图片集即可预览。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="asset-collections-panel space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <div className="min-w-[180px] flex-1">
          <div className="text-sm font-semibold text-foreground">风格包</div>
          <div className="text-[11px] text-muted-foreground">风格包由你上传的参考图和提示词定义组成，不再显示系统预设风格。</div>
        </div>
        <input value={styleQuery} onChange={(e) => setStyleQuery(e.target.value)} placeholder="搜索风格包" className="h-9 w-64 rounded-lg border border-border bg-muted px-3 text-xs outline-none focus:border-border-secondary" />
        {props.selectedStylePackId && <button onClick={props.onClearStylePack} className="h-9 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">清除当前风格</button>}
        <button onClick={() => setEditingStylePack({ ...DEFAULT_STYLE_PACK })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-3.5 w-3.5" /> 新建风格包
        </button>
      </div>

      {editingStylePack && (
        <div className="rounded-2xl border border-border-secondary/70 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{editingStylePack.id ? "编辑风格包" : "新建风格包"}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{(editingStylePack.referenceImages || []).length} 张参考图，支持查看、删除、补充并导入到画布。</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setStylePackDetail(editingStylePack); setStylePackPreviewUrl(editingStylePack.referenceImages?.[0] || ""); }} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">查看图片</button>
              <button onClick={() => setEditingStylePack(null)} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">关闭</button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="rounded-2xl border border-border bg-muted/25 p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>预览</span>
                  <span>{stylePackPreviewUrl ? "当前选中" : "未选中"}</span>
                </div>
                <button type="button" onClick={() => setStylePackPreviewUrl(editingStylePack.referenceImages?.[0] || "")} className="flex w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
                  <div className={`${stylePackPreviewUrl ? "aspect-[4/3] w-full" : "aspect-[4/3] w-full"} flex items-center justify-center bg-muted/60`}>
                    {stylePackPreviewUrl ? <img src={stylePackPreviewUrl} alt="" className="h-full w-full object-contain" /> : <div className="text-xs text-muted-foreground">暂无预览图</div>}
                  </div>
                </button>
              </div>
              <div className="rounded-2xl border border-border bg-muted/15 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium text-foreground">参考图管理</div>
                  <div className="text-[11px] text-muted-foreground">{(editingStylePack.referenceImages || []).length}/48</div>
                </div>
                <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  {(editingStylePack.referenceImages || []).length > 0 ? (editingStylePack.referenceImages || []).map((url, index) => (
                    <button key={`${url}-${index}`} type="button" onClick={() => setStylePackPreviewUrl(url)} className={`group relative aspect-square overflow-hidden rounded-xl border bg-card ${stylePackPreviewUrl === url ? "border-border-secondary ring-2 ring-border-secondary/40" : "border-border"}`}>
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/15" />
                      <div className="absolute left-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</div>
                      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                        <span onClick={(e) => { e.stopPropagation(); setStylePackPreviewUrl(url); }} className="cursor-pointer rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-foreground">预览</span>
                        <span onClick={(e) => { e.stopPropagation(); void importStylePackImagesToCanvas([url]); }} className="cursor-pointer rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-foreground">导入</span>
                        <span onClick={(e) => { e.stopPropagation(); removeStylePackImage(index); }} className="cursor-pointer rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-red-600">删除</span>
                      </div>
                    </button>
                  )) : (
                    <div className="col-span-3 flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-border bg-card text-[11px] text-muted-foreground">参考图为空，先上传图片或把当前资产图加入进来。</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> 新增图片
                  <input type="file" multiple accept="image/*" className="hidden" onChange={async (e) => {
                    await appendStylePackImagesFromFiles(e.currentTarget.files);
                    e.currentTarget.value = "";
                  }} />
                </label>
                <button type="button" onClick={() => { if (stylePackPreviewUrl) void importStylePackImagesToCanvas([stylePackPreviewUrl]); }} disabled={!stylePackPreviewUrl} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">导入当前预览</button>
                <button type="button" onClick={() => void importStylePackImagesToCanvas(editingStylePack.referenceImages || [])} disabled={!editingStylePack.referenceImages?.length} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">导入全部到画布</button>
                <button type="button" onClick={trainStylePack} disabled={styleTraining || !editingStylePack.referenceImages?.length} className="h-8 rounded-lg border border-border-secondary/70 bg-primary/10 px-3 text-xs text-foreground hover:bg-primary/15 disabled:opacity-50">{styleTraining ? "正在训练..." : "训练风格"}</button>
                {props.selectedAssetImageUrl && <button onClick={() => {
                  const selectedUrl = props.selectedAssetImageUrl;
                  if (!selectedUrl) return;
                  setEditingStylePack((prev) => prev ? { ...prev, referenceImages: dedupeUrls([...(prev.referenceImages || []), selectedUrl]).slice(0, 48) } : prev);
                }} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">加入当前资产图</button>}
                {props.currentReferenceImages.length > 0 && <button onClick={() => setEditingStylePack((prev) => prev ? { ...prev, referenceImages: dedupeUrls([...(prev.referenceImages || []), ...props.currentReferenceImages]).slice(0, 48) } : prev)} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">加入当前对话参考图</button>}
              </div>
            </div>
            <div className="grid gap-2">
              <div className="grid gap-2 md:grid-cols-2">
                <input value={editingStylePack.name} onChange={(e) => setEditingStylePack({ ...editingStylePack, name: e.target.value })} placeholder="风格包名称，例如：黑金科技发布会" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
                <input value={editingStylePack.category} onChange={(e) => setEditingStylePack({ ...editingStylePack, category: e.target.value })} placeholder="分类，例如：PPT / 品牌 / 海报" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
              </div>
              <textarea value={editingStylePack.description} onChange={(e) => setEditingStylePack({ ...editingStylePack, description: e.target.value })} placeholder="风格说明：适合什么场景、视觉特点、不要出现什么" rows={3} className="rounded-lg border border-border bg-muted px-3 py-2 text-xs" />
              <textarea value={editingStylePack.promptSuffix} onChange={(e) => setEditingStylePack({ ...editingStylePack, promptSuffix: e.target.value })} placeholder="风格提示词定义：色彩、材质、构图、光影、版式、禁忌要求等。生成时会自动追加到提示词后面。" rows={8} className="rounded-lg border border-border bg-muted px-3 py-2 text-xs" />
              {editingStylePack.trainingStatus === "trained" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-5 text-emerald-700 dark:text-emerald-200">
                  <div className="font-medium">训练完成</div>
                  <div>{editingStylePack.trainingSummary}</div>
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-2">
                <input value={editingStylePack.palette.join(", ")} onChange={(e) => setEditingStylePack({ ...editingStylePack, palette: e.target.value.split(/[,，\s]+/).map((v) => v.trim()).filter(Boolean) })} placeholder="#111827, #ffffff, #7c3aed" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
                <input value={editingStylePack.tags.join(", ")} onChange={(e) => setEditingStylePack({ ...editingStylePack, tags: e.target.value.split(/[,，\s]+/).map((v) => v.trim()).filter(Boolean) })} placeholder="标签：科技, 黑金, 发布会" className="h-9 rounded-lg border border-border bg-muted px-3 text-xs" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={saveStylePack} className="ml-auto h-8 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!editingStylePack.name.trim()}>保存风格包</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={Boolean(stylePackDetail)} onOpenChange={(open) => { if (!open) closeStylePackDetail(); }}>
        <DialogContent className="max-w-6xl">
          {stylePackDetail && (
            <>
              <DialogHeader>
                <DialogTitle>{stylePackDetail.name}</DialogTitle>
                <DialogDescription>
                  {stylePackDetail.category} · {(stylePackDetail.referenceImages || []).length} 张参考图
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
                <div className="min-h-0 space-y-3">
                  <div className="rounded-2xl border border-border bg-muted/25 p-3">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>预览图</span>
                      <span>{stylePackPreviewUrl ? "当前选中" : "未选中"}</span>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="aspect-[4/3] bg-muted/60 flex items-center justify-center">
                        {stylePackPreviewUrl ? <img src={stylePackPreviewUrl} alt="" className="h-full w-full object-contain" /> : <div className="text-xs text-muted-foreground">暂无预览图</div>}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/15 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-medium text-foreground">图片列表</div>
                      <div className="text-[11px] text-muted-foreground">{(stylePackDetail.referenceImages || []).length}/48</div>
                    </div>
                    <div className="grid max-h-[54vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                      {(stylePackDetail.referenceImages || []).length > 0 ? (stylePackDetail.referenceImages || []).map((url, index) => (
                        <button key={`${url}-${index}`} type="button" onClick={() => setStylePackPreviewUrl(url)} className={`group relative aspect-square overflow-hidden rounded-xl border bg-card ${stylePackPreviewUrl === url ? "border-border-secondary ring-2 ring-border-secondary/40" : "border-border"}`}>
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/15" />
                          <div className="absolute left-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</div>
                          <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                            <span onClick={(e) => { e.stopPropagation(); setStylePackPreviewUrl(url); }} className="cursor-pointer rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-foreground">预览</span>
                            <span onClick={(e) => { e.stopPropagation(); void importStylePackImagesToCanvas([url]); }} className="cursor-pointer rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-foreground">导入</span>
                            <span onClick={(e) => { e.stopPropagation(); saveStylePackDetail({ ...stylePackDetail, referenceImages: (stylePackDetail.referenceImages || []).filter((_, i) => i !== index), updatedAt: new Date().toISOString() }); }} className="cursor-pointer rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-red-600">删除</span>
                          </div>
                        </button>
                      )) : (
                        <div className="col-span-4 flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border bg-card text-[11px] text-muted-foreground">暂无参考图</div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-muted">
                      <Upload className="h-3.5 w-3.5" /> 新增图片
                      <input type="file" multiple accept="image/*" className="hidden" onChange={async (e) => {
                        await appendStylePackImagesFromFiles(e.currentTarget.files);
                        e.currentTarget.value = "";
                      }} />
                    </label>
                    <button type="button" onClick={() => { if (stylePackPreviewUrl) void importStylePackImagesToCanvas([stylePackPreviewUrl]); }} disabled={!stylePackPreviewUrl} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">导入当前预览</button>
                    <button type="button" onClick={() => void importStylePackImagesToCanvas(stylePackDetail.referenceImages || [])} disabled={!stylePackDetail.referenceImages?.length} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">导入全部到画布</button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-2xl border border-border bg-card p-3">
                    <div className="text-xs font-medium text-foreground">风格信息</div>
                    <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
                      <div>分类：{stylePackDetail.category || "-"}</div>
                      <div>标签：{stylePackDetail.tags.join("、") || "-"}</div>
                      <div>配色：{stylePackDetail.palette.join(" / ") || "-"}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-3">
                    <div className="text-xs font-medium text-foreground">提示词</div>
                    <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-line rounded-xl border border-border bg-muted/30 p-3 text-[11px] leading-5 text-muted-foreground">
                      {stylePackDetail.promptSuffix || "暂无风格提示词"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => props.onSelectStylePack(stylePackDetail.id)} className="h-8 rounded-lg bg-primary px-3 text-xs text-primary-foreground">{props.selectedStylePackId === stylePackDetail.id ? "当前使用" : "使用此风格"}</button>
                    <button onClick={() => props.onApplyStyleToPrompt(stylePackDetail)} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">追加到输入框</button>
                    <button onClick={() => { setEditingStylePack(stylePackDetail); closeStylePackDetail(); }} className="h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">编辑信息</button>
                    <button onClick={() => { props.onDeleteStylePack(stylePackDetail.id); closeStylePackDetail(); }} className="h-8 rounded-lg border border-border px-3 text-xs text-red-500 hover:bg-red-500/10">删除风格包</button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {filteredStylePacks.length === 0 ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/70 p-8 text-center">
          <PackageOpen className="mb-3 h-10 w-10 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">还没有风格包</div>
          <div className="mt-1 max-w-md text-xs leading-6 text-muted-foreground">上传多张参考图，并填写风格提示词定义，即可保存为团队内部风格包。后续生图时选择风格包，会自动把风格约束追加到提示词。</div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredStylePacks.map((pack) => {
            const selected = props.selectedStylePackId === pack.id;
            return (
              <div key={pack.id} className={`rounded-2xl border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-border-secondary ring-2 ring-border-secondary/40" : "border-border hover:border-border-secondary"}`}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{pack.category}</span>{pack.trainingStatus === "trained" && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">已训练</span>}{selected && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-foreground">使用中</span>}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{pack.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{pack.description || shortText(pack.promptSuffix, 90)}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); props.onSelectStylePack(pack.id); }} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${selected ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{selected ? "已选" : "使用"}</button>
                </div>
                <div className="mb-3 grid grid-cols-5 gap-1.5">
                  {(pack.referenceImages || []).slice(0, 5).map((url, index) => <div key={`${url}-${index}`} className="aspect-square overflow-hidden rounded-lg bg-muted"><img src={url} alt="" className="h-full w-full object-cover" /></div>)}
                  {(pack.referenceImages || []).length === 0 && <div className="col-span-5 flex h-16 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">无参考图</div>}
                </div>
                <div className="mb-2 flex gap-1.5">{pack.palette.map((color) => <span key={color} className="h-5 flex-1 rounded-full border border-border" style={{ backgroundColor: color }} />)}</div>
                <div className="mb-3 flex flex-wrap gap-1.5">{pack.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>)}</div>
                <div className="flex gap-1.5">
                  <button onClick={(e) => { e.stopPropagation(); openStylePackDetail(pack); }} className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">管理图片</button>
                  <button onClick={() => props.onApplyStyleToPrompt(pack)} className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">追加到输入框</button>
                  <button onClick={(e) => { e.stopPropagation(); setEditingStylePack(pack); }} className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted">编辑</button>
                  <button onClick={(e) => { e.stopPropagation(); props.onDeleteStylePack(pack.id); }} className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-red-500 hover:bg-red-500/10"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
