# Codia 文档学习结论与自研可编辑 PPT 重构方案

## 1. 结论先行

这次不接入 Codia，也不依赖它的模型或 API。

我们只借鉴它公开文档里已经验证过的产品和工程方法，然后把这些方法落到环中AIStudio 自己的 `分层 / 可编辑 PPT` 能力里。

核心结论只有一句话：

**当前模块失败的根因，不是“模型不够强”，而是我们现在的处理链路太短，少了“结构理解层”。**

目前我们的图片版 PPT 路径，基本是：

`整页图片 -> OCR 行文本 -> 直接生成文本框 -> 背景涂抹 -> 导出 PPT`

这个链路对简单页偶尔可用，但对真实 PPT 页面会天然失真，直接导致：

1. 文本框错位、重叠、串行。
2. 大面积灰块/脏背景。
3. 图文关系丢失。
4. 复杂区域被硬拆成大量错误文本框。
5. 导出的 PPT 虽然“可编辑”，但实际上不可用。

Codia 文档给出的正确方向是：

`视觉输入 -> 结构树 -> 低置信度过滤 -> 分类型重建 -> 再导出`

这也是我们后续必须采用的自研路线。

---

## 2. 从 Codia 文档里学到的关键模式

以下结论来自 Codia 的公开产品文档、开发文档和官方博客，不涉及任何私有实现。

### 2.1 先做统一结构树，不要直接拼 PPT

Codia 的 `Visual Struct` 和 `PDF to Visual Struct` 都不是直接返回最终设计文件，而是先返回一个统一的层级化结构：

- 元素类型
- 父子关系
- 边界框
- 布局方式
- 样式信息
- 置信度

这说明他们把“视觉理解”与“最终导出”分成了两层。

对我们来说，这意味着必须补一个中间层，而不是继续让 `import.ts` 直接把 OCR 行转换成导出元素。

### 2.2 结构不是“盒子列表”，而是“布局树”

Codia 文档反复强调几点：

- 每个元素有 `elementType`
- 元素有 `childElements`
- 元素有 `layoutConfig`
- 元素有 `processingMeta.detectionScore`

这说明它们的重点不是“识别出多少框”，而是：

1. 这些框分别是什么。
2. 哪些框属于同一组。
3. 这些组是横向排列、纵向排列，还是绝对定位。

这正是我们现在最缺的部分。

### 2.3 单页处理，而不是整份文档一把梭

Codia 的 `pdf_to_design` 是按页处理的：

- 一次请求只处理一页
- 多页靠客户端循环和并发

这背后的工程启示很明确：

1. 页面失败应当页级重试。
2. 页面状态应当单独可见。
3. 导出是否允许，应当按页累计结果，而不是只看任务是否结束。

我们当前已经有 `job / page / element` 三层数据结构，这点方向是对的，但状态机还不够细。

### 2.4 低置信度元素要过滤，不要强行导出

Codia 文档明确建议使用 `detectionScore` 过滤低置信度节点。

这非常关键。

我们现在的问题之一，就是把低质量 OCR 结果也强行变成文本框，再叠到导出里。结果就是：

- 错字
- 错位
- 重复框
- 覆盖原图
- 文本跑飞

后续自研必须改成：

- 高置信度文本：转成真实文本框
- 中置信度文本：进入待审或页级警告
- 低置信度区域：直接保留为栅格图层，不参与文本重建

### 2.5 复杂区域不应该硬拆，可保留为图片层

Codia 对外表达的重点是“重建可编辑结构”，但并没有承诺所有像素都要彻底对象化。

从其文档的结构字段和产品定位可以推断出一个稳妥原则：

- 文本、基础形状、简单图表标题适合编辑化
- 复杂插画、照片、强特效、复杂图表主体适合保留图片

这和我们现在“能拆就拆”的思路相反。

正确策略应当是：

**优先保证可用性，再追求可编辑率。**

