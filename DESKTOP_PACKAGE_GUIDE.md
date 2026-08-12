# 环中AIStudio 桌面安装包发布规范（Codex 执行版，完整门禁）

更新时间：2026-06-20  
适用仓库：`/Users/congrong/Documents/AI平台`  
发布场景：团队内部使用，不上应用市场

## 0. 文档定位

本文件是给 Codex 执行的发布规则，不是面向人工阅读的说明文。

执行目标：

- 产出 Windows x64 与 macOS arm64 可安装包。
- 产出完整自动更新元数据。
- 通过脚本校验与最小人工验收。
- 具备灰度、回滚、日志追踪能力。

## 1. 输入参数（每次发布前必须明确）

- `VERSION`：本次发布版本（必须大于上一版本）。
- `RING`：`ring0` / `ring1` / `ring2`。
- `UPDATE_CHANNEL_URL`：本次更新源地址（内部可访问）。
- `ROLLBACK_VERSION`：回滚版本（通常 N-1）。
- `OWNER`：发布负责人。

如果任一参数缺失，停止执行。

版本号规则（强制）：

- 每次打包前必须升版本，禁止继续使用上一版号（例如继续用 `0.1.1`）。
- 默认发布走 `patch` 递增。
- 可用命令：
  - `corepack pnpm run desktop:version:patch`
  - `corepack pnpm run desktop:version:minor`
  - `corepack pnpm run desktop:version:major`
  - `node scripts/desktop-version-bump.mjs --set X.Y.Z`

## 2. 硬性规则（不可跳过）

- 仅允许使用 `pnpm`。
- 必须在仓库根目录执行。
- 必须使用锁定安装：`corepack pnpm install --frozen-lockfile`。
- 任一步骤失败必须停止，禁止“带错继续发版”。
- 禁止复用同版本号覆盖重发。
- 禁止只发安装包不发 `latest*.yml`/`blockmap`。
- 禁止灰度包和稳定包混放。
- 禁止在发布说明缺失时推送给团队。

## 3. 平台矩阵与已知限制（必须写入发布说明）

- Windows：x64，NSIS `.exe`。
- macOS：arm64（Apple Silicon），`.dmg` + `.zip`。
- 当前不支持：macOS Intel x64、Linux 内部分发。
- 云依赖场景：离线无法完整使用（Supabase/S3/grsai）。
- 未签名包可能触发系统安全提示（Windows SmartScreen / macOS Gatekeeper）。

## 4. 发布前 Gate（执行前逐项断言）

### 4.1 配置门禁

- `package.json` 的 `version` 已更新且与 `VERSION` 一致。
- `electron-builder.yml` 中 `appId` 未误改。
- `electron-builder.yml` 中 `nsis.guid` 未误改。
- `electron-builder.yml` 更新地址不是占位值。

### 4.2 资源门禁

- 图标文件存在：
  - `electron/icon.png`
  - `electron/icon.icns`
  - `electron/icon.ico`

### 4.3 环境门禁

- `pnpm-lock.yaml` 已同步。
- 本地无长驻进程占用 `5000-5009`（避免启动检测冲突）。
- 明确 `ROLLBACK_VERSION` 并可下载。

## 5. 标准执行命令（固定顺序）

```bash
# 0) 先升版本（示例：patch）
corepack pnpm run desktop:version:patch

# 1) 锁定依赖安装
corepack pnpm install --frozen-lockfile

# 2) 构建并打包 macOS
corepack pnpm run desktop:release:mac

# 3) 构建并打包 Windows
corepack pnpm run desktop:release:win

# 4) 显式校验（mac）
corepack pnpm run desktop:verify -- --platform mac

# 5) 显式校验（win）
corepack pnpm run desktop:verify -- --platform win

# 6) 生成完整性校验清单
cd release
shasum -a 256 *.exe *.dmg *.zip *.yml *.blockmap > SHA256SUMS.txt
```

失败处理：

- 任一命令非 0 退出码 => 立即停止。
- 记录失败命令、错误摘要、日志路径。

## 6. 必须交付产物（release 目录）

### 6.1 Windows

- `环中AIStudio-Setup-<version>.exe`
- `环中AIStudio-Setup-<version>.exe.blockmap`
- `latest.yml`

### 6.2 macOS

- `环中AIStudio-<version>-arm64.dmg`
- `环中AIStudio-<version>-arm64.zip`
- `环中AIStudio-<version>-arm64.dmg.blockmap`
- `环中AIStudio-<version>-arm64.zip.blockmap`
- `latest-mac.yml`

### 6.3 完整性文件

- `SHA256SUMS.txt`

### 6.4 包内必备资源（抽样检查）

- `standalone/server.js`
- `updater/node_modules/electron-updater/package.json`
- Windows/mac 资源中 `icon.png` 存在
- mac app 资源中 `icon.icns` 存在

## 7. 自动更新门禁（必须验证）

