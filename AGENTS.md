# 项目上下文

### 项目简介
环中AIStudio - AI 设计画布工具，灵感来源于 Lovart.ai 的 ChatCanvas 交互范式。用户通过对话与AI协作，在项目画布上创建和修改图像设计。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **AI 对话**: coze-coding-dev-sdk (LLM)
- **图像生成**: grsai.ai API (gpt-image-2 + nano-banana 系列)
- **对话模型**: grsai.ai /v1/chat/completions (OpenAI兼容, GPT-4o/Gemini/Claude/DeepSeek等)
- **数据库**: Supabase (PostgreSQL)
- **对象存储**: coze-coding-dev-sdk S3Storage
- **图片处理**: sharp (服务端裁剪/合成)

## 目录结构

```
├── public/                 # 静态资源
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── generate/route.ts    # AI图像生成 + 扩图(匹配支持比例+裁剪合成)
│   │   │   ├── chat/route.ts        # AI对话 (SSE流式, normal/optimize/analyze模式)
│   │   │   ├── grsai-chat/route.ts  # grsai /v1/chat/completions代理(OpenAI兼容SSE流式)
│   │   │   ├── history/route.ts     # 图像记录 CRUD + undo恢复
│   │   │   ├── history/[id]/route.ts # 单条记录操作
│   │   │   ├── upload/route.ts      # 参考图上传
│   │   │   ├── share/route.ts       # 图像分享
│   │   │   ├── projects/route.ts    # 项目列表 CRUD
│   │   │   ├── projects/[id]/route.ts # 单项目操作(重命名/置顶/删除)
│   │   │   ├── references/route.ts  # 参考图 CRUD
│   │   │   ├── prompts/route.ts     # 提示词库 CRUD
│   │   │   ├── skills/route.ts      # 自定义技能 CRUD
│   │   │   ├── image-tags/route.ts  # 图片标签 CRUD
│   │   │   ├── image-process/route.ts # 图片处理(去背/高清/分层/抠图)
│   │   │   ├── batch-download/route.ts # 批量ZIP下载
│   │   │   ├── trash/route.ts       # 回收站(恢复/永久删除)
│   │   │   ├── inspiration/folders/route.ts # 灵感文件夹 CRUD
│   │   │   ├── inspiration/items/route.ts   # 灵感素材 CRUD
│   │   │   ├── prompt-categories/route.ts # 提示词分类 CRUD
│   │   │   ├── prompt-atoms/route.ts     # 原子词 CRUD
│   │   │   ├── prompt-packages/route.ts  # 组合包 CRUD
│   │   │   ├── prompt-templates/route.ts # 业务模板 CRUD
│   │   │   ├── prompt-use-log/route.ts   # 使用日志统计
│   │   │   ├── prompt-search/route.ts    # 全网检索提示词
│   │   │   ├── prompt-test/route.ts      # 提示词测试记录 CRUD
│   │   │   └── prompt-export/route.ts    # 提示词包导出/导入
│   │   ├── layout.tsx               # 根布局
│   │   ├── page.tsx                 # 主页面 (ChatCanvas, ~3200行)
│   │   └── globals.css              # 全局样式
│   ├── components/
│   │   ├── ui/                      # Shadcn UI 组件库
│   │   ├── PPTWorkshop.tsx          # PPT AI工作台 (三栏布局+四阶段工作流)
│   │   ├── PromptManager.tsx        # 提示词资产管理平台 (全屏模式，左侧导航+5页面)
│   │   └── AgentFloatingWindow.tsx  # 龙虾Agent悬浮窗
│   ├── lib/
│   │   ├── types.ts                 # 全局类型定义 (CanvasImage, ChatMessage, VIP_PIXEL_SIZES等)
│   │   └── utils.ts                 # 通用工具函数 (cn)
│   └── storage/
│       └── database/
│           ├── shared/schema.ts     # Drizzle 数据库 Schema
│           └── supabase-client.ts   # Supabase 客户端 (service_role绕过RLS)
├── next.config.ts
├── package.json
└── tsconfig.json
```

## page.tsx 代码导航地图

主页面 `src/app/page.tsx` 约3200行，按功能分区如下。修改需求时直接定位对应区域。

