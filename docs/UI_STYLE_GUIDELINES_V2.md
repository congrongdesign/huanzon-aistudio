# 环中AIStudio UI 规范文档（V2）

版本：v2.3  
日期：2026-05-31  
适用范围：画布、PPT 工作台、图库、资产库、消息、对话、提示词、配置弹层、Agent 浮窗

---

## 1. 统一目标

全平台以 PPT 工作台的“轻量层级 + 紫色强调 + 清晰边界”作为唯一视觉基线。浅色与深色只是同一体系的两套 token，不允许出现局部沿用另一主题配色的问题。

必须满足：

1. 所有工作区遵循同一套背景、卡片、描边、文字和交互状态规则。
2. 浅色模式不出现深色色块叠深色文字，深色模式不出现弱灰字吃底。
3. 普通选中态与主操作按钮严格区分，避免大面积紫底影响识别。
4. 浮层、弹窗和独立挂载组件必须显式接入主题，不能依赖页面父节点继承。
5. 生成中、失败、成功、警告等反馈必须用一致的语义状态呈现。

---

## 2. 最终主题 Token

实现位置：`src/app/globals.css`

### 2.1 Light

| 用途 | Token | 值 |
| --- | --- | --- |
| 页面背景 | `--background` | `#f8fafc` |
| 画布背景 | `--app-canvas-bg` | `#eef2f7` |
| 卡片背景 | `--card` | `#ffffff` |
| 主文字 | `--foreground` | `#172033` |
| 次级文字 | `--muted-foreground` | `#4f5d74` |
| 主强调色 | `--primary` | `#7c3aed` |
| 强调色前景 | `--primary-foreground` | `#ffffff` |
| 普通边框 | `--border` | `rgba(148, 163, 184, 0.30)` |
| 强调边框 | `--border-secondary` | `rgba(124, 58, 237, 0.32)` |
| 悬停背景 | `--app-hover-bg` | `rgba(124, 58, 237, 0.08)` |
| 选中背景 | `--app-selection` | `rgba(124, 58, 237, 0.15)` |

### 2.2 Dark

| 用途 | Token | 值 |
| --- | --- | --- |
| 页面背景 | `--background` | `#080d18` |
| 画布背景 | `--app-canvas-bg` | `rgba(9, 17, 31, 0.82)` |
| 卡片背景 | `--card` | `rgba(20, 29, 47, 0.72)` |
| 浮层背景 | `--popover` | `rgba(25, 36, 58, 0.90)` |
| 主文字 | `--foreground` | `#eef4ff` |
| 次级文字 | `--muted-foreground` | `#afbbcf` |
| 主强调色 | `--primary` | `#a58aff` |
| 强调色前景 | `--primary-foreground` | `#ffffff` |
| 普通边框 | `--border` | `rgba(184, 207, 244, 0.20)` |
| 强调边框 | `--border-secondary` | `rgba(165, 138, 255, 0.58)` |
| 悬停背景 | `--app-hover-bg` | `rgba(165, 138, 255, 0.17)` |
| 选中背景 | `--app-selection` | `rgba(165, 138, 255, 0.22)` |

### 2.3 语义类

新代码优先使用 Tailwind 语义类：

| 用途 | 类名 |
| --- | --- |
| 页面底色 | `bg-background text-foreground` |
| 卡片 | `bg-card text-card-foreground border-border` |
| 弱背景 | `bg-muted` |
| 次级文字 | `text-muted-foreground` |
| 表单边框 | `border-input` |
| 主操作按钮 | `bg-primary text-primary-foreground` |
| 危险操作 | `bg-destructive text-white` |

如需工作台专用层级，使用 `bg-app-canvas`、`bg-app-panel`、`bg-app-toolbar`、`text-app-primary`、`text-app-secondary`、`text-app-muted`。

---

## 3. 表面层级

工作区统一使用四层表面，不允许随意新增近似颜色：

1. `L0 页面/画布`：`bg-background` 或 `bg-app-canvas`。
2. `L1 主侧栏/主面板`：`bg-card` 或 `bg-app-sidebar`。
3. `L2 卡片/输入框/工具条`：`bg-muted`、`bg-app-input` 或 `bg-app-toolbar`。
4. `L3 弹窗/浮层`：`bg-popover` 或 `bg-app-panel`，必须有 `border-border` 和轻阴影。

规则：

