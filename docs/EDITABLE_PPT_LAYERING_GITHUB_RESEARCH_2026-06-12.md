# 分层功能 GitHub 调研与优化方案

日期：2026-06-12

## 1. 当前实现判断

当前平台已经有独立的 `分层` 模块，不是空白能力。主要入口和能力如下：

1. 前端模块：`src/components/EditablePptWorkbench.tsx`
   - 支持导入任务、页面预览、结构预览、导出记录、元素文字编辑。
   - 当前预览更多是“识别框 + 元素列表”，还不是完整的图层编辑器。

2. 导入与识别：`src/lib/editable-ppt/import.ts`
   - PPTX/PDF/图片统一转页面图。
   - macOS 下使用 `scripts/vision_ocr.swift` 做 OCR。
   - PPTX 原稿会尝试解析 slide XML，恢复部分文字、图片、形状。
   - 图片/PDF 路径主要靠 OCR + 网格颜色差异检测视觉区域。

3. 导出：`src/lib/editable-ppt/export.ts`
   - 用 `PptxGenJS` 导出 PPTX。
   - 支持文本框、基础形状、局部图片、整页 raster fallback。

当前主要短板：

1. Windows 下 `runVisionOcr()` 直接返回空数组，图片/PDF 的文字恢复会明显失效。
2. 图片/PDF 的视觉区域检测是规则网格，不是真正语义分割，容易把一大片区域误判成一个图层。
3. 还没有真正生成“去文字干净背景图”，所以导出时容易变成原图背景 + 新文本叠加，视觉上像糊了一层。
4. PPTX 原生解析还只覆盖基础文本/图片/形状，主题色、字体、表格、组合、阴影、渐变、图表等恢复有限。
5. 前端还缺少“图层开关、导出模式切换、低置信度复核、批量重跑某页”的工作流。

## 2. 可借鉴 GitHub 项目

### 2.1 NBLM2PPTX

地址：https://github.com/laihenyi/NBLM2PPTX

核心机制：

1. PDF/图片导入后，生成“干净背景图”。
2. OCR 提取文字位置。
3. 导出 PPTX 时底层放干净背景，上层放可编辑文字。
4. 支持批量页面、页面选择、并行处理、失败容错。

对我们的价值：

这是最适合短期借鉴的机制。我们的数据结构里已经有 `cleaned_background_key` 和 `cleaned_background_url` 字段，但当前还没有充分使用。可以先做“文字 mask -> 背景修复 -> 文本重建”的稳定路径，快速解决“不是在原图上盖色块”的问题。

适配建议：

1. OCR 后用文字框扩张 6-12px 生成文字 mask。
2. 调用本地 LaMa 或 image2.0 编辑模型做文字擦除。
3. `addBackground()` 优先使用 `cleaned_background_key`。
4. 导出时文本层才进入上层，原图不再直接兜底压在下面。

风险：

1. 对复杂背景中的文字擦除需要重试和局部修复。
2. 如果 OCR 漏字，漏掉的文字会保留在背景里。

### 2.2 px-image2pptx

地址：https://github.com/JadeLiu-tech/px-image2pptx

核心机制：

1. 静态图片转可编辑 PPT。
2. 关键词是 OCR、inpaint、reconstruct。
3. 和 NBLM2PPTX 类似，强调图片输入下的背景修复与文本重建。

对我们的价值：

可以作为“图片输入优先”的参考。它验证了图片转 PPTX 的务实路线不是一步全对象化，而是先做好：背景图干净、文字可编辑、局部复杂区域保真。

适配建议：

1. 增加图片页的 `high_fidelity` 解析模式。
2. 对每页输出 debug 包：原图、文字 mask、干净背景、OCR JSON、最终 AST、导出预览。
3. 前端允许用户对某页点击“重新擦字 / 重新 OCR / 仅重建文字”。

风险：

仓库体量较小，不能直接当完整生产方案，只适合借鉴流程。

### 2.3 MinerU2PPT

地址：https://github.com/JuniverseCoder/MinerU2PPT

核心机制：

1. 使用 MinerU 输出的结构化 JSON 作为中间层。
2. 根据结构化文本、图片、布局信息重建 PPT。
3. 支持批量模式、OCR 设备选择、CPU/GPU 打包。
4. 有 OCR bbox refinement、字体大小归一化、回归测试等工程设计。

对我们的价值：

这是中长期应该借鉴的结构化路线。我们当前已经有 `Slide AST`，但结构来源偏规则。可以增加一个可插拔的 `layout engine`，让 MinerU 或 PP-Structure 的 JSON 进入我们的 AST。

适配建议：