### 2.6 输入类型必须分流，不同来源不能用同一套粗暴逻辑

Codia 文档对输入有明确区分：

- 文本原生 PDF：保真度最高
- 扫描 PDF：自动 OCR，但噪声更高
- 图片版 slides：可做，但要更多复核

这点对我们尤其重要。

我们当前把 `pptx / pdf / images` 最终都压成相似的页面图片流，再走过于统一的逻辑，导致图像来源差异被抹平。

后续必须分流：

1. `pptx`：优先读原生结构，图片化只作为补充。
2. `text-native pdf`：优先抽文本与矢量。
3. `image-only pdf / images`：先做视觉结构识别，再做有限重建。

### 2.7 任务化、进度化、可重试，不要“导入完就算成功”

Codia 的产品和 API 文档都体现出清晰的任务流与阶段状态。

这个方法值得直接借鉴。

我们当前导入完成后，前端很容易把“任务已创建”误认为“已经可导出”。这会误导用户。

后续必须把状态拆清楚：

- 已导入
- 已标准化
- 已完成结构分析
- 已生成重建草案
- 达到可编辑导出阈值
- 部分可用
- 失败

只有进入“可编辑导出阈值已达成”后，才应该点亮导出按钮。

---

## 3. 结合我们当前代码，问题到底出在哪

以下分析基于当前仓库实现。

### 3.1 当前图片导入路径过于依赖 OCR 行

当前 `src/lib/editable-ppt/import.ts` 的图片导入路线，本质是：

1. 读取页面图
2. 用本机 Vision OCR 拿到 `ocrLines`
3. 每一行文字直接变成一个 `text` 元素
4. 根据 OCR 框区域做一个“清洁背景图”
5. 导出时把背景图铺底，再把文本框叠上去

这会直接导致两个硬伤：

1. `行` 不等于 `段落`，更不等于 `文本容器`。
2. OCR 框周围的背景涂抹，会破坏原页面的真实视觉层。

所以用户看到的大灰块、文字错位，本质上不是偶发 bug，而是当前方法本身就不成立。

### 3.2 当前没有“区域检测”和“分组”

目前没有一层明确的：

- 标题区
- 正文区
- 图片区
- 图标区
- 表格区
- 装饰背景区
- 页眉页脚区

也没有：

- 同组卡片识别
- 左右栏识别
- 网格识别
- 对齐关系识别

因此导出时只能把识别结果看成散点元素，自然会乱。

### 3.3 当前没有低置信度回退策略

虽然数据结构里已经有 `parse_confidence` 和 `element.confidence`，但导出策略基本没有真正利用这个信号。

结果是：

- 置信度低的文字照样导出
- 置信度低的区域没有图片回退
- 页级质量没有量化阈值

这直接拉低了整体可用性。

### 3.4 当前导出层把很多复杂元素都当图片贴回去了

`src/lib/editable-ppt/export.ts` 里，`image / icon / chart_or_complex / shape / table` 很多类型最终都还是按图片贴回。

这本身不一定错，但现在的问题是：

1. 上游没有可靠地区分“真 shape”和“复杂截图片段”。
2. 下游没有根据类型做更细的对象重建。
3. 因此“可编辑”与“图片兜底”的边界是混乱的。

### 3.5 当前图片导入分支仍然可能 0 元素

我们已经验证过，图片导入任务存在 `text=0 / image=0 / total=0` 的情况。

这说明当前图片版路径甚至还没达到“最基础可用”。

因此接下来不应该继续在现有链路上修补小 bug，而是要补足中间结构层。

---

## 4. 我们自己的目标架构

后续建议把“分层/可编辑 PPT”模块拆成四层。

### 4.1 输入标准化层

职责：

1. 识别输入类型。
2. 提取原生结构或渲染页面图。
3. 统一生成页级任务。

输入分流建议：

- `pptx_native`
- `pdf_text_native`
- `pdf_scanned`
- `image_pack`
- `single_image`

