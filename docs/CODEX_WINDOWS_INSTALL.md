# 环中AIStudio v0.2.4：交给 Codex 的 Windows 安装升级指令

把本文件、`AIStudio-0.2.4-win-x64-setup.exe`、`SHA256SUMS.txt` 和 `Install-AIStudio.ps1` 一起交给同事电脑上的 Codex，并发送：

> 请读取附件中的 CODEX_WINDOWS_INSTALL.md，执行环中AIStudio安装或原地升级，保留我的全部作品与中转站 API 配置。先核实机器、安装包校验值和已有安装，再完成安装、启动与无付费诊断；遇到兼容问题继续排查并修复，最后告诉我真实验证结果。不要删除用户目录，不要让我重新填写已经保存的 API，不要发起付费生成。

以下内容是给执行安装的 Codex 的具体要求。

## 目标与边界

- 安装 v0.2.4，Windows 10/11 x64；ARM64 Windows 只能在系统支持 x64 仿真时尝试，须标注未原生支持。32 位 Windows、Windows 7/8 不适用。
- 本包自带 Electron/Node 和服务端依赖，不要求同事安装 Node、Python、pnpm 或源码。PPT 渲染等可选外部工具若缺失，应单独说明并按功能需要处理，不能把主界面可用当作所有可选工具均验收通过。
- 本包未做商业代码签名。核对来源及 SHA256 后，如果 SmartScreen/UAC 要求人类操作，说明原因并等用户操作。不得关闭杀毒、防火墙或系统安全机制，不得自行绕过组织策略。
- 不执行卸载清数据、清浏览器存储、重置应用、删除 `%APPDATA%`、覆盖数据库、初始化空库、导入发布者账号或密钥。不要把 API Key、聊天、作品及配置文件上传 GitHub 或贴在回复里。
- 沿用当前 Windows 账号、原安装模式和数据目录。不要改成另一个管理员账号运行；不要同时启动便携版和安装版。

## 执行顺序

1. 查实际系统版本、架构、磁盘余量、已有快捷方式和卸载注册表。检查 `%APPDATA%\环中AIStudio`，以及旧版 `%APPDATA%\projects`。若使用自定义 `LOCAL_DATA_DIR`，同时检查该目录和启动器环境变量。禁止直接假设某个空目录是原数据目录。
2. 校验安装包的 SHA256：优先使用从发布页面独立取得的 SHA256SUMS.txt。本次发布页面：<https://github.com/congrongdesign/huanzon-aistudio/releases/tag/v0.2.4>。附件缺少校验文件时可以从该页面下载，无法验证时先报告，不能宣称已验证。
3. 读取正在运行的软件窗口；检查生成、字体任务、导入、下载、备份、恢复是否进行中。保存未发送输入与未保存配置。任务尚未安全完成时等待，不要强杀。正常退出环中AIStudio。
4. 在原用户目录以外建立一份本次升级恢复点：复制现存 `local-data\db.json`、`local-data\provider-profiles.json`、`runtime-config.json`、`desktop-settings.json`、`.env.local`、`Local Storage`、`Preferences`、字体/提示词/案例/项目备份索引 JSON，以及 library-import 下的 queue.db 和同目录 -wal/-shm 文件（必须在正常退出后成套复制），记录外部图片库和 NAS 路径。不要复制整套软件或海量原图。恢复点只在本机存放，包含敏感配置，不要上传。保留已有原图、项目包和 NAS 备份。
5. 运行同目录 `Install-AIStudio.ps1` 时使用 `-Installer` 指定 setup 包，`-Checksums` 指定校验清单。脚本只负责校验、普通安装和启动，**不会代替你检查任务、保存输入或建立恢复点**。也可直接运行经校验的安装包，保持原安装路径与每用户安装模式，不要先卸载。便携版仅用于明确需要免安装的情况。
6. 启动实际安装路径中的 `环中AIStudio.exe`。确认窗口正常且日志记录 `appVersion=0.2.4`、`platform=win32`、`arch=x64`、standalone 实际加载路径及本地端口。不要使用开发网页或另一个旧快捷方式代替验证。
7. 无损检查：旧画板数量和代表图片、字体与提示词资产；“设置 / 中转站”原有配置与激活模型；中文用户名、含空格路径；关闭重开后配置仍在；Ctrl 快捷键、文件选择与窗口缩放正常。可使用无计费的模型列表查询核查连接；不得提交生图、对话、字体生成或其他付费任务，除非用户另行授权。
8. 若升级后内容看似空白，先停止写入，比较当前/旧版/自定义数据目录和启动日志。找回原目录及原 Chromium Local Storage，恢复副本中**缺失的文件**；不要用空数据库或空中转站列表覆盖原件，不要在多个已有数据库间自动合并。无法确认哪份是原数据时，说明现有候选项并请求用户选择。
9. 如需回滚程序，旧安装包在 <https://github.com/congrongdesign/huanzon-aistudio/releases/tag/v0.2.3>。先正常退出，保留 v0.2.4 数据；旧版可能不认识新字段，必要时使用升级前的恢复点另行验证，不能直接让旧版写入唯一一份新数据。

