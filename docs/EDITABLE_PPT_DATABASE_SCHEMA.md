# 可编辑 PPT 模块数据库表设计文档

## 1. 目的

本文档定义 `可编辑PPT` 模块的数据库表结构，目标是支持：

1. 导入任务持久化
2. 页面级解析状态追踪
3. 元素级分层结果保存
4. 人工修正历史保存
5. 导出记录保存

设计原则：

1. 尽量贴合当前 `schema.ts` 风格
2. V1 优先快速接入
3. V2/V3 为结构化增强预留字段

当前主 schema 文件：

- [src/storage/database/shared/schema.ts](/Users/congrong/Documents/AI平台/src/storage/database/shared/schema.ts)

---

## 2. 与现有表关系

新模块需要关联以下现有表：

1. `users`
2. `projects`

关联方式：

1. `editable_ppt_jobs.user_id -> users.id`
2. `editable_ppt_jobs.project_id -> projects.id`

这样可直接融入现有项目体系、用户体系、权限体系。

---

## 3. 表设计总览

建议新增 5 张表：

1. `editable_ppt_jobs`
2. `editable_ppt_pages`
3. `editable_ppt_elements`
4. `editable_ppt_exports`
5. `editable_ppt_revisions`

说明：

1. `jobs` 管任务
2. `pages` 管逐页结果
3. `elements` 管页面对象层
4. `exports` 管导出历史
5. `revisions` 管修正历史

---

## 4. 字段设计

## 4.1 `editable_ppt_jobs`

### 用途

保存一次完整导入任务的元信息和总体状态。

### 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `varchar(36)` | 主键，UUID |
| `project_id` | `varchar(36)` | 关联项目，可空 |
| `user_id` | `varchar(36)` | 关联用户，可空 |
| `name` | `varchar(200)` | 任务名称 |
| `source_type` | `varchar(30)` | `pptx/pdf/image_zip/images` |
| `source_name` | `varchar(255)` | 原始文件名 |
| `source_key` | `varchar(512)` | 源文件本地 key / 对象存储 key |
| `source_url` | `text` | 源文件访问 URL |
| `page_count` | `integer` | 页数 |
| `parsed_count` | `integer` | 已完成解析页数 |
| `failed_page_count` | `integer` | 失败页数 |
| `status` | `varchar(30)` | 任务状态 |
| `progress` | `integer` | 0-100 |
| `aspect_ratio_guess` | `varchar(20)` | 识别出的比例，如 `16:9` |
| `cover_image_url` | `text` | 封面预览图 |
| `cover_image_key` | `varchar(512)` | 封面图 key |
| `warnings` | `text` | JSON 字符串数组 |
| `config` | `text` | JSON 字符串，记录解析参数 |
| `summary` | `text` | JSON 字符串，统计汇总 |
| `created_at` | `timestamp with timezone` | 创建时间 |
| `updated_at` | `timestamp with timezone` | 更新时间 |
| `completed_at` | `timestamp with timezone` | 完成时间 |
| `failed_at` | `timestamp with timezone` | 失败时间 |

### 索引建议

1. `editable_ppt_jobs_project_id_idx`
2. `editable_ppt_jobs_user_id_idx`
3. `editable_ppt_jobs_status_idx`
4. `editable_ppt_jobs_created_at_idx`

---

## 4.2 `editable_ppt_pages`

### 用途

保存单页图像、OCR、结构化解析结果。

### 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `varchar(36)` | 主键 |
| `job_id` | `varchar(36)` | 关联任务 |
| `page_number` | `integer` | 页码，从 1 开始 |
| `title` | `varchar(200)` | 页面标题 |
| `role` | `varchar(50)` | 封面页/目录页/内容页等 |
| `source_image_url` | `text` | 页面原始图 |
| `source_image_key` | `varchar(512)` | 原始图 key |
| `preview_image_url` | `text` | 标注/识别预览图 |
| `preview_image_key` | `varchar(512)` | 预览图 key |
| `width` | `integer` | 原图宽 |
| `height` | `integer` | 原图高 |
| `parse_status` | `varchar(30)` | `queued/processing/ready/failed` |
| `parse_confidence` | `integer` | 建议存 0-100 |
| `ocr_text` | `text` | OCR 原始文本 |
| `normalized_text` | `text` | 归一化文本 |
| `ast` | `text` | JSON 字符串，结构化页面结果 |
| `elements_count` | `integer` | 元素数量 |
| `manual_notes` | `text` | 人工备注 |
| `error_message` | `text` | 失败原因 |
| `created_at` | `timestamp with timezone` | 创建时间 |
| `updated_at` | `timestamp with timezone` | 更新时间 |

