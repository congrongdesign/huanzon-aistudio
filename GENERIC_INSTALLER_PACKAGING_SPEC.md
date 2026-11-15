# 通用软件安装包打包封装规范

版本：1.0
更新时间：2026-10-12
适用对象：桌面软件、客户端软件、Electron/Tauri/原生应用、带本地服务或运行时的复合应用

---

## 1. 规范目标

本规范用于统一不同软件的安装包打包、封装、签名、校验、发布、升级和回滚流程。

目标是保证每个版本都满足：

- 可安装。
- 可启动。
- 可升级。
- 可回滚。
- 可校验完整性。
- 可定位问题。
- 不误删用户数据。
- 产物命名和版本信息一致。
- 安装包、更新元数据和校验文件成套。

本规范不绑定具体产品、框架或发布平台。使用时替换以下占位符即可。

---

## 2. 通用占位符

| 占位符 | 说明 | 示例 |
|---|---|---|
| `<PRODUCT_NAME>` | 产品名称 | `MyApp` |
| `<PRODUCT_SLUG>` | 英文短名或文件系统安全名 | `my-app` |
| `<VERSION>` | 语义化版本 | `1.4.2` |
| `<BUILD_NUMBER>` | 构建号或提交号 | `20261012.3` |
| `<APP_ID>` | 应用唯一标识 | `com.company.myapp` |
| `<COMPANY>` | 公司或组织名称 | `Example Company` |
| `<PLATFORM>` | 平台 | `mac` / `win` / `linux` |
| `<ARCH>` | 架构 | `arm64` / `x64` / `universal` |
| `<CHANNEL>` | 更新渠道 | `stable` / `beta` / `dev` |
| `<UPDATE_URL>` | 更新元数据地址 | `https://updates.example.com/myapp` |
| `<RELEASE_OWNER>` | 发布负责人 | `release-team` |
| `<ROLLBACK_VERSION>` | 回滚版本 | `1.4.1` |
| `<GIT_COMMIT>` | 源码提交 | `a1b2c3d` |
| `<BUILD_TIME>` | 构建时间 | `2026-10-12T08:00:00Z` |

禁止在产品、脚本和文档中硬编码只在某一个软件中成立的产品名称、路径或端口。

---

## 3. 适用范围

本规范适用于：

- Windows 安装包。
- macOS DMG、ZIP、PKG。
- Linux AppImage、DEB、RPM、tar.gz。
- 自动更新包。
- 增量或全量升级包。
- 带内置运行时的复合应用。
- 带本地服务、数据库、驱动或插件系统的桌面应用。

不适用于：

- 纯网页部署。
- 移动端 App Store / Play Store 发布。
- 只需要上传源码即可运行的云端服务。

这些场景应另建对应的部署规范。

---

## 4. 安装包基本结构

通用安装包建议由以下部分组成：

```text
<PRODUCT_NAME> Installer
├── 主程序或启动器
├── 应用资源
├── 内置运行时
├── 第三方依赖
├── 更新组件
├── 图标与品牌资源
├── 许可协议与第三方声明
└── 安装、卸载、修复和升级逻辑
```

复合应用示例：

```text
Application.app / Application.exe
├── app.asar                       # 主应用代码
├── runtime/                       # Node/Python/.NET/JRE 等运行时
├── resources/                     # 静态资源和业务资源
├── updater/                       # 更新组件
├── plugins/                       # 可选插件
└── licenses/                      # 许可与第三方声明
```

---

## 5. 构建产物目录

推荐统一输出目录：

```text
release/
├── artifacts/
│   ├── mac/
│   ├── win/
│   └── linux/
├── unpacked/
│   ├── mac/
│   ├── win/
│   └── linux/
├── metadata/
│   ├── latest.yml
│   ├── latest-mac.yml
│   └── latest-linux.yml
├── checksums/
│   └── SHA256SUMS.txt
├── logs/
├── release-manifest.json
└── RELEASE_NOTES.md
```

如果使用其他构建工具，目录名称可以调整，但必须保证安装包、更新元数据、校验文件和发布说明可成套交付。

---

## 6. 版本号规范

使用语义化版本：

```text
MAJOR.MINOR.PATCH
```

例如：

```text
1.4.2
```

建议：

- `MAJOR`：不兼容变更。
- `MINOR`：新增功能。
- `PATCH`：修复和稳定更新。

预发布：

```text
1.5.0-beta.1
1.5.0-rc.1
```

规则：

