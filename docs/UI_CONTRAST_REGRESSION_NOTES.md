# UI 对比度问题复盘与防复发规则

日期：2026-06-01  
范围：PPT 工作台，以及后续所有新增浅色/深色 UI

## 本次问题

浅色模式下，PPT 工作台里多个位置文字识别性变差：

1. `Agent 任务 Brief`、`Agent 拆解 / 内部流程` 等说明文字过浅。
2. `生成中...`、失败、警告、成功等状态文字在浅色背景上不够清楚。
3. 禁用按钮只靠 `opacity` 降低透明度，导致文字和背景一起变淡。
4. 部分透明背景类如 `bg-white/[0.06]`、`bg-white/[0.08]` 没有被浅色主题接管。
5. 深色硬编码类和浅色主题桥接混用，导致浅色修好了一个区域，另一个区域仍然漏掉。

## 根因

PPT 工作台最早是深色界面，组件里存在大量固定深色 Tailwind 类：

1. 文字类：`text-white`、`text-zinc-*`、`text-violet-200/60`、`text-violet-300/70`。
2. 背景类：`bg-[#12141e]`、`bg-white/[0.03]`、`bg-white/[0.06]`、`bg-white/5`。
3. 状态类：`text-emerald-300`、`text-red-300`、`text-amber-300`、`text-blue-300`。
4. 禁用态：`disabled:opacity-60`。

之前的全局桥接只覆盖了基础的 `text-white`、`text-zinc-*`、少量 `bg-white/[...]`，没有覆盖带透明度的品牌色、状态色和禁用态，所以新增 UI 后又出现低对比问题。

## 已执行修复

实现位置：`src/app/globals.css`

1. 新增 `:root:not(.dark) .ppt-workshop` 浅色专用对比保护层。
2. 浅色模式下把 `text-violet-*` 映射为高对比紫色 `#6d28d9`。
3. 浅色模式下把状态色映射为高对比语义色：蓝、绿、红、琥珀分别独立处理。
4. 补齐 `bg-white/[0.02]`、`bg-white/[0.06]`、`bg-white/[0.08]`、`bg-white/[0.09]`、`bg-white/[0.1]`、`bg-white/[0.14]` 的浅色背景映射。
5. 浅色禁用按钮不再只靠透明度，改为明确的浅灰背景、灰蓝文字和边框。
6. 深色模式继续使用 `.dark .ppt-workshop` 自己的玻璃配色，不被浅色规则影响。

## 后续新增 UI 必须遵守

1. 新 UI 优先使用主题语义类：`text-foreground`、`text-muted-foreground`、`bg-card`、`bg-muted`、`border-border`、`bg-primary`、`text-primary`。
2. 不要在普通组件里继续新增 `text-white`、`text-zinc-*`、`bg-white/[...]` 作为主题样式。
3. 如果必须使用品牌色或状态色，必须同时检查浅色和深色下的可读性。
4. 禁用态不能只写 `disabled:opacity-60`，浅色模式必须有明确的禁用背景、文字和边框。
5. 小字号文字，尤其是 `10px`、`11px`，不能使用低透明度文字叠在浅色或深色弱背景上。
6. 弹窗、浮层、Popover 如果不在 `.ppt-workshop` 内部，必须单独接入主题桥接类，例如 `.ppt-modal-surface`。
7. 深色和浅色规则必须分开写，浅色只写在 `:root:not(.dark)`，深色只写在 `.dark`，避免互相污染。

## 每次 UI 修改后的检查清单

1. 浅色模式：标题、正文、说明、小字、输入框、placeholder、禁用按钮是否清楚。
2. 深色模式：卡片、按钮、弱文字是否仍然清楚，不能出现黑底黑字或灰字吃底。
3. 状态反馈：生成中、成功、失败、警告、待审核是否都有清晰文字和背景。
4. 交互状态：hover、选中、focus、disabled 是否都有可见变化。
5. 新增 Tailwind 任意透明度类，例如 `bg-white/[0.xx]`、`text-color/xx`，必须确认主题桥接是否覆盖。

