# 可编辑 PPT 模块接口设计文档

## 1. 目的

本文档定义 `可编辑PPT` 模块的前后端接口，目标是让当前平台新增一个独立能力：

1. 导入 `PPTX / PDF / 图片包`
2. 自动拆页、OCR、结构解析
3. 逐页预览识别结果
4. 手动修正元素
5. 导出 `可编辑 PPTX`
6. 后续一键推送到 `PPT 工作台`

本文档与以下文件配套：

- [EDITABLE_PPT_TECH_PLAN.md](/Users/congrong/Documents/AI平台/docs/EDITABLE_PPT_TECH_PLAN.md)
- [EDITABLE_PPT_DATABASE_SCHEMA.md](/Users/congrong/Documents/AI平台/docs/EDITABLE_PPT_DATABASE_SCHEMA.md)
- [EDITABLE_PPT_FRONTEND_MODULES.md](/Users/congrong/Documents/AI平台/docs/EDITABLE_PPT_FRONTEND_MODULES.md)

---

## 2. 设计原则

### 2.1 独立模块，不破坏现有工作台

不直接改写现有 `src/components/PPTWorkshop.tsx`。  
建议新增独立模块：

- `EditablePptWorkbench`

它与现有：

- 画布
- PPT 工作台
- 批量模块

并列存在。

### 2.2 接口风格与现有项目保持一致

延续当前项目 API 风格：

- 路径位于 `src/app/api/...`
- Route Handler 返回 `NextResponse.json(...)`
- 文件导出返回二进制 `NextResponse`
- 用户鉴权复用 `getCurrentUserId()`

### 2.3 任务化处理

图片转可编辑 PPT 不是同步接口，必须任务化。

建议任务阶段：

1. `queued`
2. `preprocessing`
3. `ocr`
4. `layout`
5. `reconstructing`
6. `ready`
7. `failed`
8. `cancelled`

---

## 3. 模块目录建议

建议新增以下 API 目录：

```text
src/app/api/editable-ppt/
├── import/route.ts
├── jobs/route.ts
├── jobs/[id]/route.ts
├── jobs/[id]/pages/route.ts
├── jobs/[id]/pages/[pageId]/route.ts
├── jobs/[id]/pages/[pageId]/reparse/route.ts
├── jobs/[id]/pages/[pageId]/elements/[elementId]/route.ts
├── jobs/[id]/export/route.ts
├── jobs/[id]/exports/route.ts
└── jobs/[id]/push-to-workshop/route.ts
```

如需内部 worker，可在服务端新增内部模块，不对外暴露：

```text
src/lib/editable-ppt/
├── pipeline.ts
├── pptx-export.ts
├── page-parser.ts
├── queue.ts
├── storage.ts
└── types.ts
```

---

## 4. 核心对象模型

## 4.1 EditablePptJob

```ts
interface EditablePptJob {
  id: string;
  projectId: string | null;
  userId: string | null;
  sourceType: "pptx" | "pdf" | "image_zip" | "images";
  sourceName: string;
  pageCount: number;
  parsedCount: number;
  failedPageCount: number;
  status: "queued" | "preprocessing" | "ocr" | "layout" | "reconstructing" | "ready" | "failed" | "cancelled";
  progress: number;
  coverImageUrl?: string;
  aspectRatioGuess?: string;
  warnings: string[];
  config: EditablePptConfig;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}
```

## 4.2 EditablePptPage

```ts
interface EditablePptPage {
  id: string;
  jobId: string;
  pageNumber: number;
  title: string;
  role: string;
  sourceImageUrl: string;
  previewImageUrl?: string;
  width: number;
  height: number;
  parseStatus: "queued" | "processing" | "ready" | "failed";
  parseConfidence: number;
  ocrText: string;
  normalizedText: string;
  ast: SlideAst | null;
  elementsCount: number;
  errorMessage?: string | null;
  updatedAt: string;
}
```

## 4.3 EditablePptElement

```ts
interface EditablePptElement {
  id: string;
  pageId: string;
  type: "text" | "image" | "shape" | "icon" | "table" | "chart_or_complex" | "background";
  bbox: [number, number, number, number];
  zIndex: number;
  rotation: number;
  opacity: number;
  groupId?: string | null;
  confidence: number;
  textContent?: string;
  style?: Record<string, unknown>;
  assetUrl?: string | null;
  hidden: boolean;
  locked: boolean;
}
```

