# Image2.0 / GPT Image 2 开源设计工具调研报告

日期：2026-06-01  
调研范围：GitHub 公开仓库与相关项目页面，关键词包括 `gpt-image-2`、`GPT Image 2`、`image canvas`、`AI design workbench`、`PPT skill`、`agent design tool`、`prompt library`。  
目标：筛选可借鉴到环中AIStudio 的开源设计工具代码与产品机制，重点关注本地化、画布、批量生成、Agent、PPT、资产库和团队内部工作流。

## 1. 总结结论

GitHub 上针对 GPT Image 2 / Image2.0 的开源项目可以分成 6 类：

| 类型 | 代表项目 | 对环中AIStudio 的价值 |
| --- | --- | --- |
| 本地 AI 画布 | `mrslimslim/gpt-image-canvas`、`Paker-kk/Flovart` | 可借鉴无限画布、图片节点、参考图继续生成、Agent 操作画布 |
| 轻量生图工作台 | `KDB-Wind/gpt-image-2-studio`、`lidge-jun/ima2-gen` | 可借鉴本地配置、批量队列、重试、历史记录、单文件工具体验 |
| 商品/内容工作流 | `yuqie6/ProductFlow`、`Jamailar/RedBox` | 可借鉴项目素材包、知识库、媒体库、工作流节点、任务恢复 |
| Agent/MCP 工具层 | `jau123/MeiGen-AI-Design-MCP`、`wuyoscar/GPT-Image2-Skill` | 可借鉴 Agent 工具调用协议、Prompt 增强、并行生成、模型抽象 |
| PPT 生成 Skill | `JuneYaooo/gpt-image2-ppt-skills`、`ningzimu/codex-ppt-skill` | 可借鉴 PPT 风格包、模板克隆、整页图片版 PPT 导出 |
| Prompt / 案例库 | `EvoLinkAI/awesome-gpt-image-2-API-and-Prompts`、`freestylefly/awesome-gpt-image-2`、`YouMind-OpenLab/awesome-gpt-image-2` | 可作为案例中心、风格库、提示词结构化模板的数据来源 |

最值得优先借鉴的不是单个项目，而是组合：

1. `gpt-image-canvas`：本地优先、tldraw 画布、SQLite、Agent planning，和当前画布形态最接近。
2. `ProductFlow`：任务队列、失败重试、运行状态、商品/参考图/结果画廊链路完整。
3. `Flovart`：Lovart 类无限画布和 Agent/CLI 操作画布的交互方向接近你的目标。
4. `MeiGen AI Design MCP`：适合做“本地 Agent 能力层”，让 Codex 类 Agent 调用平台工具完成设计任务。
5. `gpt-image2-ppt-skills`：和当前 PPT 工作台升级方向高度相关。
6. `awesome-gpt-image-2` 系列：适合导入案例中心和风格包，不建议只做成普通提示词列表。

## 2. 推荐优先级

| 优先级 | 仓库 | 开源许可 | 推荐原因 | 主要风险 |
| --- | --- | --- | --- | --- |
| A | https://github.com/mrslimslim/gpt-image-canvas | MIT | 本地 AI 画布，结合 tldraw、Hono、SQLite、GPT Image 2；支持参考图、历史、本地资产、Agent planning | 需要拆解后融入现有画布，不能直接替换 |
| A | https://github.com/yuqie6/ProductFlow | MIT | 商品素材工作台，包含节点画布、参考图、AI 文案、生图节点、任务状态、失败重试、画廊 | 后端较重，直接引入 PostgreSQL/Redis 会复杂 |
| A | https://github.com/jau123/MeiGen-AI-Design-MCP | MIT | MCP/Agent 工具层，支持 GPT Image 2、NanoBanana、ComfyUI、Prompt 库、并行任务 | 偏工具协议，不是完整 UI |
| A | https://github.com/JuneYaooo/gpt-image2-ppt-skills | Apache-2.0 | PPT 专项，支持 gpt-image-2、风格库、模板克隆、PPTX 输出 | Skill 形态，需要产品化成工作台流程 |
| B | https://github.com/Paker-kk/Flovart | AGPL-3.0 | Lovart 类无限画布，支持 Claude Code / Codex 等 Agent 通过 CLI 操作画布 | AGPL 许可，不建议复制代码，只借鉴交互和架构 |
| B | https://github.com/KDB-Wind/gpt-image-2-studio | MIT | 轻量 GPT Image 2 工具，支持批量调用、AI 拆分提示词、队列、重试、图生图、本地历史 | 功能偏单点工具，设计协同能力弱 |
| B | https://github.com/Jamailar/RedBox | 需谨慎确认 | 小红书/内容创作桌面工作台，包含知识采集、媒体库、主体库、Agent 连续执行 | 许可和业务边界要谨慎，只建议借鉴产品流程 |
| B | https://github.com/freestylefly/awesome-gpt-image-2 | MIT | Prompt-as-Code，案例逆向、工业模板、技能化结构适合做风格库 | 内容来源需保留署名和许可说明 |
| B | https://github.com/YouMind-OpenLab/awesome-gpt-image-2 | 查看仓库许可 | 大规模 GPT Image 2 prompt + 预览图 + 多语言 | 更偏案例库，不是工作台代码 |
| B | https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts | CC0-1.0 | API 与 prompt 案例量大，适合补充案例中心 | 质量需要二次筛选 |
| C | https://github.com/lidge-jun/ima2-gen | 需确认 | CLI + Web UI，支持 API Key / OAuth、并行生成、自定义尺寸 | 偏开发者工具，产品 UI 可借鉴有限 |
| C | https://github.com/wuyoscar/GPT-Image2-Skill | 需确认 | GPT Image 2 prompt gallery、image prompt library、agentic skill、CLI | 更偏 Skill/CLI，适合作为能力层参考 |
| C | https://github.com/ningzimu/codex-ppt-skill | 需确认 | Codex PPT Skill，生成图片式 PPT | 和 `gpt-image2-ppt-skills` 类似，可作为第二参考 |

