# 环中AIStudio v0.2.3

本次同步当前本机使用的完整源码：画布与对话交互、字体库与字体创作、提示词资产、项目/NAS 备份、储存管理、图片导出与生成队列等近期改进。

- Windows 10/11 x64：`AIStudio-0.2.3-win-x64-setup.exe`，建议已有用户使用安装版原地升级。
- Windows x64 便携版：`AIStudio-0.2.3-win-x64-portable.exe`。
- macOS Apple Silicon：`AIStudio-0.2.3-arm64.dmg`；ZIP 用于更新。
- 同事安装时，把 `CODEX_WINDOWS_INSTALL.md`、`Install-AIStudio.ps1`、`SHA256SUMS.txt` 和 setup 包交给其电脑上的 Codex。

升级保留原用户目录、数据库、原图、字体、提示词、中转站 API 与路径配置。固定应用标识、NSIS 升级标识和数据目录，卸载不主动删除用户数据；增加连接设置在 userData 中的独立快照，减少本地端口变化造成的配置丢失，并防止重复开启实例。已有用户应使用原 Windows 账号和安装模式覆盖升级，不必先卸载或重填密钥。全新电脑没有旧配置时仍需首次配置。

打包流程补齐后台备份组件及 Windows x64 图片依赖，物化软链接，排除开发者环境文件、数据及工具目录；更新地址改为本 GitHub Releases。旧版占位更新源不会自动改变，v0.2.2 用户需要手动安装本版一次。

验证：生产构建、TypeScript、Lint（零错误，现有 warnings 保留）、双平台包结构、SHA512 元数据、隔离升级数据、图片导出、项目备份、存储管理/生命周期、生成队列通过。macOS 已更新 `/Applications/环中AIStudio.app` 并检查实际窗口、旧画板/图片、已配置中转站与草稿保留；未调用付费生成。

Windows 包在 macOS 交叉构建，已验证 PE x64 原生依赖、包内资源与无软链接；**尚未在 Windows 实机安装、重开及旧版升级验收**，须由同事电脑上的 Codex 按附带指令完成。该版本属于 ring1 内部验证分发。安装包未商业签名/公证，可能触发 SmartScreen/Gatekeeper，须确认来源后按系统提示操作。PPT 等可选外部工具不包含在主程序验收范围。

回滚参考：[v0.2.2](https://github.com/congrongdesign/huanzon-aistudio/releases/tag/v0.2.2)。回滚前保留本机恢复点；不要让旧版覆盖唯一的新格式数据。校验值见随附 SHA256SUMS.txt。