### 4.2 结构理解层

这是当前最缺的核心层。

每页都先输出一个统一结构对象，例如：

```ts
interface SlideStructureRoot {
  pageId: string;
  width: number;
  height: number;
  sourceKind: "pptx" | "pdf" | "image";
  editableScore: number;
  children: SlideNode[];
  warnings: string[];
}

interface SlideNode {
  id: string;
  type: "group" | "text" | "image" | "shape" | "table" | "chart" | "background" | "unknown";
  bbox: [number, number, number, number];
  layoutMode?: "absolute" | "row" | "column" | "grid";
  confidence: number;
  content?: {
    text?: string;
    imageKey?: string;
  };
  style?: Record<string, unknown>;
  children?: SlideNode[];
  fallbackStrategy?: "editable" | "rasterize" | "manual_review";
}
```

注意点：

1. 这不是最终 PPT 元素。
2. 这是中间结构树。
3. 导出器、预览器、人工修正器都使用它。

### 4.3 重建策略层

按节点类型决定如何输出：

- `text`：文本框
- `shape`：PPT 原生形状
- `simple table`：可编辑表格或多文本框网格
- `image`：图片对象
- `complex chart / decorated region`：图片兜底
- `unknown`：默认图片兜底或人工复核

### 4.4 导出与验收层

导出前先跑页级验收：

- 文本覆盖率
- 可编辑对象数
- 低置信度比例
- 未知节点比例
- 页面重叠风险

只有评分达标，才允许标记为“可编辑导出”。

---

## 5. 新的页面处理流水线

建议把图片版处理流程改成下面这样。

### 阶段 A：页面预处理

1. 读取原图尺寸。
2. 生成 OCR 版高对比图。
3. 生成视觉分区版。
4. 保留原图，不做破坏性背景擦除。

关键原则：

**不再先做大面积背景涂抹。**

### 阶段 B：区域分区

识别页面大区块：

- 页眉
- 标题区
- 正文文本区
- 图片区
- 表格区
- 图表区
- 页脚
- 背景装饰

输出的是区块，而不是直接文本框。

### 阶段 C：文本容器恢复

对每个文本区：

1. OCR 识别文本。
2. 把多行聚成段落。
3. 推断标题/正文/注释层级。
4. 估算字号、对齐、行高、字重。
5. 给每个文本容器打置信度。

关键变化：

**从“按行建框”改成“按文本容器建框”。**

### 阶段 D：图像与复杂区抽取

对非文本区：

1. 裁切真实图片块。
2. 识别简单色块/矩形/圆角卡片。
3. 无法稳定对象化的区域，保留成局部图片。

### 阶段 E：布局关系恢复

根据区块位置和间距推断：

- 单列 / 双列 / 三列
- 卡片组
- 标题 + 内容
- 图文左右布局
- 网格阵列

### 阶段 F：页级评分

给每页计算：

- `textRecoveryScore`
- `layoutRecoveryScore`
- `editableCoverage`
- `riskScore`

再决定：

- `editable_ready`
- `partial_ready`
- `needs_review`
- `failed`

---

## 6. 对当前数据结构的改造建议

### 6.1 保留现有 job/page/element 三层，但补一层 structure

现在已有：

- `job`
- `page`
- `element`

建议新增：

- `page_structure_json`
- `page_metrics_json`
- `page_warnings_json`

最少可以先直接挂在 `EditablePptPageRecord` 上。

建议新增字段：

```ts
structure_json: string;
metrics_json: string;
page_mode: "native" | "ocr" | "hybrid" | "raster_fallback";
editable_score: number;
text_recovery_score: number;
layout_recovery_score: number;
unknown_node_ratio: number;
```

### 6.2 Element 需要区分“导出元素”和“检测节点”

现在 `EditablePptElementRecord` 同时承担了：

- 识别结果
- 编辑对象
- 导出对象

这会让职责混乱。