## 3. 重点仓库分析

### 3.1 `mrslimslim/gpt-image-canvas`

地址：https://github.com/mrslimslim/gpt-image-canvas  
定位：本地优先的专业 AI 图片画布。  
技术：tldraw、Hono、SQLite、GPT Image 2。

核心能力：

1. 在 tldraw 画布上创建和整理 AI 图片。
2. 支持文本生图，也支持把画布中选中的图片作为参考图继续生成。
3. 本地保存项目状态、生成历史和图片资产。
4. 支持 `.env`、应用内设置或 Codex 登录来配置图像供应商。
5. Agent tab 可以围绕计划节点执行 DAG 式多图生成任务。
6. 可选备份到腾讯云 COS 或 Cloudflare R2 / S3 兼容存储。

适合借鉴到环中AIStudio：

1. 把“图片只是画布元素”升级为“图片 + prompt + 参考图 + 生成任务 + 派生关系”的本地项目资产。
2. 给每次生成保存来源链路：从哪张图、哪个提示词、哪个模型、哪个任务节点生成。
3. Agent 模式不要只对话，要能生成计划，并把计划转换为可执行的画布任务。
4. 当前平台已经有画布，不建议换成 tldraw；可以借鉴其数据结构和 Agent planning。

### 3.2 `yuqie6/ProductFlow`

地址：https://github.com/yuqie6/ProductFlow  
定位：面向单人或小团队商家的开源自托管商品素材工作台。  
技术：FastAPI、PostgreSQL、Redis、Dramatiq worker、React、Vite、Tailwind CSS。

核心能力：

1. 商品资料、参考图、文案节点、生图节点组成节点画布。
2. 生图结果会写入下游参考图节点，同时进入图库。
3. 图片会话支持参考图上传、历史基图、连续生成、多候选对比。
4. 任务状态包含排队位置、候选进度、失败原因、取消、重试。
5. API/worker 启动时可以恢复未完成任务。
6. 设置页支持 provider、模型、图片尺寸、并发、上传限制、提示词模板等运行时配置。

适合借鉴到环中AIStudio：

1. 工作台批量生成要做成“任务队列”，而不是点按钮后靠前端等待。
2. PPT 批量美化、批量生图、资产分析都应有状态、失败重试、恢复机制。
3. 资产库可以升级成“项目素材包”：原稿、参考图、文案、生成图、选中方案统一管理。
4. 不建议直接引入 PostgreSQL + Redis；当前本地版可以先用 SQLite / 文件队列做轻量实现。

### 3.3 `Paker-kk/Flovart`

地址：https://github.com/Paker-kk/Flovart  
定位：开源 Lovart 类无限画布，重点是 Agent / CLI 控制画布。  
技术：React 19、TypeScript、Vite、Tauri、Docker。  
许可：AGPL-3.0。

核心能力：

1. 无限画布 + 自带 Key + 多模型接入。
2. 支持 Claude Code、Codex、Cursor、Windsurf 等外部 Agent 通过 CLI 操作画布。
3. CLI 能执行 `canvas.inspect` 等命令，Agent 不需要直接点 UI。
4. 规划中包含可视化 Agent 工作流、多页面/画板、实时协作等。

