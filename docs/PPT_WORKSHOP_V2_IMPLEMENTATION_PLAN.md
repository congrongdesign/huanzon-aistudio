# PPT 工作台 V2 更新计划（执行版）

日期：2026-05-31
状态：准备开发

## 一、改造范围

- 前端主文件：`src/components/PPTWorkshop.tsx`
- 可选新增：
  - `src/components/ppt-workshop/queue.ts`
  - `src/components/ppt-workshop/progress.ts`
  - `src/components/ppt-workshop/types.ts`
- API：沿用现有 `/api/generate`，先在前端实现并发池。

## 二、开发清单

## Step 1：数据模型升级

1. 给 `PPTSlide` 增加：
- `perSlidePrompt?: string`
- `skipInBatch?: boolean`

2. 给 `StyleProposal` 增加：
- `styleExtraPrompt?: string`

3. 给 `PPTProject` 增加：
- `styleLockPrompt?: string`
- `styleCoverPage?: number`
- `styleInnerPage?: number`
- `maxConcurrency?: number`
- `progress` 结构

4. 补迁移逻辑（migrateProject/migrateSlide）避免旧数据崩。

## Step 2：风格确认重构

1. 每个 style card 支持：
- 独立参考图集（不止1张）
- 独立 styleExtraPrompt

2. 生成风格样张时：
- 仅使用当前 style 的 referenceImages + 页面原稿图
- 不默认混入其他 style 的参考图

3. 点击“确认此风格”时：
- 生成并写入 `styleLockPrompt`
- 记录 `styleCoverPage/styleInnerPage`

## Step 3：自动美化逻辑重写

1. 启动批量前计算目标页：
- 范围内页面
- 去掉 `skipInBatch===true`
- 默认把 cover/inner 样张页设为 skip

2. 生成 prompt 构成：
- `styleLockPrompt`（必带）
- 页型 prompt
- 项目全局 prompt
- `slide.perSlidePrompt`

3. 页面队列 UI：
- 原稿缩略图
- 页码和状态
- 单页提示词输入

## Step 4：并发池 + 进度 + ETA

1. 新增调度器：
- 最大并发配置：2~16（默认8）
- 任务粒度：单页单方案

2. 进度统计：
- 已完成/失败/运行中/总任务
- 每秒刷新 ETA（滚动平均）

3. 限流处理：
- 429/5xx 自动重试
- 指数退避
- 动态降并发

## Step 5：审核页实时化

1. 实时插入已完成图片，不等待整页结束。
2. 补“单方案重生”按钮。
3. 增加状态筛选（待审核/失败/全部）。
4. 失败卡显示错误详情。

## Step 6：联调与回归

1. 10页小样本：验证流程闭环。
2. 40页中样本：验证并发稳定性。
3. 60页样本：验证 ETA 与 UI 响应。
4. 确认 dark/light 模式可读性不过度回退。

## 三、排期估算

- Step 1~2：0.5~1 天
- Step 3~4：1~2 天
- Step 5~6：1 天
- 总计：2.5~4 天

## 四、交付内容

1. 重构后的 PPT 工作台（V2 逻辑）
2. 使用说明（自动美化、单页提示词、并发、ETA、审核）
3. 已知限制说明（模型限流、参考图数量建议）

