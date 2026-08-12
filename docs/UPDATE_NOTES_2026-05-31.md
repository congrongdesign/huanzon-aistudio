# 更新说明（2026-05-31）

## 本次版本重点

1. PPT 工作台 V2 已重构：
- 风格方案支持独立参考图与独立附加提示词
- 选定风格后自动锁定并继承到批量阶段
- 自动美化默认跳过封面/内页样张页
- 支持每页单独提示词 + 原稿预览
- 支持并发批量（最大16）+ 实时进度 + 预计剩余时间
- 审核支持单页重生与单方案重生

2. 画布失败反馈优化：
- 生图失败不再在聊天区堆叠错误文本
- 统一使用画布失败占位卡 + 状态反馈

3. 全站 UI 统一增强：
- 建立 Light/Dark 全站语义 token，统一背景、卡片、边框、文字、输入框与浮层层级
- 主导航、图库 tab、资产筛选、API 节点等普通选中态统一为淡紫底紫字
- 主操作按钮保持实心紫底白字，和普通选中态严格区分
- 提示词快捷选择器移除固定深色样式，完整支持双主题
- Agent 浮窗接入双主题表面、边框、文字、输入框和附件块映射
- PPT 工作台补齐浅色桥接、深色弱文字增强、NAS 选图弹窗和原稿对比弹窗主题映射
- 提升浅色模式下提示条、状态条与小字的识别度

4. 工程检查增强：
- ESLint 忽略桌面安装包、LibreOffice 工具、历史输出和 Playwright 产物目录
- 清理 3 条无行为影响的 `prefer-const` 问题

5. 深色模式专项优化：
- 深色底色由扁平黑色调整为带弱紫色与弱蓝色环境光的深蓝黑渐变
- 侧栏、卡片、工具条和浮层统一改为半透明深蓝灰层级
- 普通边框提高可见性，保持柔和但不再出现区域粘连
- 输入框、悬停、键盘焦点、按钮反馈统一规范
- PPT 工作台历史固定暗色样式接入深色 bridge
- Agent 浮窗减少厚重黑色阴影，增加柔和描边与内高光
- 增加 `prefers-reduced-motion` 支持

6. 图库安静模式：
- 图库改为独立不透明工作区，避免底层画布图片穿透干扰浏览
- 工具栏、筛选侧栏、图片区和详情栏使用更稳定的分层底色
- 缩略图提示词、尺寸、标签和色调圆点默认弱化，悬停时再增强
- 热力图降低视觉权重，模型筛选选中态统一为淡紫底紫字

7. 深色冷蓝玻璃深化：
- 全站暗色背景增加弱紫、弱蓝和极弱青色环境光，空间层次更通透
- 侧栏、卡片、输入框和工具栏增加顶部内高光与细蓝灰描边
- 图库保留安静模式，但顶部、侧栏和标签栏改为克制玻璃层
- 资产库中央图片区增加弱冷蓝空气光，左右栏改为玻璃分层
- API 配置弹窗增加独立 `.app-modal-surface`，强化模糊、边缘高光和柔和投影
- PPT 工作台固定暗色块映射为统一冷蓝玻璃表面
- Agent 面板提升反射层级，并修复深色下弱灰提示文字识别度不足

8. PPT 工作台禁用按钮可读性：
- 风格生成、自动美化、导出、确认风格、重生成本页、单方案重生和最终选择按钮统一调整
- 禁用状态透明度由 `0.4` 提升到 `0.6`，保留不可点击区别，同时避免白字发灰看不清
- 紫蓝渐变主操作按钮继续保持白色高对比文字

---

## 主要变更文件

1. 工作台重构：
- `/Users/congrong/Documents/AI平台/src/components/PPTWorkshop.tsx`

2. 失败反馈与提示条优化：
- `/Users/congrong/Documents/AI平台/src/app/page.tsx`

3. 全局主题桥接与可读性提升：
- `/Users/congrong/Documents/AI平台/src/app/globals.css`

4. 提示词与 Agent 双主题适配：
- `/Users/congrong/Documents/AI平台/src/components/PromptManager.tsx`
- 旧 `AgentFloatingWindow` 已移除，右侧对话框改为平台设计 Agent 模式

5. 工程检查配置：
- `/Users/congrong/Documents/AI平台/eslint.config.mjs`

6. 文档：
- `/Users/congrong/Documents/AI平台/docs/PPT_WORKSHOP_V2_REQUIREMENTS.md`
- `/Users/congrong/Documents/AI平台/docs/PPT_WORKSHOP_V2_IMPLEMENTATION_PLAN.md`
- `/Users/congrong/Documents/AI平台/docs/UI_STYLE_GUIDELINES_V2.md`
- `/Users/congrong/Documents/AI平台/docs/PLATFORM_ENHANCEMENT_PLAN_V2.md`
- `/Users/congrong/Documents/AI平台/docs/UPDATE_NOTES_2026-05-31.md`

---

## 使用提示

1. 若你之前打开着旧页面，先强制刷新（Cmd/Ctrl + Shift + R）。
2. 建议先用 10 页范围验证风格，再扩到 40~60 页批量。
3. 并发建议先用 8，网络稳定再上调到 12~16。
4. 若某页总失败，可在该页附加提示词中明确布局要求再重生。


## 右侧设计 Agent 更新

- 移除旧龙虾 Agent 悬浮窗和旧 `/api/agent` 接口。
- 右侧对话框新增 `对话模式 / Agent模式` 切换。
- Agent 模式调用平台对话和生图能力，可拆解设计任务、引用参考图并把生成结果放到画布。
- 顶部 `Agent模式` 快捷按钮现在只负责打开右侧对话框并切换到 Agent 模式。