1. Light 使用白卡片、浅灰画布和柔和边界。
2. Dark 使用深灰蓝分层，不使用纯黑作为普通卡片背景。
3. 弹窗遮罩可以保留 `bg-black/70`，但遮罩内表面必须接入语义 token。
4. 图片 hover 遮罩可以保留半透明黑色，确保白色操作文案可读。

### 3.1 Dark 通透层级专项规则

深色模式不能等同于“所有区域都换成黑色”。应使用深蓝灰、透明度、柔和边框和环境光建立层次：

1. 页面背景使用深蓝黑渐变，并加入弱紫色与弱蓝色径向环境光。
2. 侧栏、工具条和内容卡片使用半透明深蓝灰，不使用大面积纯黑。
3. 卡片边框使用带蓝灰色相的透明描边，避免 `white/5` 在深色背景中完全消失。
4. 浮层使用 `backdrop-filter: blur(...) saturate(...)`，但不对图片卡片滥用模糊。
5. 投影以柔和黑色外投影加极弱内高光为主，避免厚重黑边。
6. 画布点阵保持克制，只用于空间感，不与图片争夺注意力。

### 3.2 Dark 冷蓝玻璃深化规则

深色模式的通透感来自分层，不来自提高整体亮度：

1. `L0` 使用多层弱径向光：左上弱紫、右上弱蓝、底部极弱青色，不允许大面积霓虹。
2. `L1` 侧栏和主面板使用 `0.72~0.86` 透明度的深蓝灰，并保留背景透光关系。
3. `L2` 卡片和输入框增加顶部内高光，形成玻璃边缘，不使用厚重外投影。
4. `L3` 弹窗使用 `.app-modal-surface` 或 `.ppt-modal-surface`，必须有模糊、饱和度提升、细边框和柔和外投影。
5. 图库使用 `.gallery-overlay` 安静模式：允许顶部和侧栏玻璃化，但图片区保持低干扰。
6. 资产库使用 `.asset-workspace`：中央图片区保留克制冷蓝空气光，左右详情栏使用玻璃层。
7. Agent 使用 `.agent-panel`：弱文字至少映射为蓝灰中间色，禁止 `text-zinc-600` 直接压在深底上。

---

## 4. 交互状态

### 4.1 普通选中态

导航、筛选、tab、文件夹、比例、模型、图库过滤器统一使用：

```tsx
bg-primary/15 text-primary ring-1 ring-primary/20
```

说明：

1. 这是普通选择状态，不使用实心紫底。
2. 文字保持紫色，浅色与深色都清晰可见。
3. 如空间过窄可省略 `ring-1 ring-primary/20`，但必须保留 `bg-primary/15 text-primary`。

### 4.2 主操作按钮

提交、确认、生成、导出等关键动作统一使用：

```tsx
bg-primary text-primary-foreground
```

说明：

1. 主按钮使用实心紫底与白字。
2. 普通选中态禁止误用此样式。
3. 按钮内的次级文案也必须保持白色高对比。

### 4.3 其他状态

| 状态 | 色系 | 示例 |
| --- | --- | --- |
| `hover` | 紫色弱背景 | `hover:bg-muted` 或 `hover:bg-primary/10` |
| `disabled` | 降低透明度 | `disabled:opacity-40` |
| `pending` | 蓝色 | 蓝色弱背景 + 蓝色文字 |
| `generating` | 紫色 | 紫色弱背景 + 动画 |
| `approved` | 绿色 | 绿色弱背景 + 绿色文字 |
| `failed` | 红色 | 红色弱背景 + 红色文字 + 错误图标 |
| `text_mismatch` | 琥珀色 | 琥珀色弱背景 + 校验说明 |

状态不能只依赖颜色，至少同时提供图标、文案、描边或背景中的一种辅助信息。

### 4.4 深色交互反馈

1. 普通 hover 使用 `150ms`，只调整背景、描边、文字或轻微阴影。
2. 键盘焦点必须显示 `focus-visible` 双像素强调描边。
3. 禁止为了视觉效果大面积缩放普通按钮，避免工作区抖动。
4. 系统开启 `prefers-reduced-motion` 时，动画和过渡自动缩短。

---

## 5. 文字与可读性

1. 普通正文对比度目标为 WCAG AA，建议至少 `4.5:1`。
2. `10px` 和 `11px` 小字只允许使用主文字或次级文字，不允许弱灰叠弱背景。
3. Light 禁止“白字 + 浅背景”和“深色块 + 深字”。
4. Dark 禁止 `zinc-600` 直接叠深底；兼容旧组件时必须提升为 `#8c96aa` 或更高对比。
5. 输入框 placeholder 可以弱化，但必须比边框更清晰。
6. 品牌强调、状态色和图片遮罩上的白字属于允许例外。