- `latest.yml` 与 Windows `.exe` 同批发布。
- `latest-mac.yml` 与 mac `.zip/.dmg` 同批发布。
- blockmap 文件存在且与安装包版本一致。
- 验证升级路径：`ROLLBACK_VERSION` -> `VERSION`（至少 1 台 Win + 1 台 mac）。
- 如使用灰度更新源，必须与 stable 更新源隔离。

## 8. 内部分发规范（目录与权限）

推荐目录：

```text
/ai-studio-desktop/
  /stable/<version>/
  /gray/<version-rc>/
  /rollback/<version>/
```

分发规则：

- `stable` 仅保留当前稳定版本。
- 至少保留最近 2 个稳定版本完整产物。
- `gray` 与 `stable` 严格隔离。
- 上传权限仅限发布负责人/运维。
- 每次发布同步 `SHA256SUMS.txt` 与发布说明。

## 9. 最小人工验收（Win/mac 各 1 台）

- 安装成功。
- 首次启动成功（无黑屏/闪退）。
- 主页面可加载，画布可交互。
- 生图请求可发起并返回。
- 历史记录可读取。
- 更新检查可触发。
- 卸载重装后数据符合预期（默认保留）。
- `ROLLBACK_VERSION` -> `VERSION` 升级链路通过。

## 10. 数据与日志约束

- 用户数据目录默认保留，不得在指引中让用户直接全量删除。
- 问题排查优先收集：`<userData>/desktop.log`。
- 常见路径：
  - Windows：`%APPDATA%/环中AIStudio`
  - macOS：`~/Library/Application Support/环中AIStudio`
- 回滚前先备份用户目录。

## 11. 快速故障矩阵

- 启动黑屏/闪退：
  - 看 `desktop.log`
  - 检查 `standalone/server.js` 是否打入包内
  - 检查 `5000-5009` 端口占用
- Windows native 模块异常：
  - 重跑 `desktop:release:win`
  - 确认 `.next/standalone-win` 无软链接
- 自动更新失败：
  - 检查 `latest*.yml`、blockmap、版本号递增、更新源地址
- 安装被系统阻止：
  - 按内部安装指引放行
  - 记录系统版本与提示文案

## 12. 回滚 Runbook（执行级）

触发条件（任一满足立即执行）：

- 大面积启动失败。
- 升级后核心功能不可用。
- 数据风险或数据异常扩散。

步骤：

1. 暂停新版本下载入口与更新元数据。
2. 切回 `ROLLBACK_VERSION` 对应更新源。
3. 发布回滚通知（版本、影响范围、操作步骤）。
4. 指导受影响成员回滚安装。
5. 收集日志并发起根因分析。

规则：

- 回滚包必须与元数据成套。
- 不允许用同版本号覆盖回滚。

## 13. 发布结果输出模板（Codex 必须按此输出）

```markdown
## 发布结果
- 版本：vX.Y.Z
- 发布级别：ring0/ring1/ring2
- 平台：Windows x64 / macOS arm64
- 执行人：<OWNER>
- 结果：成功 / 失败

## 产物清单
- Windows: ...
- macOS: ...
- 元数据: latest.yml / latest-mac.yml
- SHA256SUMS: 已生成 / 未生成

## 校验结果
- desktop:verify(mac)：通过 / 失败
- desktop:verify(win)：通过 / 失败
- 包内关键资源抽样：通过 / 失败

## 验收结果
- Win 安装启动：通过 / 失败
- Mac 安装启动：通过 / 失败
- 升级链路（N-1 -> N）：通过 / 失败

## 风险与回滚
- 当前风险：...
- 回滚版本：vX.Y.(Z-1)
- 回滚入口：<internal-link>
```

## 14. 文件变更影响（这些文件有改动时必须全量复验）

- `electron-builder.yml`
- `scripts/electron-prepare-release.sh`
- `scripts/electron-release-mac.sh`
- `scripts/electron-release-win.sh`
- `scripts/verify-desktop-release.mjs`
- `scripts/prepare-electron-updater-runtime.mjs`
- `electron/main.ts`

## 15. 可选增强（内部推荐）

- 增加自动脚本：发布后自动生成 `SHA256SUMS.txt` + `RELEASE_NOTES.md`。
- 增加发布前脚本：检查占位更新地址、版本递增、产物完整性。
- 增加签名流程：降低内部安装拦截与误报。

## 16. 你下次给 Codex 的一句话模板

当你完成更新后，直接发下面这句即可：

```text
请按 DESKTOP_PACKAGE_GUIDE 的完整门禁流程打包桌面版：
1) 先把版本号升一个 patch（不要重复旧版本号）；
2) RING=ring1，ROLLBACK_VERSION=上一个稳定版；
3) 执行 preflight(严格) + mac/win 打包 + 双平台 verify + postpack；
4) 输出产物清单、SHA256、风险和回滚入口。
```

如果你要指定版本号，用这句：

```text
请按 DESKTOP_PACKAGE_GUIDE 打包，版本号设为 X.Y.Z（不要自动 patch），其余流程同上。
```

也可以用“默认一键模式”（自动 patch + 自动 rollback）：

```text
请直接执行 desktop:release:fast，按默认 ring1 输出发布结果。
```