1. 新增 `src/lib/editable-ppt/layout-engines/`。
2. 定义统一接口：
   ```ts
   type LayoutEngineResult = {
     ocrLines: EditablePptOcrLine[];
     blocks: Array<{ type: string; bbox: number[]; text?: string; confidence: number }>;
     assets?: Array<{ type: string; bbox: number[]; assetKey?: string }>;
   };
   ```
3. 先支持 `native-pptx`、`vision-ocr`、`paddleocr` 三种 engine，后续再接 MinerU JSON。

风险：

MinerU 依赖和模型较重，不适合直接塞进 Next.js 进程，应该做成本机 Python 子进程或独立服务。

### 2.4 PaddleOCR / PP-StructureV3

地址：https://github.com/PaddlePaddle/PaddleOCR

核心机制：

1. PP-OCRv6 支持中文、英文、多语言文本识别。
2. PP-StructureV3 输出文档结构 JSON，可识别文本块、表格、图表等。
3. 支持 CPU/GPU、多平台部署，适合本地工具链。

对我们的价值：

这是必须优先补的基础能力。当前 macOS Vision OCR 只能覆盖 Mac，Windows 安装包里分层功能会天然弱。PaddleOCR 可以解决跨平台 OCR 和结构识别。

适配建议：

1. 新增本地能力检测：`PaddleOCR`、`Python`、`OpenCV`、`ONNXRuntime`。
2. 在“本机能力明细”里提供一键安装说明。
3. `runVisionOcr()` 改为 `runOcrEngines()`：
   - 优先：PaddleOCR / PP-OCRv6
   - 备选：macOS Vision
   - 兜底：当前 sourceText
4. 高保真模式使用 PP-StructureV3 输出文本块、表格、图表区域。

风险：

1. 首次安装模型体积较大。
2. Windows GPU/CPU 环境差异大，需要 CPU 默认、GPU 可选。

### 2.5 Segment Anything

地址：https://github.com/facebookresearch/segment-anything

核心机制：

1. SAM 可以通过点、框或自动模式生成高质量对象 mask。
2. 自动 mask 可获得 bbox、area、稳定性分数。
3. ONNX 可用于更轻量部署。

对我们的价值：

适合提升“画面元素搞成图层”的能力。规则网格只能找颜色块，SAM 可以把人物、产品、图标、插画等拆成独立图层。

适配建议：

1. 不直接全图自动生成所有 mask，因为 PPT 页面会产生大量碎片。
2. 先用当前 `detectVisualRegions()` 找候选框，再用 SAM 对候选框做 mask refinement。
3. mask 输出后：
   - 前景对象：透明 PNG 图层。
   - 背景：用 inpainting 补洞。
   - 小图标：作为 image/icon layer。

风险：

SAM 对文字、表格线和设计色块不一定适合，需要和 OCR/形状检测合并决策。

### 2.6 LaMa

地址：https://github.com/advimman/lama

核心机制：

1. 基于 mask 做高分辨率图像修复。
2. 擅长去除对象或文字后补背景。
3. 有多个第三方封装，例如 simple-lama-inpainting、lama-cleaner。

对我们的价值：

这是“去文字干净背景”的本地方案。相比调用云端生图模型，本地 LaMa 更稳定、可控、成本低，适合批量 PPT 页。

适配建议：

1. 短期先允许两种后端：
   - 云端 image2.0 编辑模型：无需额外安装，但成本和稳定性受 API 影响。
   - 本地 LaMa：需要安装，但适合批量和隐私。
2. 对每页保存：
   - `text_mask.png`
   - `cleaned_background.png`
   - `object_masks/*.png`

风险：

复杂纹理背景可能有修复痕迹，需要前端提供“重新修复这一页”。

## 3. 建议的新分层流水线

推荐把 `分层` 改成四阶段：

1. 输入标准化
   - PPTX：优先原生 XML 解析，同时渲染页面图做视觉校验。
   - PDF/图片：统一渲染为高清页面图。

2. 多引擎识别
   - OCR：PaddleOCR 优先，macOS Vision 兜底。
   - 结构：PP-Structure/MinerU JSON 可选。
   - 视觉：当前规则区域 + SAM refinement。
   - 原生 PPTX：XML 直接恢复文本、图形、图片。

3. 背景与图层生成
   - OCR 文本框生成文字 mask。
   - SAM/候选区域生成对象 mask。
   - LaMa/image2.0 修复背景。
   - 复杂区域裁剪成独立图片层。

4. PPTX 导出
   - 背景：优先干净背景图。
   - 文本：可编辑文本框。
   - 形状：基础 shape 原生重建。
   - 图片/人物/图标/图表：独立 raster layer。
   - 低置信度区域：默认保留为局部图片，不强行矢量化。