建议拆分概念：

1. `DetectedNode`：结构识别节点
2. `ExportElement`：最终导出的 PPT 元素

如果暂时不建新表，至少要补字段：

```ts
origin_stage: "native" | "ocr" | "region" | "fallback";
export_mode: "editable" | "raster" | "ignored";
parent_id: string | null;
node_role: "title" | "body" | "caption" | "decoration" | "unknown";
```

### 6.3 job 状态机要更细

当前 job 状态不够表达真实质量。

建议扩展为：

- `queued`
- `normalizing`
- `structuring`
- `reconstructing`
- `partial_ready`
- `editable_ready`
- `needs_review`
- `failed`
- `cancelled`

前端不要再把 `ready` 一概理解成“可以高质量导出”。

---

## 7. 对当前导出策略的改造建议

### 7.1 不再默认铺“清洁背景图”

这是当前视觉脏块的主要来源之一。

建议改成：

1. 如果页面结构恢复较好：
   - 纯色背景直接转背景色
   - 简单底板转形状
   - 局部复杂背景转局部图层
2. 如果页面结构恢复较差：
   - 整页直接走“混合保真页”模式
   - 而不是做背景抹除后再叠文本框

### 7.2 复杂区局部栅格化，而不是整页栅格化

这点非常重要。

正确做法不是：

- 整页变一张图

而是：

- 文本区可编辑
- 简单形状区可编辑
- 复杂图表区栅格化
- 装饰纹理区栅格化

这样导出的 PPT 既能改字，也不至于完全失真。

### 7.3 允许三种导出模式

建议前端暴露三种导出策略：

1. `高可编辑`：尽量对象化，适合结构清晰页。
2. `平衡`：文本优先编辑，复杂区图片兜底。
3. `高保真`：尽量接近原图，允许更多局部图片。

默认建议用 `平衡`。

---

## 8. 前端与交互层应该怎么改

### 8.1 导入后先看“结构预览”，不要直接让用户导出

建议在 `EditablePptWorkbench` 里新增三种视图切换：

- 原图
- 结构区块
- 最终导出预览

这样用户能快速看出：

- 结构有没有识别对
- 哪些区域会以图片保留
- 哪些文字能真正编辑

### 8.2 页级风险提示必须可见

每页都应该显示：

- 识别置信度
- 可编辑覆盖率
- 低置信度节点数
- 是否建议人工复核

### 8.3 不达标页面禁止混入“高可编辑导出”

当前问题之一是用户点导出后才发现结果不可用。

应改为：

- 页面达标才可加入 `高可编辑导出`
- 不达标页面自动降级为 `平衡` 或 `高保真`
- 或要求用户点“重新解析本页”

### 8.4 页面级重试而不是整任务重跑

这点可以直接借鉴 Codia 的单页处理思路。

对于失败页，只重跑：

- OCR
- 区块分割
- 版式恢复
- 导出映射

而不是整份任务重做。

---

## 9. 针对当前代码库的分阶段落地计划

## Phase 1：止血

目标：先把“明显不可用的导出”挡住。

要做的事：

1. 保留现有导出拦截逻辑。
2. 增加页级 `editable_score` 计算。
3. 增加 `partial_ready / editable_ready` 状态区分。
4. 当 `images` 导入且无有效结构时，默认禁止普通导出。
5. 前端明确提示“当前仅能高保真混合导出，不能承诺高编辑性”。

## Phase 2：补结构层

目标：把“按 OCR 行建框”改成“按结构区块建树”。

要做的事：

1. 新增 `SlideStructureRoot` 中间结构。
2. 在 `import.ts` 中增加：
   - 区块分割
   - 文本聚类
   - 图像区抽取
   - 页面布局推断
3. 补 `structure_json / metrics_json`。
4. 让前端可以查看结构树。

## Phase 3：重写导出映射

目标：把结构树映射成更可靠的 PPT 元素。

要做的事：