## 4.4 EditablePptConfig

```ts
interface EditablePptConfig {
  parseMode: "fast" | "balanced" | "high_fidelity";
  languageHint: "auto" | "zh" | "en" | "multi";
  detectTables: boolean;
  detectIcons: boolean;
  rebuildShapes: boolean;
  exportStrategy: "hybrid" | "editable_first" | "fidelity_first";
}
```

---

## 5. 接口清单

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/editable-ppt/import` | `POST` | 创建导入任务，保存源文件，初始化 job 和 pages |
| `/api/editable-ppt/jobs` | `GET` | 获取任务列表 |
| `/api/editable-ppt/jobs/[id]` | `GET` | 获取单任务详情 |
| `/api/editable-ppt/jobs/[id]` | `PATCH` | 更新任务配置、重命名、取消任务 |
| `/api/editable-ppt/jobs/[id]` | `DELETE` | 删除任务及其派生数据 |
| `/api/editable-ppt/jobs/[id]/pages` | `GET` | 获取任务的页面列表 |
| `/api/editable-ppt/jobs/[id]/pages/[pageId]` | `GET` | 获取单页详情与元素列表 |
| `/api/editable-ppt/jobs/[id]/pages/[pageId]` | `PATCH` | 更新页面元信息或页面级参数 |
| `/api/editable-ppt/jobs/[id]/pages/[pageId]/reparse` | `POST` | 重新解析某一页 |
| `/api/editable-ppt/jobs/[id]/pages/[pageId]/elements/[elementId]` | `PATCH` | 更新元素位置、类型、文字、样式 |
| `/api/editable-ppt/jobs/[id]/export` | `POST` | 触发导出可编辑 PPTX |
| `/api/editable-ppt/jobs/[id]/exports` | `GET` | 获取该任务的导出历史 |
| `/api/editable-ppt/jobs/[id]/push-to-workshop` | `POST` | 将页面结果推送到现有 PPT 工作台 |

---

## 6. 详细接口设计

## 6.1 `POST /api/editable-ppt/import`

### 用途

导入源文件，创建任务，初始化页面记录，并启动解析流程。

### 请求

`multipart/form-data`

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 是 | `pptx/pdf/zip` |
| `files[]` | File[] | 否 | 批量图片时使用 |
| `projectId` | string | 否 | 关联现有项目 |
| `name` | string | 否 | 任务名称 |
| `config` | JSON string | 否 | 解析配置 |

### 响应

```json
{
  "job": {
    "id": "job_xxx",
    "status": "queued",
    "pageCount": 12,
    "parsedCount": 0,
    "warnings": []
  },
  "pages": [
    {
      "id": "page_xxx",
      "pageNumber": 1,
      "title": "第 1 页",
      "parseStatus": "queued",
      "sourceImageUrl": "/api/local-file/..."
    }
  ]
}
```

### 实现说明

可参考现有：

- [src/app/api/ppt-workshop/import/route.ts](/Users/congrong/Documents/AI平台/src/app/api/ppt-workshop/import/route.ts)

但新接口必须把结果落库为独立任务，而不是只返回内存结构。

---

## 6.2 `GET /api/editable-ppt/jobs`

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `projectId` | string | 按项目过滤 |
| `status` | string | 按状态过滤 |
| `limit` | number | 默认 20 |
| `offset` | number | 默认 0 |

### 响应

```json
{
  "items": [],
  "total": 0
}
```

### 用途

支持：

1. 模块首页任务列表
2. 最近导入记录
3. 历史项目恢复

---

## 6.3 `GET /api/editable-ppt/jobs/[id]`

### 返回

```json
{
  "job": {
    "id": "job_xxx",
    "status": "layout",
    "progress": 48,
    "pageCount": 20,
    "parsedCount": 9
  },
  "summary": {
    "readyPages": 8,
    "failedPages": 1,
    "textBlocks": 132,
    "imageBlocks": 47,
    "shapeBlocks": 29
  }
}
```

### 用途

主工作台顶部状态条和右侧概览面板。

---

## 6.4 `PATCH /api/editable-ppt/jobs/[id]`

### 支持更新字段

1. `name`
2. `config`
3. `status=cancelled`
4. `projectId`

### 请求示例

```json
{
  "config": {
    "parseMode": "high_fidelity",
    "detectTables": true,
    "rebuildShapes": true
  }
}
```

### 用途

用户修改解析策略后触发后续页重新解析。

---

## 6.5 `DELETE /api/editable-ppt/jobs/[id]`

### 行为

1. 删除任务记录
2. 删除页面、元素、导出记录
3. 清理本地或对象存储文件

### 注意

建议先软删除 V1 的任务记录，再异步清理资源。

---

## 6.6 `GET /api/editable-ppt/jobs/[id]/pages`

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | string | `ready/failed/processing` |
| `page` | number | 页码筛选 |

### 响应

```json
{
  "items": [
    {
      "id": "page_1",
      "pageNumber": 1,
      "title": "封面页",
      "parseStatus": "ready",
      "previewImageUrl": "/api/local-file/...",
      "parseConfidence": 0.91,
      "elementsCount": 14
    }
  ]
}
```

### 用途

左侧缩略图列表、状态列表、失败页筛选。

---

## 6.7 `GET /api/editable-ppt/jobs/[id]/pages/[pageId]`

### 返回

```json
{
  "page": {
    "id": "page_1",
    "pageNumber": 1,
    "ocrText": "年度业务复盘",
    "ast": {}
  },
  "elements": []
}
```

### 用途

主预览区加载单页结构数据、图层面板、属性面板。

---

## 6.8 `PATCH /api/editable-ppt/jobs/[id]/pages/[pageId]`

### 支持字段

1. `title`
2. `role`
3. `pageTags`
4. `manualNotes`
5. `parseStatus` 仅内部使用

### 用途

允许用户人工修正页面角色与说明。

---

## 6.9 `POST /api/editable-ppt/jobs/[id]/pages/[pageId]/reparse`

### 用途

重新解析某一页，而不是整套全部重跑。

### 请求示例

```json
{
  "config": {
    "parseMode": "high_fidelity",
    "detectTables": true,
    "languageHint": "zh"
  }
}
```

### 响应

```json
{
  "ok": true,
  "pageId": "page_1",
  "status": "processing"
}
```

### 触发场景

1. OCR 识别差
2. 表格未识别
3. 页面类型误判
4. 字体恢复偏差大

---

## 6.10 `PATCH /api/editable-ppt/jobs/[id]/pages/[pageId]/elements/[elementId]`

### 用途

更新元素级修正结果。

### 支持字段

1. `type`
2. `bbox`
3. `zIndex`
4. `textContent`
5. `style`
6. `hidden`
7. `locked`
8. `groupId`

### 请求示例

```json
{
  "bbox": [120, 88, 992, 126],
  "textContent": "年度业务复盘",
  "style": {
    "fontSize": 34,
    "fontWeight": 700,
    "align": "left"
  }
}
```

### 注意

修改后需要：

1. 更新页面 AST
2. 记录 revision
3. 标记页面为 `manually_adjusted`

---

## 6.11 `POST /api/editable-ppt/jobs/[id]/export`

### 用途

触发导出真正的分层可编辑 PPTX。

### 请求示例

```json
{
  "pageIds": ["page_1", "page_2"],
  "exportMode": "pptx",
  "includeHidden": false
}
```

### 响应

```json
{
  "exportId": "export_xxx",
  "status": "queued"
}
```

### 说明

不要同步直接生成文件。  
应创建导出记录，再由导出 worker 处理，完成后前端轮询或 SSE 更新。

---

## 6.12 `GET /api/editable-ppt/jobs/[id]/exports`

### 返回

```json
{
  "items": [
    {
      "id": "export_xxx",
      "exportType": "pptx",
      "status": "ready",
      "fileUrl": "/api/local-file/...",
      "createdAt": "2026-06-11T10:00:00.000Z"
    }
  ]
}
```

### 用途

导出历史、重新下载、失败重试。

---

## 6.13 `POST /api/editable-ppt/jobs/[id]/push-to-workshop`

### 用途

把当前任务页面结果推送到现有 `PPT 工作台`，作为后续批量美化原稿。

### 请求示例

```json
{
  "targetProjectId": "ppt_workshop_project_xxx",
  "pageIds": ["page_1", "page_2"]
}
```

### 行为

1. 取页面源图或渲染图
2. 映射为 `PPTSlide`
3. 写入工作台项目结构

### 价值

形成完整链路：

`原稿 -> 可编辑恢复 -> 工作台美化`

---

## 7. 任务执行流

## 7.1 导入后处理流程

```text
POST import
  -> 保存源文件
  -> 拆页
  -> 创建 job
  -> 创建 pages
  -> 启动 queue
  -> page parser 逐页执行
  -> 写入 ast/elements
  -> job.progress 更新