- 正式发布必须递增版本号。
- 禁止覆盖已发布版本。
- 禁止灰度包和稳定包共用同一版本号和更新渠道。
- 版本号必须同时写入应用、安装包、更新元数据和发布记录。

---

## 7. 安装包命名规范

命名必须包含：

- 产品名。
- 版本号。
- 平台或架构。
- 文件类型。

禁止使用：

```text
setup.exe
app.dmg
latest.zip
final
new
最终版
```

### 7.1 Windows

```text
<PRODUCT_NAME>-<VERSION>-win-<ARCH>-setup.exe
<PRODUCT_NAME>-<VERSION>-win-<ARCH>-portable.exe
<PRODUCT_NAME>-<VERSION>-win-<ARCH>-setup.exe.blockmap
```

### 7.2 macOS

```text
<PRODUCT_NAME>-<VERSION>-<ARCH>.dmg
<PRODUCT_NAME>-<VERSION>-<ARCH>.zip
<PRODUCT_NAME>-<VERSION>-<ARCH>.dmg.blockmap
<PRODUCT_NAME>-<VERSION>-<ARCH>.zip.blockmap
```

### 7.3 Linux

```text
<PRODUCT_SLUG>-<VERSION>-linux-<ARCH>.AppImage
<PRODUCT_SLUG>_<VERSION>_<ARCH>.deb
<PRODUCT_SLUG>-<VERSION>-<ARCH>.rpm
<PRODUCT_SLUG>-<VERSION>-linux-<ARCH>.tar.gz
```

如果产品名包含中文、空格或特殊字符，文件系统名称应使用 `<PRODUCT_SLUG>`，窗口标题和安装界面仍可使用 `<PRODUCT_NAME>`。

---

## 8. 标准构建流程

无论是 Electron、Tauri、原生应用还是自定义打包工具，正式发布都应按以下顺序执行：

1. 确认版本号、渠道、回滚版本和更新地址。
2. 拉取锁定源码提交 `<GIT_COMMIT>`。
3. 锁定依赖版本。
4. 清理旧构建缓存。
5. 安装依赖。
6. 执行类型检查、单元测试和静态检查。
7. 构建生产产物。
8. 收集生产运行所需的运行时和第三方依赖。
9. 复制静态资源、图标、许可、插件和配置文件。
10. 剔除源码、测试、文档、缓存、调试文件和密钥。
11. 在干净目录中验证生产产物可独立启动。
12. 签名主程序、运行时和安装包。
13. 生成平台安装包。
14. 生成自动更新包和元数据。
15. 校验包内关键文件。
16. 生成 SHA256 校验文件。
17. 在真实设备上完成安装、启动、升级和回滚验收。
18. 上传正式渠道。
19. 更新发布说明和发布记录。

任何步骤失败都必须停止发布。

---

## 9. 生产包必须包含

至少包含：

```text
启动程序
应用主资源
运行所需依赖
图标和品牌资源
版本信息
许可协议
第三方开源许可
更新组件（如需要）
卸载逻辑（如平台需要）
```

如果软件依赖本地服务，还必须包含：

```text
本地服务入口
服务启动配置
端口配置或动态端口策略
服务日志策略
服务异常恢复策略
```

---

## 10. 生产包禁止包含

```text
.git
.env
.env.local
密钥文件
测试账号
调试证书
测试数据
缓存目录
构建中间产物
源码目录
CI 临时文件
本地机器路径
开发者日志
```

例外：

- 示例配置可以包含。
- 公开的分发地址可以包含。
- 空配置模板可以包含。
- 不含敏感值的默认配置可以包含。

---

## 11. 运行时封装规则

### 11.1 Node.js / Electron

- 使用生产模式和 standalone 或等价的裁剪产物。
- 只复制运行时需要的 `node_modules`。
- 原生模块必须与目标平台和架构一致。
- Windows、macOS、Linux 的原生模块必须分别构建或准备。
- 不能把软链接和目标机器不兼容的依赖直接打入安装包。

### 11.2 Python

- 推荐冻结为独立运行时或打包为单文件。
- 明确 Python 版本和依赖锁文件。
- 不得要求用户预装开发环境。
- 本地二进制依赖必须包含目标平台版本。

### 11.3 .NET / Java

- 明确目标运行时版本。
- 自包含发布时不要依赖用户全局运行时。
- 明确 GC、内存和启动参数默认值。

### 11.4 原生应用

- 管理动态库依赖。
- 明确最低系统版本。
- 在目标系统上执行独立启动测试。

---

## 12. 平台封装要求