适合借鉴到环中AIStudio：

1. 右侧对话框需要明确切换“对话模式 / Agent 模式”。
2. Agent 模式下，本地 Codex 这类工具不是帮你改按钮，而是调用平台命令完成设计任务。
3. 平台应提供确定性命令接口，例如：
   - `canvas.inspect`：读取当前画布信息。
   - `asset.search`：搜索本地/NAS/飞书资产。
   - `canvas.addImage`：把图片放到画布。
   - `generation.create`：按 prompt 和参考图生成图片。
   - `ppt.startBatch`：启动 PPT 批量美化任务。
4. 因 AGPL 风险，不建议复制代码，只借鉴交互和协议思想。

### 3.4 `jau123/MeiGen-AI-Design-MCP`

地址：https://github.com/jau123/MeiGen-AI-Design-MCP  
定位：让 Claude Code、Cursor、Codex 等 AI 编码工具变成设计助理的 MCP server。  
许可：MIT。

核心能力：

1. 支持 GPT Image 2、NanoBanana、Seedream、Midjourney、Flux、ComfyUI 等多后端。
2. 内置 1400+ prompt library。
3. 支持并行子 Agent 生成多个方向。
4. 提供 prompt 搜索、prompt 增强、图像生成、参考图处理等工具。
5. 可作为独立 CLI 或 MCP-compatible host 使用。

适合借鉴到环中AIStudio：

1. 把平台内部能力抽象成工具，给本地 Agent 调用。
2. PPT 风格确认阶段可以并行生成多个风格方案，每个方案独立参考图和独立 prompt。
3. 图像生成可以支持最大并发和批量任务，避免一页一页串行等待。
4. 模型设置页应显示每个模型支持什么能力：文字对话、图生图、多参考图、视频、本地 ComfyUI、高清、局部编辑等。

### 3.5 `JuneYaooo/gpt-image2-ppt-skills`

地址：https://github.com/JuneYaooo/gpt-image2-ppt-skills  
定位：用 OpenAI `gpt-image-2` 一键生成视觉强的 PPT，支持模板克隆。  
许可：Apache-2.0。

核心能力：

1. 内置 10 套风格，每套细分 cover / content / data 构图。
2. 支持丢入 `.pptx` 或图片，自动渲染、抽取风格、按 JSON Schema 复刻版式。
3. 支持 md-first 编排流程。
4. 支持生成 16:9 高清图片、HTML viewer 和 `.pptx`。
5. 可在 Claude Code / Codex / OpenClaw skill 中运行。

适合借鉴到环中AIStudio：

1. PPT 工作台需要“风格包”而不是固定预设。
2. 每个风格方案单独绑定：参考图、风格说明、封面样张、内页样张、禁止事项。
3. 风格确认通过后，自动美化阶段不应重新生成已确认的封面和内页。
4. 第一版 PPT 导出可以继续走高清整页图片版，后续再考虑可编辑元素版。

### 3.6 `KDB-Wind/gpt-image-2-studio`

地址：https://github.com/KDB-Wind/gpt-image-2-studio  
定位：轻量 GPT-Image-2 生图工具台。  
许可：MIT。

核心能力：

1. 打开网页后填写 API Key、Base URL、文字模型名、图片模型名即可用。
2. 支持单图、图生图和批量生图。
3. 支持 AI 拆分提示词、队列、重试。
4. 不提供后端服务，不托管密钥，浏览器直接请求模型服务。
5. 支持本地单文件 HTML 使用。
6. 历史记录保存在当前浏览器本地。

适合借鉴到环中AIStudio：

1. 模型配置页可以更傻瓜：Base URL、Key、模型名、测试连接、保存。
2. 批量生成需要明确队列、重试和超时提示。
3. 本地版可以提供“无服务器单机模式”的最低可用链路。
4. 需要注意 CORS：浏览器直连模型供应商可能失败，Electron/Next API 代理会更稳定。

### 3.7 `Jamailar/RedBox`

地址：https://github.com/Jamailar/RedBox  
定位：面向小红书创作者和内容团队的本地化 AI 创作工作台。  
许可：需要谨慎确认。

核心能力：

1. 浏览器插件采集小红书、YouTube、网页、图片和选中文字。
2. 本地知识库管理采集内容、文档和素材。
3. 漫步选题、稿件工作台、主体库、媒体库、封面工作台。
4. RedClaw 支持单轮对话、技能调用、定时任务、长周期任务和后台 Runner。
5. 支持 GPT-image-2 做图片内容编排和批量套图。
6. 新版本增强商品详情页、多国家、多语言商品素材工作区。

