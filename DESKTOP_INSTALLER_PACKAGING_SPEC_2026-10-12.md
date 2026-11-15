# 环中AIStudio 文件安装包打包封装规范

版本：2026-10-12
适用仓库：`/Users/congrong/Documents/AI平台`
适用场景：内部桌面安装包、自动更新包、本机安装版和团队分发

---

## 1. 文档目的

本规范用于统一环中AIStudio桌面版的打包、封装、签名、校验、分发与回滚流程。

每次发布必须同时满足：

- 可安装。
- 可启动。
- 可自动更新。
- 可校验完整性。
- 可回滚上一稳定版。
- 不删除用户数据。
- 产物命名、版本号和更新元数据一致。

---

## 2. 当前包管理器和基础技术栈

- 包管理器：仅允许 `pnpm`。
- 桌面壳：Electron。
- 页面服务：Next.js 16 standalone。
- 安装包构建：electron-builder。
- 自动更新：electron-updater。
- 应用 ID：`com.huanzon.aistudio`。
- 产品名称：`环中AIStudio`。
- 当前主版本示例：`0.2.2`。

禁止使用 `npm install` 或 `yarn` 作为正式发布安装方式。

---

## 3. 发布前必须确认的参数

发布前逐项填写，任何一项缺失都不得继续：

| 参数 | 示例 | 说明 |
|---|---|---|
| `VERSION` | `0.2.3` | 本次正式版本 |
| `RING` | `ring1` | `ring0` / `ring1` / `ring2` |
| `ROLLBACK_VERSION` | `0.2.2` | 回滚版本，默认 N-1 |
| `UPDATE_CHANNEL_URL` | 内部更新地址 | 不得使用占位地址正式分发 |
| `OWNER` | 发布负责人 | 记录发布责任人 |
| `PLATFORM` | `mac` / `win` / `all` | 本次发布平台 |

### 版本号规则

- 每次正式分发必须递增版本号。
- 禁止重复使用已正式发布的版本号。
- 默认 patch：`0.2.2 -> 0.2.3`。
- 允许命令：

```bash
corepack pnpm run desktop:version:patch
corepack pnpm run desktop:version:minor
corepack pnpm run desktop:version:major
node scripts/desktop-version-bump.mjs --set 0.2.3
```

---

## 4. 安装包架构

桌面安装包由四层组成：

```text
Electron 主程序
├── app.asar                 # Electron 主进程代码
├── Resources/standalone     # Next.js 生产运行目录
├── Resources/updater        # electron-updater 运行依赖
└── 平台资源                  # 图标、协议、DMG/NSIS 配置
```

Next.js standalone 必须包含：

```text
standalone/
├── server.js
├── .next/static/
├── public/
├── node_modules/
└── package.json
```

禁止把源码目录、Git 数据和缓存打入正式安装包：

```text
.git
src
docs
release
tools
.next/cache
.playwright-cli
```

---

## 5. 平台与产物矩阵

### 5.1 macOS

构建目标：

```text
arch: arm64
target: dmg + zip
```

标准产物：

```text
环中AIStudio-<version>-arm64.dmg
环中AIStudio-<version>-arm64.zip
环中AIStudio-<version>-arm64.dmg.blockmap
环中AIStudio-<version>-arm64.zip.blockmap
latest-mac.yml
```

如果同时构建 Intel：

```text
环中AIStudio-<version>-x64.dmg
环中AIStudio-<version>-x64.zip
```

当前本机已经验证 Apple Silicon arm64。Intel x64 包必须在 Intel Mac 或受控 x64 环境中完成启动验收。

### 5.2 Windows

构建目标：

```text
arch: x64
target: nsis + portable
```

标准产物：

```text
环中AIStudio-<version>-win-x64-setup.exe
环中AIStudio-<version>-win-x64-portable.exe
环中AIStudio-<version>-win-x64-setup.exe.blockmap
latest.yml
```

### 5.3 完整性文件

每次发布必须新增：

```text
SHA256SUMS.txt
```

---

## 6. 标准打包流程

### 6.1 单平台 macOS

```bash
cd /Users/congrong/Documents/AI平台
corepack pnpm run desktop:version:patch
corepack pnpm install --frozen-lockfile
corepack pnpm run desktop:preflight -- --strict
corepack pnpm run desktop:release:mac
corepack pnpm run desktop:verify -- --platform mac
```

### 6.2 单平台 Windows

```bash
cd /Users/congrong/Documents/AI平台
corepack pnpm run desktop:version:patch
corepack pnpm install --frozen-lockfile
corepack pnpm run desktop:preflight -- --strict
corepack pnpm run desktop:release:win
corepack pnpm run desktop:verify -- --platform win
```

### 6.3 双平台正式发布

```bash
cd /Users/congrong/Documents/AI平台
corepack pnpm install --frozen-lockfile
corepack pnpm run desktop:preflight:strict
corepack pnpm run desktop:release
corepack pnpm run desktop:verify -- --platform mac
corepack pnpm run desktop:verify -- --platform win
corepack pnpm run desktop:postpack -- --ring ring1 --rollback auto
```

### 6.4 一键快速流程

```bash
corepack pnpm run desktop:release:fast
```

该命令会执行版本递增、preflight、双平台打包、验证和 postpack。

---

## 7. 构建顺序约束

必须按以下顺序执行：

1. 更新版本号。
2. 安装冻结依赖。
3. 生成桌面图标。
4. 准备 electron-updater 运行依赖。
5. 构建 Next.js standalone。
6. 复制 `.next/static` 和 `public` 到 standalone。
7. 清理 standalone 中不应发布的文件。
8. 编译 Electron 主进程。
9. 执行 electron-builder。
10. 校验安装包、更新元数据和包内资源。
11. 生成 SHA256 清单。
12. 上传并通知。