### 索引建议

1. `editable_ppt_pages_job_id_idx`
2. `editable_ppt_pages_job_page_idx` 组合索引 `(job_id, page_number)`
3. `editable_ppt_pages_parse_status_idx`

---

## 4.3 `editable_ppt_elements`

### 用途

保存页面级对象层，支持逐元素编辑。

### 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `varchar(36)` | 主键 |
| `job_id` | `varchar(36)` | 冗余关联任务，便于查询 |
| `page_id` | `varchar(36)` | 关联页面 |
| `element_type` | `varchar(30)` | `text/image/shape/icon/table/chart_or_complex/background` |
| `bbox_x` | `integer` | 左上角 x |
| `bbox_y` | `integer` | 左上角 y |
| `bbox_w` | `integer` | 宽 |
| `bbox_h` | `integer` | 高 |
| `z_index` | `integer` | 层级 |
| `rotation` | `integer` | 旋转角度 |
| `opacity` | `integer` | 0-100 |
| `group_id` | `varchar(36)` | 分组 ID，可空 |
| `confidence` | `integer` | 0-100 |
| `text_content` | `text` | 文本元素内容 |
| `style_json` | `text` | JSON 字符串，字体/颜色/边框等 |
| `asset_url` | `text` | 图片/图标资源地址 |
| `asset_key` | `varchar(512)` | 图片/图标资源 key |
| `hidden` | `boolean` | 是否隐藏 |
| `locked` | `boolean` | 是否锁定 |
| `source_ref` | `varchar(100)` | 来源标记，如 `ocr/layout/manual` |
| `created_at` | `timestamp with timezone` | 创建时间 |
| `updated_at` | `timestamp with timezone` | 更新时间 |

### 索引建议

1. `editable_ppt_elements_page_id_idx`
2. `editable_ppt_elements_job_id_idx`
3. `editable_ppt_elements_type_idx`
4. `editable_ppt_elements_page_z_idx` 组合索引 `(page_id, z_index)`

---

## 4.4 `editable_ppt_exports`

### 用途

记录导出任务和历史下载文件。

### 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `varchar(36)` | 主键 |
| `job_id` | `varchar(36)` | 关联任务 |
| `user_id` | `varchar(36)` | 操作用户 |
| `export_type` | `varchar(30)` | `pptx/json/debug_zip` |
| `status` | `varchar(30)` | `queued/processing/ready/failed` |
| `page_range` | `text` | JSON 数组，导出页集合 |
| `file_url` | `text` | 导出文件 URL |
| `file_key` | `varchar(512)` | 文件 key |
| `file_size` | `integer` | 文件大小，单位 byte |
| `warnings` | `text` | JSON 字符串数组 |
| `error_message` | `text` | 导出失败信息 |
| `created_at` | `timestamp with timezone` | 创建时间 |
| `updated_at` | `timestamp with timezone` | 更新时间 |
| `completed_at` | `timestamp with timezone` | 完成时间 |

### 索引建议

1. `editable_ppt_exports_job_id_idx`
2. `editable_ppt_exports_user_id_idx`
3. `editable_ppt_exports_status_idx`
4. `editable_ppt_exports_created_at_idx`

---

## 4.5 `editable_ppt_revisions`

### 用途

记录用户对页面和元素的人工修正历史，支持撤回与审计。

### 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `varchar(36)` | 主键 |
| `job_id` | `varchar(36)` | 关联任务 |
| `page_id` | `varchar(36)` | 关联页面 |
| `element_id` | `varchar(36)` | 可空，页面级修正时为空 |
| `user_id` | `varchar(36)` | 操作用户 |
| `revision_type` | `varchar(30)` | `page_update/element_update/reparse/manual_merge/manual_split` |
| `before_json` | `text` | 修改前快照 |
| `after_json` | `text` | 修改后快照 |
| `note` | `text` | 操作说明 |
| `created_at` | `timestamp with timezone` | 创建时间 |

### 索引建议

1. `editable_ppt_revisions_page_id_idx`
2. `editable_ppt_revisions_element_id_idx`
3. `editable_ppt_revisions_job_id_idx`
4. `editable_ppt_revisions_created_at_idx`

---

## 5. 推荐的数据存储策略

## 5.1 V1

V1 为了快速落地，建议：

1. `ast`
2. `style_json`
3. `warnings`
4. `config`
5. `summary`
6. `before_json`
7. `after_json`

先全部使用 `text` 存 JSON 字符串。

原因：

1. 与当前 schema 风格一致
2. 改动小
3. 便于快速集成