### 12.1 Windows

建议产物：

```text
NSIS 安装包
Portable 版本
MSI 或企业部署包（如需要）
```

必须验证：

- 安装路径可修改或固定策略明确。
- 是否允许每用户/每机器安装。
- 是否创建桌面快捷方式。
- 是否创建开始菜单入口。
- 卸载是否保留用户数据。
- 自启动、文件关联和协议处理是否正确。
- x64/arm64 架构是否匹配。

### 12.2 macOS

建议产物：

```text
DMG 用于人工安装
ZIP 用于自动更新
PKG 用于企业部署（如需要）
```

必须验证：

- Apple Silicon、Intel 或 Universal 架构。
- Gatekeeper 提示是否符合预期。
- 应用名称、Bundle ID 和版本号正确。
- 是否包含必要的权限描述。
- 是否包含公证票据。
- ZIP 包中的 `.app` 可独立运行。

### 12.3 Linux

建议产物：

```text
AppImage
DEB
RPM
tar.gz
```

必须验证：

- glibc 或运行时兼容范围。
- 桌面入口文件。
- 图标和 MIME 类型。
- 依赖声明和缺失库提示。
- Wayland/X11 兼容性。

---

## 13. 自动更新规范

自动更新至少需要：

```text
版本检查逻辑
更新元数据
更新包下载
完整性校验
安装或替换逻辑
失败回退逻辑
```

标准更新元数据：

```text
Windows: latest.yml
macOS: latest-mac.yml
Linux: latest-linux.yml 或平台等价文件
```

规则：

- 更新元数据必须和安装包同批次生成。
- 更新包必须包含版本号、校验值和下载地址。
- 更新渠道必须隔离。
- 更新失败不能破坏当前已安装版本。
- 重大更新必须支持回滚版本。

---

## 14. 签名规范

### 14.1 Windows

建议：

- 使用 EV 或 OV 代码签名证书。
- 优先使用可信时间戳。
- 签名安装包、主程序和关键 DLL。
- 签名后不得再次修改文件。

### 14.2 macOS

建议顺序：

1. `codesign`
2. `notarytool`
3. `stapler`
4. 验证 Gatekeeper

### 14.3 其他签名

可增加：

- GPG 签名。
- 发布清单签名。
- 私有更新源签名。

如果暂不签名，必须在发布说明中明确系统安全提示和内部安装指引。

---

## 15. 校验规范

正式发布必须生成：

```text
SHA256SUMS.txt
release-manifest.json
```

`SHA256SUMS.txt` 应覆盖：

- 所有安装包。
- 所有更新包。
- 所有更新元数据。
- 所有 blockmap 或增量包。

示例：

```bash
shasum -a 256 *.exe *.dmg *.zip *.AppImage *.deb *.rpm *.yml > SHA256SUMS.txt
```

Windows 可用：

```powershell
Get-FileHash .\* -Algorithm SHA256 | Out-File SHA256SUMS.txt
```

---

## 16. 发布清单 `release-manifest.json`

推荐格式：

```json
{
  "product": "<PRODUCT_NAME>",
  "version": "<VERSION>",
  "buildNumber": "<BUILD_NUMBER>",
  "channel": "<CHANNEL>",
  "gitCommit": "<GIT_COMMIT>",
  "buildTime": "<BUILD_TIME>",
  "owner": "<RELEASE_OWNER>",
  "platforms": ["macos", "windows", "linux"],
  "artifacts": [
    {
      "platform": "macos",
      "arch": "arm64",
      "type": "dmg",
      "file": "MyApp-1.4.2-arm64.dmg",
      "sha256": "..."
    }
  ],
  "updateMetadata": {
    "macos": "latest-mac.yml",
    "windows": "latest.yml"
  },
  "rollbackVersion": "<ROLLBACK_VERSION>",
  "releaseNotes": "RELEASE_NOTES.md"
}
```

---

## 17. 发布门禁

发布前必须确认：

- 版本号已递增。
- 依赖已锁定。
- 类型检查和测试通过。
- 生产构建通过。
- 敏感信息未进入安装包。
- 图标和版本信息正确。
- 运行时可独立启动。
- 安装包命名符合规范。
- 更新元数据与安装包一致。
- 签名和公证已完成，或风险已记录。
- SHA256 清单已生成。
- 发布说明已准备。
- 回滚版本可下载。

任一项失败，禁止发布。

---

## 18. 安装验收清单

每个平台至少一台真实设备：