---

## 6. 组件落地要求

### 6.1 主应用

根节点必须保留 `.app-shell`，保证画布、图库、资产库、消息、对话和配置弹窗共享统一背景与表单规则。

### 6.2 PPT 工作台

PPT 工作台历史代码存在固定深色类名。当前通过 `.ppt-workshop` 限定 bridge 映射到统一主题，避免全站污染。

后续新代码要求：

1. 优先直接使用语义类，不继续新增 `bg-[#...]`、`text-zinc-*`、`border-white/*`。
2. 工作台导航选中态使用 `.ppt-nav-selected` 与 `.ppt-nav-selected-icon`。
3. NAS 选图和原稿对比弹窗使用 `.ppt-modal-surface`，因为弹窗根节点可能挂载在工作台容器外。

### 6.3 提示词面板

提示词快捷选择器使用 `.prompt-quick-picker`，内部只使用 `bg-card`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border`。

### 6.4 Agent 浮窗

Agent 面板使用 `.agent-panel`，配置区使用 `.agent-config-panel`，输入区使用 `.agent-input-shell`。浮窗需要独立主题变量，避免浅色模式仍显示永久暗色面板。

### 6.5 失败反馈

画布生图失败必须显示失败占位卡，不允许把错误信息作为多段聊天文字反复堆叠。失败卡应提供：

1. 失败标题。
2. 精简原因。
3. 重试入口。

---

## 7. 明确例外

以下区域允许保留品牌暗色或黑色，不作为主题残留：

1. 登录欢迎页：沉浸式品牌入口。
2. 登录认证弹窗：与登录欢迎页绑定的暗色玻璃风格。
3. 图片 Lightbox：全屏看图需要黑色背景。
4. 图片缩略图 hover 遮罩：确保操作文字在复杂图片上可读。
5. 弹窗 Overlay：用于压暗背景，不是内容表面。
6. Agent 圆形浮动入口：品牌强调入口，可以保留暗色渐变。

---

## 8. 开发约束

1. 禁止在普通面板新增硬编码十六进制色值。
2. 禁止在普通面板新增固定 `bg-zinc-*`、`text-zinc-*`、`border-zinc-*`。
3. 状态色、品牌色、图表色和 Canvas 绘制色可保留硬编码。
4. 禁止新增全局 `* { color: ... !important }` 覆盖。
5. 如需兼容旧组件，bridge 必须限定到 `.ppt-workshop`、`.ppt-modal-surface` 或 `.agent-panel` 等具体容器。
6. 独立挂载的 modal、portal、popover 必须单独测试 Light 与 Dark。

---

## 9. 全站 QA 清单

每次涉及 UI 的改动至少执行：

1. 切换 Light，检查画布、导航、聊天、提示词快捷面板、图库、资产库、配置弹窗、PPT 工作台、Agent 浮窗。
2. 切换 Dark，重复检查上述区域。
3. 抽查所有 `10px`、`11px` 小字是否可读。
4. 抽查普通选中态是否为淡紫底紫字，而不是白字或实心紫底。
5. 抽查主操作按钮是否为实心紫底白字。
6. 抽查 modal、portal 和 popover 是否正确跟随主题。
7. 抽查失败卡、toast、加载中、成功和警告状态。
8. 运行 `pnpm ts-check`。
9. 运行 `pnpm lint:build`，区分本轮新增问题与历史 lint 基线。

---

## 10. 本轮已完成统一范围

1. 全站 Light/Dark token 与工作台专用 token。
2. 主应用 `.app-shell`。
3. 左侧主导航、图库 tab、筛选、API 节点和资产过滤器选中态。
4. PPT 工作台浅色 bridge、深色弱文字提升、独立弹窗 bridge。
5. 提示词快捷选择器语义 token 改造。
6. Agent 浮窗浅色/深色表面、边框、文字、输入框和附件块映射。
7. 画布失败占位卡与重试入口。
8. Dark 通透层级专项升级：深蓝黑环境光、半透明卡片、增强边框、统一输入框、PPT 深色 bridge、Agent 柔和阴影、焦点态和 reduced-motion。
9. Dark 冷蓝玻璃深化：增强层间透光、顶部内高光、输入框反射、图库安静玻璃层、资产库空气光、配置弹窗专用表面和 Agent 弱文字可读性。