任何步骤失败都必须停止，不得继续上传或通知。

---

## 8. 关键打包规则

### 8.1 standalone 资源

必须保证：

- `standalone/server.js` 存在。
- `standalone/.next/static/` 存在。
- `standalone/public/` 存在。
- `standalone/package.json` 存在。
- 运行所需 `node_modules` 存在。

### 8.2 Windows sharp 依赖

Windows 包必须包含：

```text
node_modules/@img/sharp-win32-x64
node_modules/@img/sharp-libvips-win32-x64
```

`.next/standalone-win` 不得包含软链接。

### 8.3 用户数据

安装和卸载默认不得删除：

```text
macOS: ~/Library/Application Support/环中AIStudio
Windows: %APPDATA%/环中AIStudio
```

用户数据包括项目、配置、本地文件和日志。

### 8.4 更新元数据

交付时必须同时包含：

```text
latest.yml
latest-mac.yml
对应 blockmap
```

安装包和更新元数据必须属于同一版本、同一构建批次。

---

## 9. 签名与系统安全提示

内部版本当前可接受未签名或 ad-hoc 签名，但必须记录风险：

- macOS 可能提示无法验证开发者。
- Windows SmartScreen 可能提示未知发布者。

正式对外分发建议：

1. 配置 Apple Developer ID。
2. 执行 `codesign`、`notarytool` 和 `stapler`。
3. 配置 Windows 代码签名证书。
4. 签名后重新生成 blockmap 和 SHA256 清单。

禁止先签名后修改包内任何文件。

---

## 10. 发布门禁

发布前必须全部通过：

- `package.json` 版本已递增。
- `electron-builder.yml` 的 `appId` 和 `nsis.guid` 未被误改。
- 图标文件存在：
  - `electron/icon.png`
  - `electron/icon.icns`
  - `electron/icon.ico`
- `pnpm-lock.yaml` 与依赖一致。
- standalone 关键文件完整。
- macOS 包可启动。
- Windows 包可启动。
- 画布页面可打开。
- 生图入口可操作。
- 历史记录可读取。
- 自动更新检查可执行。
- 更新元数据与实际产物一致。
- SHA256 校验文件已生成。

---

## 11. 安装后验收清单

每个平台至少验收一台：

- 双击安装成功。
- 首次启动无黑屏、闪退或长时间卡启动。
- 主窗口可以正常显示。
- 项目列表可以加载。
- 画布可以打开和交互。
- 图片生成入口不被遮挡。
- 后台归档任务可以启动、显示进度并完成。
- 归档完成后原项目记录和文件自动清理。
- 可以从 NAS 归档恢复项目。
- 退出并重新打开应用后数据仍存在。
- 自动更新检查不报错。

---

## 12. 文件命名规范

禁止使用以下泛化名称作为正式交付名：

```text
app.dmg
setup.exe
latest.zip
new-version
final
最终版
```

必须包含：

- 产品名
- 版本号
- 平台或架构
- 文件类型

示例：

```text
环中AIStudio-0.2.3-arm64.dmg
环中AIStudio-0.2.3-win-x64-setup.exe
```

---

## 13. 分发目录规范

推荐目录：

```text
ai-studio-desktop/
├── stable/<version>/
├── gray/<version>/
├── rollback/<version>/
├── SHA256SUMS.txt
└── RELEASE_NOTES.md
```

规则：

- `stable` 只保留当前稳定版和最近一个稳定版。
- `gray` 与 `stable` 分离。
- `rollback` 至少保留最近一个稳定版本。
- 每个版本目录必须包含安装包、更新元数据、blockmap 和 SHA256 清单。

---

## 14. 回滚规范

触发回滚：

- 大面积启动失败。
- 核心功能不可用。
- 数据异常或存在数据删除风险。
- 自动更新导致无法进入主界面。

回滚步骤：

1. 暂停新版本下载。
2. 切回稳定版本更新元数据。
3. 保留故障版本产物用于排查。
4. 通知用户安装回滚版本。
5. 收集日志并完成根因分析。

禁止覆盖删除故障版本记录。

---

## 15. 发布日志格式

每次发布必须记录：

```text
版本：
平台：
构建时间：
发布负责人：
Git 提交：
产物路径：
SHA256：
自动更新地址：
测试设备：
验收结果：
已知问题：
回滚版本：
```

---

## 16. 当前已知约束

- 更新地址仍由 `electron-builder.yml` 的 `publish.url` 控制，正式发布前必须替换占位地址。
- 当前内部包可接受未签名，但系统安全提示需要写入发布说明。
- macOS 本机已验证 arm64；Intel x64 需要独立设备验收。
- Windows 包需要在 Windows 设备上完成最终安装和更新验收。
- 打包时不得删除 `~/Library/Application Support/环中AIStudio` 用户数据。
- 不得直接把源码目录复制覆盖用户安装版代替正式升级流程。

---

## 17. 一句话发布指令

需要重新打包时，可以直接发送：

```text
请按 DESKTOP_INSTALLER_PACKAGING_SPEC_2026-10-12 执行完整桌面发布：
1. 版本号升一个 patch；
2. 执行 preflight 严格检查；
3. 打包 macOS arm64 和 Windows x64；
4. 执行双平台 verify 和 postpack；
5. 输出产物清单、SHA256、验收结果、风险和回滚版本。
```

指定版本号时使用：

```text
请按 DESKTOP_INSTALLER_PACKAGING_SPEC_2026-10-12 打包，版本号设为 X.Y.Z，其余流程保持不变。
```

---

## 18. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-12 | 新增当前版本安装包封装规范，统一 Electron、Next standalone、更新元数据、后台归档版本和 SHA256 校验流程 |