### 状态声明区 (L1~L85)

| 行号范围 | 内容 | 关键变量 |
|---------|------|---------|
| L1~L36 | imports | React, types, UI组件 |
| L38~L45 | 模式状态 | `cropMode`, `expandMode` |
| L47~L85 | 核心状态 | `projects`, `currentProjectId`, `canvasImages`, `messages`, `selectedImageId(s)`, `undoHistory`, `canvasOffset`, `canvasScale`, `spaceHeld`, `isDraggingImage`, `dragOffset`, `selectionBox`, `generatingPlaceholder`, `chatInput`, `referenceImages`, `showImageLibrary`, `chatPanelWidth` |

### 辅助变量区 (L87~L108)

| 行号范围 | 内容 | 关键变量 |
|---------|------|---------|
| L87~L95 | 模型相关 | `currentModel`, `isNanoBanana`, `isVipModel` |
| L97~L108 | API配置 | `grsaiBaseUrl`, `grsaiApiKey` |

### 工具函数区 (L110~L148)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L110 | `cancelExpand()` | 取消扩图模式 |
| L115 | `cancelCrop()` | 取消裁剪模式 |
| L120 | `pushUndoHistory()` | 深拷贝canvasImages到undoHistory |
| L130 | `downloadImage()` | fetch+blob下载图片 |
| L135 | `addAsReference()` | 添加参考图URL |

### 数据加载 useEffect (L150~L250)

| 行号范围 | 功能 |
|---------|------|
| L150~L180 | 加载项目列表 + 默认选中 |
| L180~L210 | currentProjectId变化时加载images和messages |
| L210~L250 | 加载参考图 |

### 画布事件处理 (L260~L560)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L260~L320 | `handleCanvasMouseDown` | 画布点击: 框选/取消选区/取消扩图/取消裁剪 |
| L320~L400 | `handleCanvasMouseMove` | 画布拖拽: 框选/图片拖拽/Space平移 |
| L400~L440 | `handleCanvasMouseUp` | 释放: 结束拖拽/框选 |
| L440~L560 | `handleImageMouseDown` | 图片点击: 选中/Shift多选/开始拖拽 |

### 图像生成核心 (L560~L740)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L560~L680 | `generateImage(prompt, referenceImages)` | 调用/api/generate生图，轮询running状态，添加到画布 |
| L680~L740 | `processImage(action, config)` | 图片工具处理(扩图/去背/高清/分层/抠图) |

### 对话与AI (L740~L960)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L740~L860 | `handleSendMessage()` | 发送对话，SSE流式接收，解析[GENERATE:xxx]标记 |
| L860~L920 | `optimizePrompt()` | 独立提示词优化，调用/api/chat?optimize=true |
| L920~L960 | `analyzeImage()` | 反推提示词，调用/api/chat?analyze=true |

### 扩图模式 (L960~L1100)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L960~L1000 | `handleExpandMouseDown(e, handle)` | 扩图拖拽手柄事件 |
| L1000~L1040 | `handleExpandImageDragStart(e)` | 图片在扩图框内拖拽 |
| L1040~L1070 | `getExpandRatioPresets()` | 根据原始比例计算扩图预设 |
| L1070~L1100 | `applyExpandPreset(preset)` | 应用比例预设 |

### 图片工具栏 (L1200~L1350)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L1200~L1280 | `handleImageTool(img, action)` | 工具栏按钮分发: expand进入模式，其他调processImage |
| L1280~L1350 | `confirmExpand()` | 确认扩图: pushUndoHistory + 传递expandComposite给processImage |

### 图库功能 (L1210~L1300)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L1210~L1230 | `loadGallery()` | 加载图库记录 + 标签 |
| L1263~L1285 | `addImageTag/removeImageTag()` | 标签CRUD |
| L1286~L1290 | `batchDownloadGallery()` | 批量ZIP下载 |

### 键盘快捷键 (L1350~L1420)

| 行号 | 功能 |
|------|------|
| L1350~L1420 | useEffect keydown/keyup: Ctrl+Z撤回, Ctrl+D复制, Delete删除, Escape取消模式, Space平移/放大 |