适合借鉴到环中AIStudio：

1. 资产库不只是放图片，应包含主体库、品牌库、项目知识库、媒体库。
2. 适合做“设计项目资料入口”：客户资料、品牌规范、参考图、历史输出、PPT 原稿统一管理。
3. Agent 可以围绕某个项目连续执行：查资料、拆任务、生成图、整理画布、给出审核清单。
4. 不建议直接复制代码，只借鉴内容生产链路。

### 3.8 Prompt / 案例库项目

代表仓库：

1. https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts
2. https://github.com/freestylefly/awesome-gpt-image-2
3. https://github.com/YouMind-OpenLab/awesome-gpt-image-2
4. https://github.com/wuyoscar/GPT-Image2-Skill

核心能力：

1. 收集大量 GPT Image 2 prompt 与预览图。
2. 支持按场景、风格、类别检索。
3. 将 prompt 拆成主体、场景、构图、光线、材质、文字、限制条件。
4. 有些项目已经把 prompt 做成 Codex / Claude Code Skill。

适合借鉴到环中AIStudio：

1. 新增“案例中心”：可搜索、收藏、复制、套用、加入风格包。
2. 提示词库不要只存一段文字，要结构化保存：使用场景、比例、模型、参考图、正向 prompt、负向约束、示例图、来源。
3. PPT 工作台风格确认阶段可以直接从案例中心选择参考风格。
4. 导入第三方 prompt/图片时要保留来源和授权说明，避免商业使用风险。

## 4. 对环中AIStudio 的功能落地建议

### 4.1 第一阶段：案例中心 + 风格包

目标：先把 GPT Image 2 的优秀案例变成可用资产。

要做：

1. 新增“案例中心”页面或弹窗。
2. 支持导入 prompt 案例：标题、分类、场景、风格、比例、示例图、prompt、来源链接、许可证。
3. 支持收藏、搜索、筛选、复制 prompt、加入当前项目。
4. 新增“风格包”：封面样张、内页样张、参考图、风格说明、prompt 模板、禁用项。
5. PPT 工作台每个风格方案都能绑定独立风格包。

优先借鉴：`freestylefly/awesome-gpt-image-2`、`YouMind-OpenLab/awesome-gpt-image-2`、`EvoLinkAI/awesome-gpt-image-2-API-and-Prompts`、`gpt-image2-ppt-skills`。

### 4.2 第二阶段：生成链路和任务队列

目标：解决“生成失败只是一堆文字”“生成完不及时显示”“刷新后任务丢失”的问题。

要做：

1. 每次生成创建任务记录，包含状态：queued / running / completed / failed / canceled。
2. 失败原因分类：API 配置、网络超时、模型错误、图片参考失效、内容审核、未知错误。
3. 支持重试、取消、恢复。
4. 每张生成图记录来源链路：参考图、prompt、模型、参数、任务 ID、派生关系。
5. PPT 批量美化进入任务队列，显示总进度、当前页、已完成数量、失败数量、预计剩余时间。

优先借鉴：`ProductFlow`、`gpt-image-canvas`、`gpt-image-2-studio`。

### 4.3 第三阶段：Agent 工具调用

目标：让本地 Codex 这类 Agent 真正帮你操作平台完成设计任务。

要做：

1. 在右侧对话框增加“对话模式 / Agent 模式”切换。
2. Agent 模式接入内部工具协议，不直接操作 DOM。
3. 提供安全可控的平台命令：
   - `canvas.inspect`
   - `canvas.addImage`
   - `canvas.arrange`
   - `asset.search`
   - `asset.import`
   - `generation.create`
   - `generation.retry`
   - `ppt.createProject`
   - `ppt.generateStyleProposal`
   - `ppt.startBatchEnhance`
4. Agent 执行前生成任务计划，执行中显示步骤，执行后写入项目日志。
5. 允许 Agent 访问本地/NAS/飞书资产，但敏感配置只走平台保存的连接，不把 key 暴露给对话内容。

优先借鉴：`Flovart`、`MeiGen-AI-Design-MCP`、`gpt-image-canvas`、`RedBox`。

### 4.4 第四阶段：PPT 工作台增强

目标：把 PPT 工作台从“按钮式生成”升级为“风格确认 + 自动批量美化 + 审核导出”的完整流程。

要做：