1. 文本容器导出为真实文本框。
2. 简单卡片和矩形导出为原生形状。
3. 表格页先做有限支持，不要过度承诺。
4. 复杂图表和装饰区做局部图片兜底。
5. 去掉当前“整页清洁背景图 + OCR 文字叠加”的主路径。

## Phase 4：页级修复与人工校正

目标：让结果可调、可复跑、可控。

要做的事：

1. 增加页级重跑按钮。
2. 增加节点隐藏/降级为图片/恢复文本三类操作。
3. 增加导出前验收面板。
4. 记录失败类型，形成后续优化样本。

---

## 10. 具体到我们仓库，建议优先改哪些文件

### 第一批重点文件

1. `src/lib/editable-ppt/import.ts`
   - 这里要从“直接生成元素”改成“先产出结构树”。

2. `src/lib/editable-ppt/types.ts`
   - 这里要补结构层、评分层、页级模式字段。

3. `src/lib/editable-ppt/export.ts`
   - 这里要从“背景图 + 文本框叠加”改成“结构化导出 + 局部栅格兜底”。

4. `src/components/EditablePptWorkbench.tsx`
   - 这里要补：结构预览、页级风险、导出门槛、模式切换。

### 第二批文件

1. `src/lib/editable-ppt/ast.ts`
   - 当前 AST 更像轻量结果快照，后续要升级为真正的页面结构树转换层。

2. `src/app/api/editable-ppt/jobs/[id]/route.ts`
   - 要补质量指标返回。

3. `src/app/api/editable-ppt/jobs/[id]/pages/[pageId]/route.ts`
   - 要补页级结构与诊断信息。

4. `src/app/api/editable-ppt/jobs/[id]/export/route.ts`
   - 要按页面评分决定导出策略。

---

## 11. 风险评估

### 风险 1：图片版 PPT 不可能 100% 全对象化

这是事实，不是工程失误。

对策：

- 默认采用混合导出
- 不做“所有页都 100% 可编辑”的错误承诺

### 风险 2：OCR 质量受原图影响很大

对策：

- 预处理增强
- 页级低置信度回退
- 人工复核入口

### 风险 3：表格、复杂图表、渐变装饰是高风险区

对策：

- V1 不强拆
- 优先局部图片兜底
- 后续单独做专项增强

### 风险 4：PPT 原生对象映射差异会导致视觉漂移

对策：

- 导出前预估行高、缩放、对齐
- 导出后做回读验证
- 必要时允许文本框自适应缩放

---

## 12. 最终建议

如果目标是“看起来像分层 PPT”，当前继续修补已有 OCR 行方案意义不大。

如果目标是“真正能编辑、且不至于失真”，就必须按下面的顺序推进：

1. 先补结构层。
2. 再补页级评分和门槛。
3. 再重写导出策略。
4. 最后做人工修复与批量流程。

简单说：

**我们要学的不是 Codia 的模型，而是它把视觉输入先变成结构树，再决定怎么导出的工程方法。**

这条路线适合我们自己做，而且比继续在当前链路上修补更稳。

---

## 13. 官方资料来源

以下资料仅用于方法学习，不做第三方能力接入：

1. Codia Docs Introduction  
   https://codia.ai/docs/introduction

2. Codia Visual Struct Docs  
   https://codia.ai/docs/visual-struct

3. Codia PDF to Visual Struct Docs  
   https://codia.ai/docs/pdf-to-visual-struct

4. Codia API Reference  
   https://developer.codia.ai/

5. Codia NoteSlide 产品页  
   https://codia.ai/noteslide/

6. Codia Visual Struct API 官方博客  
   https://codia.ai/blog/visual-struct-api

7. Codia PDF to Visual Struct 官方博客  
   https://codia.ai/ru/blog/pdf-to-visual-struct

8. Codia NoteSlide 官方博客  
   https://codia.ai/blog/pdf-to-presentation-noteslide-guide
