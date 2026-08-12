# Sprint 1 回归清单（稳定性收口）

更新时间：2026-06-12（第二次）  
适用范围：`局部重绘 + 生成链路 + 操作追踪 + 批量任务状态机`（Phase 0 / Sprint 1）

---

## 1. 目标

本清单用于验证两件事：

1. 局部重绘交互“可选中 + 可补涂 + 可提交”不回归。  
2. `generate / image-process / inpaint` 三条链路在 `design_operations` 上可追踪、可定位失败原因。

---

## 2. 环境前置

1. 预览地址：`http://127.0.0.1:3001/`。  
2. 至少准备 3 张测试图：
   - 单主体 + 干净背景；
   - 多小元素（图标/文字/装饰）；
   - 复杂背景（高纹理）。  
3. API Key 可用（或本地后端模式已开启）。
4. 可选自动化冒烟脚本：
   - `scripts/smoke-sprint1.sh http://127.0.0.1:3001`。

---

## 3. 局部重绘回归（前端交互）

1. 点击选中  
   - 进入局部重绘，鼠标单击小元素，仅该元素出现选中边界。  
2. 框选多元素  
   - 拖拽框选后，覆盖框内目标元素，框外元素不被误选。  
3. 手工补涂（加法）  
   - `Ctrl/Cmd + 拖拽` 后，选区面积增加且可见。  
4. 手工补涂（减法）  
   - `Alt + 拖拽` 后，选区面积减少且可见。  
5. 清空选区  
   - `Shift + 空白点击` 后，选区清空。  
6. 提交一致性  
   - 提交前预览与最终重绘区域一致，不出现“预览选中、提交未生效”。

---

## 4. 局部重绘回归（接口链路）

1. `PUT /api/inpaint` 返回结构完整：
   - 必含 `maskBase64`, `idMap`, `elements`, `stats`。  
2. `POST /api/inpaint` 正常路径：
   - 返回 `operationId`，并新增结果图记录。  
3. `POST /api/inpaint` 空掩膜路径：
   - 返回 `errorCode=BAD_REQUEST`，HTTP 400。  
4. `POST /api/inpaint` 上游失败路径：
   - 返回 `errorCode` 非空（如 `UPSTREAM_5XX` / `POLICY_VIOLATION`），`retryable` 字段存在。  

---

## 5. 生成与处理链路回归

1. `POST /api/generate`：
   - 成功返回 `operationId`，失败返回 `error + errorCode + retryable`。  
2. `POST /api/image-process`：
   - 运行中返回 `status=running + id + operationId`。  
3. `GET /api/image-process` 轮询：
   - 成功返回 `status=completed + operationId`；  
   - 失败返回 `status=failed + errorCode + retryable + operationId`。  

---

## 6. 设计操作账本校验（design_operations）

对每次 generate / process / inpaint 操作，确认：

1. 创建时 `status=running`。  
2. 完成后 `status=completed` 且 `completed_at` 非空。  
3. 失败后 `status=failed` 且 `error` 含 `[ERROR_CODE]` 前缀。  
4. inpaint 操作应有：
   - `input_asset_ids`；
   - `mask_asset_id`；
   - `output_asset_ids`（成功时）。  

---

## 7. 验收门槛（本期）

1. 局部重绘交互通过率 >= 95%（内部样本）。  
2. 三条链路均可回写 `operationId`。  
3. 失败响应统一包含 `errorCode` 与 `retryable`。  
4. `corepack pnpm ts-check` 通过。

---

## 8. 批量任务状态机回归（新增）

1. `/api/batches` 返回的每条记录应包含：
   - `status`（兼容旧状态）；
   - `unifiedStatus`（`queued/running/completed/failed/cancelled`）；
   - `recovery`（`resumable/canRetryFailedPages/queuedPages/runningPages/failedPages`）。
2. `/api/batches/:id` 返回字段与列表一致，且页面项包含 `unifiedStatus`。
3. 服务重启后恢复：
   - 若有批次处于 `running/paused` 且页面状态为 `draft_generating/color_generating`；
   - 首次访问批次接口后应自动恢复为 `draft_queued/color_queued` 并继续执行。
4. 所有 `/api/batches/*` 操作接口应校验用户归属：
   - 非归属用户访问返回 `403`；
   - 响应体包含 `errorCode` 与 `retryable`。

---

## 9. 资产索引与搜索回归（Phase 2 MVP 新增）

1. `POST /api/asset-index` 参数校验：
   - `mode=ids` 且 `ids=[]` 返回 `400`；
   - 响应包含 `error/errorCode/retryable`。
2. `POST /api/asset-index` 正常路径：
   - 返回 `job`；
   - `job` 至少包含 `status/source_count/indexed_count/failed_count`。
3. `GET /api/asset-index` 列表路径：
   - 返回 `jobs` 数组；
   - 支持 `projectId/status/limit` 查询。
4. `POST /api/asset-search` 正常路径：
   - 返回 `records/total/offset/limit`；
   - `includeFacets=true` 时返回 `facets`。
5. `GET /api/asset-search` 参数查询路径：
   - 支持 `query/projectId/models/sizes/tags/sortBy`；
   - 结果结构与 `POST` 一致。

6. `POST /api/asset-index` 增量跳过校验（`force=false`）：
   - 重复执行同项目索引后，`summary.skippedCount` 增加；
   - `job.stats` 包含 `skippedCount`、`force` 字段。

7. 索引任务面板校验（前端）：
   - 索引检索模式下可见最近任务列表（状态、耗时、失败提示）；
   - 有 `running/queued` 任务时列表自动轮询刷新；
   - 失败任务展示 `error/errorCode/retryable` 信息。

8. 索引检索联动校验（前端）：
   - 顶部与左侧筛选操作均触发同一后端检索；
   - 排序（相关度/时间）切换后结果即时刷新；
   - 标签/模型 Facet 点击后自动回填查询并触发检索。