### 全局鼠标事件 (L1420~L1500)

| 行号 | 功能 |
|------|------|
| L1420~L1460 | mousemove: 扩图手柄拖拽 + 图片框内拖拽 |
| L1460~L1500 | mouseup: 结束所有拖拽 + Lightbox滚轮缩放 |

### 画布辅助功能 (L1500~L1600)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L1500~L1540 | `handleUndo()` | Ctrl+Z撤回: 从undoHistory恢复 + POST /api/history重新插入 |
| L1540~L1570 | `findNonOverlappingPosition()` | 螺旋搜索不重叠位置 |
| L1570~L1600 | `autoArrangeCanvas()` | 一键整理画布(流式布局) |

### 其他功能函数 (L1600~L1800)

| 行号 | 函数名 | 功能 |
|------|--------|------|
| L1600~L1650 | `handleDrop/handleDragOver` | 拖拽上传图片 |
| L1650~L1700 | `handlePaste` | 粘贴剪贴板图片 |
| L1700~L1800 | 项目CRUD函数 | 创建/重命名/置顶/删除项目 |

### 模型与API配置UI (L1800~L1960)

| 行号范围 | 内容 |
|---------|------|
| L1800~L1900 | 模型选择器、风格预设、比例选择、VIP像素值输入 |
| L1900~L1960 | API配置展开条(Base URL + API Key) |

### 渲染区 (L1960~L6000+)

| 行号范围 | 内容 |
|---------|------|
| L1960~L2050 | 项目侧边栏(创建/列表/置顶/重命名/删除) |
| L2050~L2270 | 画布容器: transform层 + 缩放控制按钮 |
| L2270~L2470 | 图片渲染 + 悬停操作 + 选中工具栏(6个AI工具+引用/下载/删除) |
| L2470~L2600 | 扩图UI: 扩展手柄+比例预设+确认/取消+框内图片偏移 |
| L2720~L2800 | 生成占位框(generatingPlaceholder) + 框选矩形(selectionBox) |
| L2800~L2950 | 对话面板: 消息列表 + 输入框 + 参考图预览 + 优化按钮 |
| L3280~L3400 | renderGalleryCard(): Eagle风格纯缩略图+文件名/尺寸/标签 |
| L3400~L3600 | 画廊图像点击逻辑: handleGalleryImageClick(Shift/Ctrl多选) |
| L4900~L5400 | 全局图库浮层: 工具栏(视图模式+缩略图大小+筛选)+标签筛选栏+三栏布局 |
| L5400~L5550 | 图库详情面板: 预览+提示词+色彩分析+直方图+标签+参数 |
| L5550~L5750 | 灵感图库标签: 文件夹树+素材网格+上传+搜索 |
| L5750~L5900 | 参考库标签: 项目筛选+参考图网格 |
| L6000+ | Lightbox全屏查看器: 缩放/平移/导航 |

## API 接口详解

