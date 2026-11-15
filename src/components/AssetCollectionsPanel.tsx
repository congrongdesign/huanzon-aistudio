"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { GenerationCase } from "@/lib/generation-tools";
import JSZip from "jszip";
import NeutralSelect from "@/components/ui/neutral-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  cases: GenerationCase[];
  selectedAssetImageUrl?: string;
  onSaveCase: (item: GenerationCase) => void;
  onDeleteCase: (id: string) => void;
  onUseCase: (item: GenerationCase, mode: "fill" | "generate") => void;
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

export default function AssetCollectionsPanel(props: Props) {
  const [caseQuery, setCaseQuery] = useState("");
  const [editingCase, setEditingCase] = useState<GenerationCase | null>(null);
  const [previewCase, setPreviewCase] = useState<GenerationCase | null>(null);
  const [caseImporting, setCaseImporting] = useState(false);

  const filteredCases = useMemo(() => {
    const query = caseQuery.trim().toLowerCase();
    if (!query) return props.cases;
    return props.cases.filter((item) => `${item.title} ${item.category} ${item.description} ${item.prompt} ${(item.tags || []).join(" ")}`.toLowerCase().includes(query));
  }, [props.cases, caseQuery]);

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

  return (
    <div data-motif-library="true"className="asset-collections-panel space-y-4">
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
                        <div className="aspect-video bg-muted"><img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-contain" /></div>
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
        <Dialog open={!!previewCase} onOpenChange={(open) => {if (!open) setPreviewCase(null);}}>
          <DialogContent showCloseButton={false} className="!max-w-6xl !p-0 flex max-h-[88vh] flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-semibold text-foreground">{previewCase.title}</DialogTitle><DialogDescription className="sr-only">案例图片与原始资料预览</DialogDescription>
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
            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] overflow-y-auto">
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
                          <img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-contain" />
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
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