1. 上传 PPTX 或图片包后自动拆页。
2. 风格确认阶段支持多个方案，每个方案独立参考图和独立风格说明。
3. 每个方案生成封面 + 内页样张，审核通过后才批量执行。
4. 已确认的封面和内页不再重复生成。
5. 自动美化阶段支持分批，例如先 10 页，再继续后续页。
6. 每页支持单独补充提示词，并能看到原稿预览。
7. 每页生成 4 个方案，失败自动重试。
8. 审核完成后一键导出图片包和高清整页图片版 PPTX。

优先借鉴：`gpt-image2-ppt-skills`、`codex-ppt-skill`、`ProductFlow`。

### 4.5 第五阶段：资产库升级

目标：把图库、NAS、飞书、本地文件夹变成真正可用的设计资产中心。

要做：

1. 资产库支持本地文件夹、NAS、飞书知识库三类来源。
2. 文件夹树按真实结构展开，点击哪个文件夹就实时加载哪个文件夹。
3. 已加载目录做缓存，下次进入先显示缓存，再后台刷新。
4. 支持路径历史记录、删除历史、快速切换路径。
5. 支持主体库、品牌库、参考库、输出库。
6. 图片预览支持自适应、瀑布流、网格、空格预览、Ctrl + 滚轮缩放。
7. 导入画布使用原图高清地址，不使用缩略图。

优先借鉴：`RedBox`、`ProductFlow`、`gpt-image-canvas`。

## 5. 对当前平台的具体改造路线

### 近期最值得做的 8 个功能

1. 案例中心：导入 GPT Image 2 优秀案例，支持搜索、收藏、复制、套用。
2. 风格包：让 PPT 风格方案可以保存、复用、绑定参考图和 prompt。
3. 生成任务队列：所有生成都进入任务表，支持失败重试和恢复。
4. 生成链路：每张图都能看到来源 prompt、参考图和派生图。
5. Agent 工具接口：让 Codex 类 Agent 调用平台工具，而不是只聊天。
6. 模型能力配置：每个模型标注支持文本、图生图、多参考图、批量、视频、高清等。
7. 资产库项目化：把 NAS、本地、飞书资产按项目素材包组织。
8. PPT 批量美化任务化：支持阶段生成、进度、剩余时间、失败重试和审核。

### 不建议现在做的事

1. 不建议直接把别人的整套画布框架替换进来，当前平台已有画布基础。
2. 不建议马上引入 Redis/PostgreSQL/多服务，先把本地 SQLite/文件队列跑稳定。
3. 不建议复制 AGPL 项目代码，避免许可证污染。
4. 不建议把第三方 prompt 案例无来源导入，后续商业使用会有风险。
5. 不建议先做插件市场，当前平台更适合团队内部使用。

## 6. 许可证与代码使用建议

1. MIT / Apache-2.0 项目可作为代码参考，但仍建议按当前架构重写，不直接粘贴大段代码。
2. AGPL-3.0 项目（例如 Flovart）只借鉴产品交互和架构，不复制代码。
3. RedBox 这类偏业务闭环的项目，需要先确认许可证，建议只借鉴流程。
4. Prompt 库内容导入时要保留：来源仓库、作者、原始链接、许可证、是否可商用说明。
5. 当前平台如果未来要对外商业发布，第三方代码和 prompt 内容要单独做版权清单。

## 7. 最推荐的学习顺序

1. 先看 `mrslimslim/gpt-image-canvas`：理解本地画布 + SQLite + Agent planning。
2. 再看 `ProductFlow`：理解任务队列、失败重试、工作流节点和图库链路。
3. 再看 `gpt-image2-ppt-skills`：理解 PPT 风格包、模板克隆和图片版 PPT 导出。
4. 再看 `MeiGen-AI-Design-MCP`：理解 Agent 工具抽象和并行生成。
5. 再看 `Flovart`：理解 Lovart 类交互和 Agent/CLI 控制画布。
6. 最后看 prompt 库：整理成自己的案例中心和风格库。

## 8. 最终建议

环中AIStudio 应该走“本地设计资产工作台 + Agent 工具调用 + GPT Image 2 批量生产”的路线，而不是单纯做一个生图网页。

最优落地组合：

1. 画布交互参考 `gpt-image-canvas` 和 `Flovart`。
2. 任务队列和项目素材链路参考 `ProductFlow`。
3. PPT 生产流程参考 `gpt-image2-ppt-skills`。
4. Agent 能力层参考 `MeiGen-AI-Design-MCP`。
5. 内容资产和知识库流程参考 `RedBox`。
6. 案例和风格库参考 `awesome-gpt-image-2` 系列。

建议下一个开发动作：先做“案例中心 + 风格包 + 生成任务队列”。这三项对当前工作台提升最大，而且风险最低；做完后再接 Agent 工具调用和 PPT 自动化批量任务。