| 接口 | 方法 | 说明 | 关键参数 |
|------|------|------|---------|
| /api/generate | POST | AI图像生成+扩图 | prompt, model, aspectRatio, referenceImages, expandComposite |
| /api/chat | POST | AI对话(SSE) | message, projectId, mode(normal/optimize/analyze), referenceImageUrls |
| /api/grsai-chat | POST | grsai对话代理(SSE) | messages, model, stream, apiKey, baseUrl, temperature |
| /api/history | GET | 获取记录列表 | projectId, offset, limit, pageSize |
| /api/history | POST | 重新插入记录(undo) | 完整image_record字段 |
| /api/history | PATCH | 更新记录 | id, is_favorite, canvas_x/y/width/height |
| /api/history | DELETE | 软删除记录(设deleted_at) | id (query或body) |
| /api/trash | GET | 回收站列表 | projectId |
| /api/trash | PATCH | 恢复记录(clear deleted_at) | id |
| /api/trash | DELETE | 永久删除(含S3文件清理) | id |
| /api/upload | POST | 上传参考图 | file (FormData) |
| /api/references | GET/POST/DELETE | 参考图CRUD | projectId, image_url, image_key |
| /api/projects | GET | 项目列表 | - |
| /api/projects | POST | 创建项目 | name |
| /api/projects/[id] | PATCH | 更新项目 | name, is_pinned |
| /api/projects/[id] | DELETE | 删除项目 | - |
| /api/prompts | GET | 提示词库列表 | projectId |
| /api/prompts | POST | 保存提示词 | projectId, text, category, imageUrl |
| /api/prompts | DELETE | 删除提示词 | id |
| /api/skills | GET | 自定义技能列表 | projectId |
| /api/skills | POST | 创建技能 | projectId, name, description, steps(JSONB) |
| /api/skills | DELETE | 删除技能 | id |
| /api/image-tags | GET | 图片标签列表 | imageId(可选) |
| /api/image-tags | POST | 添加标签 | imageId, tag |
| /api/image-tags | DELETE | 删除标签 | id 或 imageId+tag |
| /api/image-process | POST | 图片处理 | id, action(remove-bg/upscale/layer/extract) |
| /api/batch-download | POST | 批量ZIP下载 | ids[], type(works/inspiration) |
| /api/inspiration/folders | GET/POST/PATCH/DELETE | 灵感文件夹CRUD | projectId, name, color, parent_id |
| /api/inspiration/items | GET/POST/DELETE | 灵感素材CRUD | folder_id, projectId |
| /api/prompt-categories | GET/POST/PATCH/DELETE | 提示词分类CRUD | name, parent_id, type, project_id |
| /api/prompt-atoms | GET/POST/PATCH/DELETE | 原子词CRUD | name, content, category_id, project_id, library_id |
| /api/prompt-packages | GET/POST/PATCH/DELETE | 组合包CRUD | name, content, atom_ids, category_id, project_id, library_id |
| /api/prompt-templates | GET/POST/PATCH/DELETE | 业务模板CRUD | name, content, category_id, model, aspect_ratio, vars, project_id, library_id |
| /api/prompt-use-log | GET/POST | 使用日志统计 | prompt_type, prompt_id, project_id |
| /api/prompt-search | POST | 全网检索提示词 | query, count |
| /api/prompt-test | GET/POST/PATCH/DELETE | 提示词测试记录CRUD | project_id, prompt, reference_image_url, score, model, aspect_ratio |
| /api/prompt-export | GET/POST | 提示词包导出/导入 | projectId, libraryId, type(导出) / projectId, libraryId, data(导入) |
| /api/prompt-libraries | GET/POST/DELETE | 提示词库CRUD(切换/新建/删除) | project_id, name, description |
| /api/prompt-versions | GET/POST/PATCH/DELETE | 版本历史管理 | library_id, version_name, snapshot |

### /api/generate 扩图逻辑

当请求包含 `expandComposite` 参数时，走扩图流程：
1. `findClosestSupportedRatio()`: 从19种模型支持比例中匹配最接近目标扩展比例
2. 用匹配的比例调用grsai API生图
3. 生成后用sharp裁剪到实际需要的比例
4. 用sharp将原图合成到裁剪结果的正确位置（原图100%还原+羽化过渡）
5. 上传合成结果到S3，更新数据库

## 数据库 Schema

### projects 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | TEXT | 项目名称 |
| is_pinned | BOOLEAN | 是否置顶 |
| sort_order | INTEGER | 排序权重 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### image_records 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID | 关联项目 |
| prompt | TEXT | 生成提示词 |
| image_url | TEXT | 图像访问 URL |
| image_key | TEXT | 原始图像存储 key |
| edited_image_key | TEXT | 编辑后的图像存储 key |
| size | TEXT | 图像尺寸/比例 |
| model | TEXT | 使用的模型 |
| status | TEXT | 状态 (pending/completed/failed) |
| is_favorite | BOOLEAN | 是否收藏 |
| reference_images | TEXT | 参考图URL(JSON数组字符串) |
| canvas_x | INTEGER | 画布X坐标 |
| canvas_y | INTEGER | 画布Y坐标 |
| canvas_width | INTEGER | 画布显示宽度 |
| canvas_height | INTEGER | 画布显示高度 |
| deleted_at | TIMESTAMPTZ | 软删除时间(NULL=未删除) |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### chat_messages 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID | 关联项目 |
| role | TEXT | 角色 (user/assistant) |
| content | TEXT | 消息内容 |
| reference_image_urls | TEXT | 引用图片URL(JSON数组字符串) |
| image_url | TEXT | 关联生成图片URL |
| created_at | TIMESTAMPTZ | 创建时间 |