## 5.2 V2 / V3

如果后续对元素级查询和结构化检索要求变高，再迁移部分字段到 `jsonb`：

1. `editable_ppt_pages.ast`
2. `editable_ppt_elements.style_json`
3. `editable_ppt_jobs.summary`

---

## 6. Drizzle Schema 落地建议

当前 schema 风格主要使用：

- `pgTable`
- `varchar`
- `text`
- `timestamp`
- `boolean`
- `integer`
- `index`

因此建议新增时保持同样风格，不强制引入复杂类型。

可在：

- [src/storage/database/shared/schema.ts](/Users/congrong/Documents/AI平台/src/storage/database/shared/schema.ts)

追加以下风格的定义。

### 示例骨架

```ts
export const editablePptJobs = pgTable(
  "editable_ppt_jobs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull().default("未命名可编辑PPT任务"),
    source_type: varchar("source_type", { length: 30 }).notNull(),
    source_name: varchar("source_name", { length: 255 }).notNull(),
    source_key: varchar("source_key", { length: 512 }),
    source_url: text("source_url"),
    page_count: integer("page_count").default(0),
    parsed_count: integer("parsed_count").default(0),
    failed_page_count: integer("failed_page_count").default(0),
    status: varchar("status", { length: 30 }).default("queued"),
    progress: integer("progress").default(0),
    aspect_ratio_guess: varchar("aspect_ratio_guess", { length: 20 }),
    cover_image_url: text("cover_image_url"),
    cover_image_key: varchar("cover_image_key", { length: 512 }),
    warnings: text("warnings").default("[]"),
    config: text("config").default("{}"),
    summary: text("summary").default("{}"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    failed_at: timestamp("failed_at", { withTimezone: true }),
  },
  (table) => [
    index("editable_ppt_jobs_project_id_idx").on(table.project_id),
    index("editable_ppt_jobs_user_id_idx").on(table.user_id),
    index("editable_ppt_jobs_status_idx").on(table.status),
    index("editable_ppt_jobs_created_at_idx").on(table.created_at),
  ]
);
```

其余 4 张表按同样方式追加。

---

## 7. 业务查询建议

### 7.1 模块首页

查询：

- `editable_ppt_jobs`

排序：

- `created_at desc`

### 7.2 任务详情页左侧缩略图

查询：

- `editable_ppt_pages where job_id = ?`

排序：

- `page_number asc`

### 7.3 页面主预览区

查询：

- `editable_ppt_pages`
- `editable_ppt_elements`

条件：

- `page_id = ?`

### 7.4 导出历史

查询：

- `editable_ppt_exports where job_id = ?`

排序：

- `created_at desc`

### 7.5 修正历史

查询：

- `editable_ppt_revisions where page_id = ?`

排序：

- `created_at desc`

---

## 8. 清理策略

### 8.1 删除任务

删除顺序建议：

1. `editable_ppt_revisions`
2. `editable_ppt_elements`
3. `editable_ppt_pages`
4. `editable_ppt_exports`
5. `editable_ppt_jobs`

同时清理：

1. `source file`
2. `page source images`
3. `preview images`
4. `export files`

### 8.2 软删还是硬删

V1 建议：

1. 任务直接硬删
2. 导出记录允许保留最近一次

V2 若需要回收站，再加 `deleted_at`

---

## 9. 和本地模式的兼容建议

你的平台有明显的本地/桌面使用场景，因此建议：

1. 在线模式：走数据库
2. 本地访客模式：允许把同结构数据落本地 JSON

本地文件结构可与数据库字段保持一致：

```text
data/editable-ppt/
├── jobs/
├── pages/
├── elements/
├── exports/
└── revisions/
```

这样未来无论切到 Supabase 还是本地文件，都能复用同一数据模型。

---

## 10. 与现有模块衔接

### 10.1 与 `projects` 的关系

建议每个可编辑 PPT 任务可挂到某个现有项目下：

1. 便于统一管理
2. 便于后续推送到工作台
3. 便于云同步和项目打包

### 10.2 与 `PPT 工作台` 的关系

`editable_ppt_jobs` 不直接复用 `PPTProject` 结构。  
只在需要时做一次“推送映射”。

这样可以避免把识别型任务和风格生成型任务混在一起。

---

## 11. 结论

建议先新增 5 张表，结构保持克制：

1. `jobs`
2. `pages`
3. `elements`
4. `exports`
5. `revisions`

V1 先用 `text` 存 JSON，提高接入速度；V2/V3 再把热点字段迁移到 `jsonb`。  
这是最符合你当前项目现状的方案。