- 能正常下载安装包。
- 双击可完成安装。
- 首次启动无黑屏、闪退或长时间卡住。
- 主界面可加载。
- 核心业务流程可执行。
- 本地数据可写入和读取。
- 退出重开后数据保留。
- 卸载行为符合策略。
- 自动更新检查可执行。
- 从上一版本升级成功。
- 更新失败时不会破坏旧版本。
- 能从 `<ROLLBACK_VERSION>` 回滚。

---

## 19. 用户数据规范

安装、升级和卸载默认不得直接删除用户数据。

推荐数据目录：

```text
Windows: %APPDATA%/<PRODUCT_NAME>/
macOS: ~/Library/Application Support/<PRODUCT_NAME>/
Linux: ~/.config/<PRODUCT_SLUG>/
```

需要明确区分：

```text
程序文件
用户数据
缓存
日志
数据库
备份
```

卸载时删除用户数据必须单独询问，并提供保留、导出和彻底删除选项。

---

## 20. 日志规范

日志至少包含：

- 版本。
- 平台。
- 架构。
- 启动时间。
- 关键依赖状态。
- 本地服务启动状态。
- 错误堆栈。
- 更新检查结果。
- 更新安装结果。

日志中禁止写入：

- 用户密码。
- 访问令牌。
- 私钥。
- 支付信息。
- 未脱敏的个人信息。

---

## 21. 分发目录规范

推荐：

```text
<UPDATE_URL>/
├── stable/<VERSION>/
├── beta/<VERSION>/
├── dev/<VERSION>/
├── rollback/<ROLLBACK_VERSION>/
├── latest.yml
├── latest-mac.yml
└── SHA256SUMS.txt
```

规则：

- 正式渠道和生产渠道隔离。
- 每个渠道保留最近稳定版本。
- 上传后不得修改同版本文件。
- 发布失败不得覆盖已发布的成功版本。

---

## 22. 回滚规范

触发条件：

- 大面积启动失败。
- 核心流程不可用。
- 数据风险。
- 更新后无法进入应用。
- 严重安全问题。

回滚步骤：

1. 暂停当前版本更新。
2. 切换更新元数据到 `<ROLLBACK_VERSION>`。
3. 保留故障版本用于分析。
4. 通知用户。
5. 收集日志。
6. 完成根因分析。
7. 修复后重新递增版本发布。

禁止覆盖删除故障版本。

---

## 23. 发布结果模板

```markdown
## 发布结果

- 产品：<PRODUCT_NAME>
- 版本：<VERSION>
- 渠道：<CHANNEL>
- 提交：<GIT_COMMIT>
- 发布负责人：<RELEASE_OWNER>
- 结果：成功 / 失败

## 产物

- Windows：
- macOS：
- Linux：
- 更新元数据：
- SHA256：

## 验收

- Windows 安装启动：
- macOS 安装启动：
- Linux 安装启动：
- 升级链路：
- 回滚链路：

## 风险

-

## 回滚

- 回滚版本：<ROLLBACK_VERSION>
- 回滚地址：
```

---

## 24. 通用发布指令模板

发送给执行方或 AI 时使用：

```text
请按 GENERIC_INSTALLER_PACKAGING_SPEC 执行完整发布：

产品名：<PRODUCT_NAME>
版本号：<VERSION>
应用 ID：<APP_ID>
平台：macOS / Windows / Linux
架构：arm64 / x64 / universal
更新渠道：stable / beta / dev
更新地址：<UPDATE_URL>
回滚版本：<ROLLBACK_VERSION>

请完成：
1. 版本和配置检查；
2. 锁定依赖并执行生产构建；
3. 生成平台安装包；
4. 生成更新元数据和 blockmap；
5. 校验包内关键资源；
6. 生成 SHA256SUMS.txt 和 release-manifest.json；
7. 输出产物、验收结果、风险、升级和回滚方案。
```

---

## 25. 使用建议

新项目落地时，建议至少建立以下文件：

```text
release/
scripts/build-<platform>.sh
scripts/verify-release.sh
scripts/checksum.sh
release-manifest.json
RELEASE_NOTES.md
INSTALLER_PACKAGING_SPEC.md
```

把本文件复制到新项目中时，优先替换：

1. 产品名。
2. 应用 ID。
3. 版本管理文件。
4. 安装包构建工具。
5. 平台和架构矩阵。
6. 更新渠道地址。
7. 签名方式。
8. 用户数据目录。
9. 验收设备。

不要直接复制其他产品的安装包配置、签名证书、更新地址或用户数据目录。