### reference_images 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID | 关联项目 |
| image_url | TEXT | 图像URL |
| image_key | TEXT | S3存储key |
| file_name | TEXT | 文件名 |
| created_at | TIMESTAMPTZ | 创建时间 |

### prompt_library 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID | 关联项目(外键) |
| text | TEXT | 提示词内容 |
| category | VARCHAR(50) | 分类(默认general) |
| image_url | TEXT | 关联图片URL |
| created_at | TIMESTAMPTZ | 创建时间 |

### custom_skills 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID | 关联项目(外键) |
| name | VARCHAR(100) | 技能名称 |
| description | TEXT | 技能描述 |
| steps | JSONB | 工作流步骤数组 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### image_tags 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| image_id | TEXT | 关联图片ID |
| tag | TEXT | 标签名称 |
| created_at | TIMESTAMPTZ | 创建时间 |
| UNIQUE约束 | | (image_id, tag) |

### inspiration_folders 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID | 关联项目 |
| name | TEXT | 文件夹名称 |
| parent_id | UUID | 父文件夹ID |
| sort_order | INTEGER | 排序权重 |
| color | TEXT | 颜色标识 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### inspiration_items 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| folder_id | UUID | 关联文件夹 |
| project_id | UUID | 关联项目 |
| image_url | TEXT | 图像URL |
| image_key | TEXT | S3存储key |
| file_name | TEXT | 文件名 |
| source | TEXT | 来源 |
| dominant_color | TEXT | 主色调 |
| width | INTEGER | 宽度 |
| height | INTEGER | 高度 |
| created_at | TIMESTAMPTZ | 创建时间 |

### sys_category 表 (提示词分类)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| name | VARCHAR(64) | 分类名称 |
| parent_id | INT | 父分类ID(0=一级) |
| type | TINYINT | 1=属性分类 2=场景分类 |
| sort | INT | 排序权重 |
| status | TINYINT | 1=启用 0=禁用 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### prompt_atom 表 (原子词)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| name | VARCHAR(64) | 名称 |
| content | TEXT | 提示词内容 |
| category_id | INT | 关联属性分类 |
| use_count | INT | 使用次数 |
| is_hot | TINYINT | 是否常用 |
| source | TEXT | 来源URL |
| project_id | UUID | 关联项目 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### prompt_package 表 (组合包)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| name | VARCHAR(64) | 名称 |
| content | TEXT | 完整提示词内容 |
| atom_ids | VARCHAR(512) | 关联原子词ID(逗号分隔) |
| category_id | INT | 关联属性分类 |
| use_count | INT | 使用次数 |
| project_id | UUID | 关联项目 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### prompt_template 表 (业务模板)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| name | VARCHAR(64) | 名称 |
| content | TEXT | 提示词内容 |
| category_id | INT | 关联场景分类 |
| model | TEXT | 模型 |
| aspect_ratio | TEXT | 宽高比 |
| use_count | INT | 使用次数 |
| project_id | UUID | 关联项目 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### template_var 表 (模板变量)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| template_id | INT | 关联模板 |
| var_key | VARCHAR(64) | 变量键名 |
| var_label | VARCHAR(64) | 变量显示名 |
| var_type | VARCHAR(20) | 变量类型 |
| default_value | TEXT | 默认值 |
| sort | INT | 排序 |

### prompt_use_log 表 (使用日志)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| prompt_type | VARCHAR(20) | 类型(atom/package/template) |
| prompt_id | INT | 关联提示词ID |
| project_id | UUID | 关联项目 |
| created_at | TIMESTAMPTZ | 创建时间 |

### prompt_test_records 表 (测试记录)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| project_id | TEXT | 关联项目 |
| reference_image_url | TEXT | 参考图URL |
| prompt | TEXT | 提示词 |
| generated_image_url | TEXT | 生成图URL |
| score | INTEGER | 打分(1-5) |
| notes | TEXT | 备注 |
| model | TEXT | 模型 |
| aspect_ratio | TEXT | 宽高比 |
| created_at | TIMESTAMPTZ | 创建时间 |