## 4. 可立即做的优化

### 4.1 修复 Windows/OCR 空白问题

优先级：P0

问题：当前 `runVisionOcr()` 在非 macOS 直接返回空数组，Windows 分层基本无法从图片/PDF 恢复文字。

方案：

1. 新增 Python OCR bridge。
2. 默认使用 PaddleOCR CPU 版。
3. OCR 输出统一转换成 `EditablePptOcrLine[]`。
4. 前端显示当前 OCR 引擎和识别耗时。

### 4.2 做“干净背景 + 可编辑文字层”

优先级：P0

问题：用户明确不接受在原图上糊色块，也不接受导出后还是一张图片。

方案：

1. 根据 OCR bbox 生成 `text_mask.png`。
2. 用本地 LaMa 或 image2.0 编辑生成 `cleaned_background.png`。
3. 修改 `addBackground()`，非 raster 模式下优先使用 `page.cleaned_background_key`。
4. 文本层放在背景上方。

### 4.3 增加分层调试包

优先级：P1

每页生成 debug zip：

1. 原图。
2. OCR JSON。
3. 文字 mask。
4. 干净背景。
5. 结构 AST。
6. 图层预览图。
7. 导出预估图。

价值：后续定位“不准”会快很多。

### 4.4 前端图层面板升级

优先级：P1

当前元素列表偏弱。建议改成真正图层面板：

1. 每个元素支持显示/隐藏。
2. 支持切换导出模式：`editable / raster / ignored`。
3. 支持锁定、重命名、复制 bbox。
4. 支持按类型筛选：文字、形状、图片、复杂区域。
5. 支持“重跑当前页 OCR / 重跑背景修复 / 重跑对象分割”。

### 4.5 结构引擎插件化

优先级：P1

把 `analyzeImagePage()` 内的单体规则拆开：

1. `ocr-engine.ts`
2. `layout-engine.ts`
3. `mask-engine.ts`
4. `background-cleaner.ts`
5. `ast-merge.ts`

价值：后续接 PaddleOCR、SAM、MinerU 不会把 `import.ts` 越堆越大。

## 5. 不建议现在做的事

1. 不建议追求所有元素都矢量化。
   - 图表、复杂插画、照片、视频截图区域应作为独立图片层。

2. 不建议只接一个大模型让它直接输出 PPT。
   - 结果不可控，文字 100% 保真难保证。

3. 不建议把 Python OCR/分割模型直接塞进 Next.js API route。
   - 会影响启动速度和安装包稳定性，应采用子进程/本地服务。

4. 不建议让 SAM 自动 mask 全图后直接导出。
   - 容易产生大量碎片图层，PPT 很难编辑。

## 6. 推荐执行顺序

### 阶段一：稳定可用

1. 接 PaddleOCR CPU 版作为跨平台 OCR。
2. 实现 OCR bbox -> text mask。
3. 实现 cleaned background 生成和保存。
4. 导出优先使用 cleaned background + editable text。
5. 前端显示背景修复状态。

验收：

1. 图片/PDF 输入导出的 PPT 不再是整页图片。
2. 主要文字可编辑。
3. 原图文字不会大面积残留。

### 阶段二：元素层增强

1. 接 SAM/SAM2 或轻量 ONNX segmentation。
2. 只对候选视觉区域做 mask refinement。
3. 人物、产品、图标、插画导出为独立透明 PNG 图层。
4. 前端可查看、隐藏、调整这些图层。

验收：

1. 除文字外，画面里的关键视觉元素能独立成层。
2. 不产生过多碎片图层。

### 阶段三：高保真结构

1. 接 PP-StructureV3 或 MinerU JSON。
2. 增强表格、图表、标题层级、左右栏布局。
3. 增加页面级评分和自动复核建议。

验收：

1. 复杂商业 PPT 页面有更稳定的块级结构。
2. 低置信度区域能明确提示并支持重跑。

## 7. 结论

最值得借鉴的不是某一个项目的代码，而是组合路线：

1. `NBLM2PPTX / px-image2pptx`：短期借鉴“干净背景 + 可编辑文字层”。
2. `PaddleOCR / PP-StructureV3`：补跨平台 OCR 和结构识别。
3. `SAM / SAM2`：把非文字的关键视觉元素做成独立图层。
4. `LaMa`：本地批量背景修复。
5. `MinerU2PPT`：中长期借鉴结构 JSON 到 PPTX 的重建流程和回归测试体系。

这条路线能避免“导出还是一张图”与“在原图上盖色块”两个核心问题，同时保留复杂视觉区域的高保真。