```

## 7.2 导出流程

```text
POST export
  -> 创建 export record
  -> 读取 selected pages + elements
  -> 转换为 PptxGenJS objects
  -> 生成 PPTX
  -> 保存文件
  -> export.status = ready
```

---

## 8. 鉴权与权限

### 8.1 权限原则

复用现有项目鉴权：

1. 当前登录用户只能读写自己的任务
2. 若走本地/访客模式，允许本机本地任务

### 8.2 鉴权实现

沿用：

- `getCurrentUserId(request)`

若未来增加团队共享，可在 `job.projectId` 上挂接项目权限。

---

## 9. 错误码建议

| 场景 | 状态码 | error |
|------|--------|-------|
| 未登录 | `401` | `未登录` |
| 文件类型不支持 | `400` | `不支持的文件类型` |
| 未找到任务 | `404` | `任务不存在` |
| 页面不存在 | `404` | `页面不存在` |
| 导出失败 | `500` | `导出失败` |
| 解析依赖缺失 | `500` | `缺少 LibreOffice/Poppler/Python OCR 依赖` |

建议错误响应统一：

```json
{
  "error": "导出失败",
  "detail": "第 3 页表格结构异常"
}
```

---

## 10. 与当前代码的结合建议

### 10.1 可复用的现有能力

1. [src/app/api/ppt-workshop/import/route.ts](/Users/congrong/Documents/AI平台/src/app/api/ppt-workshop/import/route.ts)
   - 可复用 PPTX/PDF/ZIP 导入与拆页经验
2. [src/app/api/ppt-workshop/export/route.ts](/Users/congrong/Documents/AI平台/src/app/api/ppt-workshop/export/route.ts)
   - 可复用 `PptxGenJS` 输出逻辑骨架
3. `saveBinaryFile`
   - 可复用本地文件保存策略

### 10.2 不建议复用的部分

1. `PPT 工作台` 的项目状态结构
2. 工作台的风格确认与审核逻辑

因为 `可编辑PPT` 的核心是“识别/修正/重建”，而不是“风格生成”。

---

## 11. 外部能力边界

### 11.1 Node 层职责

1. 文件导入
2. 任务管理
3. 导出管理
4. PPTX 生成
5. 页面/元素增删改

### 11.2 Python 层职责

1. OCR
2. 版式识别
3. 表格识别
4. 图形识别
5. 结构化 JSON 输出

建议 Node 与 Python 间先走本地命令调用或本地 HTTP 服务，不要一开始就上分布式队列。

---

## 12. 参考资料

以下资料可作为实现约束的官方依据：

1. PptxGenJS `Text` API：支持 `addText`、字号、字体、行距、段距、边框、文本框等  
   [官方文档](https://gitbrent.github.io/PptxGenJS/docs/api-text/)
2. PptxGenJS `Images` API：支持 `path` 和 `base64 data` 两种方式写入图片  
   [官方文档](https://gitbrent.github.io/PptxGenJS/docs/api-images/)
3. PptxGenJS `Shapes` API：支持矩形、圆、线、旋转、描边、填充等  
   [官方文档](https://gitbrent.github.io/PptxGenJS/docs/api-shapes/)
4. PptxGenJS `Tables` API：支持原生表格、单元格级格式、自动分页  
   [官方文档](https://gitbrent.github.io/PptxGenJS/docs/api-tables/)
5. PaddleOCR：支持 PDF/图片转结构化数据，并支持 100+ 语言  
   [官方项目](https://github.com/PaddlePaddle/PaddleOCR)
6. PaddleOCR `Layout analysis`：支持文字、标题、表格、图片等区域检测  
   [官方文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/ppstructure/layout/README.md)
7. LibreOffice PDF CLI 参数：确认 headless 导出与 PDF filter 的能力边界  
   [官方帮助](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)