### prompt_libraries 表 (提示词库)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| project_id | TEXT | 关联项目 |
| name | VARCHAR(100) | 库名称 |
| description | TEXT | 描述 |
| is_default | TINYINT | 是否默认库(1=是) |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### prompt_versions 表 (版本历史)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| library_id | INT | 关联提示词库(外键) |
| version_name | VARCHAR(100) | 版本名称 |
| snapshot | JSONB | 快照数据 |
| created_at | TIMESTAMPTZ | 创建时间 |

### CanvasImage
```typescript
interface CanvasImage {
  id: string;
  image_url: string;
  image_key: string;
  project_id: string;
  prompt: string;
  reference_images?: string;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
  size: string;
  model: string;
  status: string;
  is_favorite: boolean;
  is_reference?: boolean;
  isGenerating?: boolean;
  is_reference?: boolean;
  isGenerating?: boolean;
  created_at: string;
  updated_at: string;
  aspectRatio?: string;
}
```

### 模式状态
```typescript
// 扩图模式
type ExpandMode = {
  imageId: string;
  expandLeft: number; expandRight: number;
  expandTop: number; expandBottom: number;
  targetRatio: string;
  imageOffsetX: number; imageOffsetY: number;
} | null;

// 裁剪模式
type CropMode = {
  imageId: string;
  cropX: number; cropY: number;
  cropW: number; cropH: number;
  origW: number; origH: number;
} | null;
```

## 包管理规范

**仅允许使用 pnpm** 作为包管理器

## 构建和测试命令

- 开发: `pnpm run dev`
- 构建: `pnpm run build`
- 类型检查: `pnpm ts-check`
- Lint: `pnpm lint`

## 常见修改速查

| 需求 | 定位文件 | 定位区域 |
|------|---------|---------|
| 修改扩图交互 | page.tsx | L960~L1100 (逻辑) + L2470~L2600 (UI) |
| 修改图片工具栏 | page.tsx | L1200~L1280 (分发逻辑) + L2367~L2463 (UI渲染) |
| 修改AI对话 | page.tsx | L740~L960 (逻辑) + L2800~L2950 (UI) + /api/chat/route.ts |
| 修改画布操作 | page.tsx | L260~L560 (事件) + L2050~L2270 (画布容器) |
| 修改项目侧边栏 | page.tsx | L1600~L1800 (逻辑) + L1960~L2050 (UI) + /api/projects/ |
| 修改图库UI | page.tsx | L3280~L3400 (renderGalleryCard) + L4900~L5400 (浮层布局) |
| 修改图库标签 | page.tsx + /api/image-tags/route.ts | L1271~L1291 (逻辑) + L5282~L5302 (标签筛选栏) + L5425~L5500 (详情面板标签管理) |
| 修改Lightbox | page.tsx | L2392~L2470 (缩放/平移逻辑) + L6000+ (UI) |
| 修改图库筛选 | page.tsx | L772~L807 (filteredGalleryRecords) + L4900~L5100 (工具栏) |
| 修改灵感图库 | page.tsx + /api/inspiration/ | L5550~L5750 (UI) |
| 修改模型选择/比例 | page.tsx | L1800~L1900 (UI) + types.ts (VIP_PIXEL_SIZES) |
| 修改快捷键 | page.tsx | L1350~L1420 |
| 修改撤回逻辑 | page.tsx | L120~L130 (push) + L1500~L1540 (undo) + /api/history POST |
| 修改生图流程 | page.tsx | L560~L740 + /api/generate/route.ts |
| 修改数据库字段 | schema.ts + supabase-client.ts | 需同步修改types.ts和所有API route |
| 修改提示词库 | page.tsx + PromptManager.tsx + /api/prompt-* | 左侧导航+5页面(首页/实验室/原子词/组合包/模板)+分类面板+版本历史 |
| 修改自定义技能 | page.tsx + /api/skills/route.ts | 技能面板+工作流编辑器+执行 |
