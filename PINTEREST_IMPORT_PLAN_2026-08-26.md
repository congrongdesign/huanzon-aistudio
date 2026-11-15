# Pinterest 画板导入方案（纯 Pinterest 版）

> 日期：2026-08-26
> 目标：让环中AIStudio 用户连接自己的 Pinterest 账号，浏览画板并把 pin 图片导入到平台（画布 / 图库 / 灵感库 / 参考库）。
> 范围：仅 Pinterest（官方 API v5），不接入花瓣。

---

## 1. 可行性结论

**完全可行，官方支持。**
- 官方 API v5 + OAuth 2.0，免费，接口稳定。
- 新 App 默认 trial 模式，只允许操作 **App 拥有者自己的账号** —— 恰好匹配"从我的画板导入"（个人使用）。
- 若未来要多用户使用，需提交 App 审核升级 Standard（约几天~2 周）。

## 2. Pinterest API 关键事实

- 开发者平台：https://developers.pinterest.com ，创建 App 获取 app_id / app_secret，配置回调地址。
- OAuth scope：
  - boards:read 读画板列表
  - pins:read 读 pin（含图片）
  - user_accounts:read 读用户信息
  - 私密画板需额外 boards:read_secret / pins:read_secret
- 核心接口：
  - GET /v5/user_account 当前用户
  - GET /v5/boards 画板列表
  - GET /v5/boards/{board_id}/pins 画板内 pin（bookmark 游标分页）
  - GET /v5/pins/{pin_id} pin 详情
- 限流：读 1000 次/分钟。
- 图片直链：API 返回 media.images 多尺寸，https://i.pinimg.com/originals/... 可直接下载，无防盗链。

## 3. 架构设计

```
Pinterest API v5 ──OAuth2──► /api/import/pinterest/*（服务端代理）
                                  │ 下载原图 + 转存 S3/本地存储（复用 upload 逻辑）
                                  ▼
                        image_records / inspiration_items / reference_images
```

要点：
1. **服务端代理下载 + 转存**：不直接引用外链，统一转存自建存储（复用 S3Storage / saveBinaryFile 双模式）。
2. **连接信息入库**：新增 platform_connections 表存 OAuth token（Pinterest token 一般不过期，仍预留过期字段）。
3. **统一导入交互**：连接 → 选画板 → 瀑布流多选 → 选导入目标 → 进度导入。

## 4. 数据库设计

### 新增表 platform_connections

| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) PK | uuid |
| user_id | varchar(36) | 关联 users |
| provider | varchar(20) | pinterest |
| provider_user_id | varchar(128) | Pinterest 用户名 |
| provider_username | varchar(128) | 平台昵称 |
| access_token | text | access token（加密存储） |
| scopes | text | 已授权 scope |
| token_expires_at | timestamptz | 预留 |
| created_at / updated_at | timestamptz | |

唯一约束：(user_id, provider)。

### 扩展现有表（建议）
- image_records：加 source varchar(20) 默认 generated、source_url text，标记导入来源。
- inspiration_items：已有 source，加 source_id、source_url。

## 5. API 设计（src/app/api/import/pinterest/）

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/import/pinterest/auth-url | GET | 生成 OAuth 授权跳转 URL（带 state，state 存 cookie） |
| /api/import/pinterest/callback | GET | OAuth 回调，code 换 token，入库，302 回前端 |
| /api/import/pinterest/connection | GET/DELETE | 查询连接状态 / 断开 |
| /api/import/pinterest/boards | GET | 我的画板列表 |
| /api/import/pinterest/boards/[boardId]/pins | GET | pin 列表（bookmark 分页，含缩略图/原图 URL、标题） |
| /api/import/pinterest/pins | POST | 批量导入：代理下载原图 → 转存 → 按目标入库 |

导入目标 target：canvas（当前画布）/ gallery（图库）/ inspiration（灵感库）/ reference（参考库）。

## 6. 前端 UI 设计

- 入口：全局图库浮层 / 灵感图库 / 参考库 顶部加「从 Pinterest 导入」按钮。
- 导入面板（Dialog）：
  - 未连接：显示「连接 Pinterest」按钮（跳 OAuth）。
  - 已连接：头像/昵称 + 画板下拉 + 瀑布流多选 + 导入目标 + 进度条。
- 完成后默认以图片块落到当前画布，或按所选目标入库。

## 7. 实施里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 注册 Pinterest 开发者 App（用户提供 client id/secret）、加表、环境变量 | 待用户提供凭证（代码已就绪） |
| P1 | OAuth 连接 + 画板列表 + pin 瀑布流 + 导入画布/图库 | ✅ 已实现（2026-08-26） |
| P2 | 导入到参考库 + 来源标记 + 断开重连 | ✅ 已实现 |
| P3 | 增强：按关键字筛选、来源页跳转、画板增量同步 | 可选 |

### 已实现内容（2026-08-26）
- 后端：`src/lib/pinterest.ts`（OAuth/API 客户端）、`src/lib/pinterest-connection.ts`（双模式连接存储）、
  `src/app/api/import/pinterest/` 6 个路由（auth-url / callback / connection / boards / boards/[boardId]/pins / pins）。
- 数据库：`platform_connections` 表（本地 JSON 库已支持 + Supabase 建表 SQL 在 `migrations/2026-08-26-platform-connections.sql`）。
- 前端：`src/components/PinterestImportDialog.tsx`（连接 → 选画板 → 瀑布流多选 → 导入画布/图库/参考库，带进度）。
  入口在全局图库浮层工具栏的 Pinterest 图标按钮。
- 导入图片会服务端代理下载并转存到 S3/本地存储，不依赖外链；来源链接写入 `reference_images` 便于追溯。

## 8. 风险与合规

| 风险 | 等级 | 应对 |
|------|------|------|
| App 审核（trial 仅限本人账号） | 低 | 个人使用 trial 足够；多用户再提交 Standard |
| 限流 | 低 | 分页 + 合理频率 + 失败重试 |
| 图片版权 | 低 | 仅个人参考/设计素材，保留来源链接 |
| 外链失效 | 低 | 一律转存自建存储 |

## 9. 前置条件（需要用户提供）

1. 在 https://developers.pinterest.com 创建 App，获取 **Client ID / Client Secret**。
2. 在 App 设置里配置回调地址：`{部署地址}/api/import/pinterest/callback`（本地开发为 http://localhost:3000/api/import/pinterest/callback）。
3. 环境变量：PINTEREST_CLIENT_ID、PINTEREST_CLIENT_SECRET、PINTEREST_REDIRECT_URI。

*参考：Pinterest API v5 官方文档（boards/pins 读取、OAuth scope、trial/standard 审核机制）。*