## 常见兼容问题

| 现象 | 排查与处理 |
| --- | --- |
| Local service did not respond / 黑屏 | 先读 `%APPDATA%\环中AIStudio\desktop.log` 的本次启动段，查 server.js、BUILD_ID、Windows sharp 原生文件；查端口 5000–5009 和防护软件隔离记录，不要结束不属于本应用的进程。 |
| 首次启动慢 | 正常退出后可在本次启动进程设置 `DESKTOP_SERVER_TIMEOUT_MS=180000`，不覆盖全局环境；继续观察日志。 |
| 127.0.0.1 无法连接 | 使用日志中的实际端口和 IPv4 URL；检查代理是否把回环地址转发出去，必要时仅为该应用/进程设置回环绕过，保留原代理配置。 |
| sharp / DLL 缺失 | 核查包内 `resources\standalone\node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64.node` 与 `sharp-libvips-win32-x64\lib`；缺失时重装经过校验的同版包；明确报出 VC++ DLL 缺失时从 Microsoft 官方安装对应 x64 运行库。 |
| 白屏且 GPU 报错 | 先留日志，可针对本次启动传 `--disable-gpu` 验证，只有有效后才为该应用快捷方式保留参数；不要删除数据缓存目录来“修复”。 |
| API 看似丢失 | 核查 Windows 账号、`userData`、`local-data\provider-profiles.json`、`desktop-settings.json`、旧版 `projects` 目录及旧 localhost origin。当前版本连接设置还会在 userData 中保存独立快照。 |
| 图片库或 NAS 离线 | 保留原路径，检查盘符/UNC 路径、凭据与连接；不要把临时不可达当作素材被删除，不要执行存储清理。 |

执行完给用户简短报告：安装版本和实际 exe 路径、原数据与配置是否保留、启动及重开结果、已处理的兼容问题、未验证项、恢复点位置。仅凭文件存在不能宣称安装成功；必须看到实际窗口可用。

## 验收范围

发布者在 macOS 构建此 Windows x64 包并检查了包结构、原生依赖、校验值及隔离数据保留测试。发布者没有 Windows 实机，本文件用于同事电脑上的最终安装升级验收；不得声称所有 Windows 环境已验证。

## v0.2.4 专项验收

- 检查主程序文件属性为环中AIStudio / HuanZon / 0.2.4；检查快捷方式、任务栏、Alt+Tab、悬停、固定后重开图标，以及 100%/150%/200% 缩放。若旧固定项缓存旧图标，确认新 EXE 正确后取消旧固定并重新固定。
- Windows 包包含 sharp 与 @libsql/win32-x64-msvc 原生运行库；图片导入队列使用正确 file URL。图片智能整理可能调用付费模型，安装验收不要提交新整理任务。
- Illustrator 描摹是可选功能，需要已安装兼容的 Adobe Illustrator；缺失不阻塞主程序使用。
- 两个采集 Skill 和使用说明在随包 Skills 目录；.hzlib 共享包预览/导入不发起 AI 调用。
