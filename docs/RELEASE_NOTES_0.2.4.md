# 环中AIStudio v0.2.4 · ring1 内部验证版

本版统一发布近期功能更新，并提供 Windows 同事可交给 Codex 执行的安装升级与兼容排查包。

- 提示词、字体、案例三库支持图片后台导入、分类整理与任务管理；提示词从历史记录收录，并作为独立资产保存。
- 提示词、字体及案例支持 .hzlib 资源包预览、导入导出、图片携带、重复识别与本地修改保护。
- 字体作品可交给已安装的 Illustrator 描摹；改善字体卡片、案例详情与应用到画布的交互。
- 简化模型配置，改善画布排列和连线显示，完善 NAS 断线恢复及备份位置识别。
- 修复 Windows 主 EXE 内嵌 Electron 默认图标，统一主程序、窗口与任务栏身份；安装包包含 sharp 与 SQLite Windows x64 原生依赖。导入队列使用标准 file URL，兼容 Windows 盘符和中文/空格路径。
- 随包提供提示词、字体设计两个采集 Skill 与中文用法；只安装应用也能通过 .hzlib 入库，不依赖软件源码。

## 升级与数据

沿用固定 appId、NSIS guid、当前用户和原安装目录。升级保留本机项目、图片、提示词、字体资产、草稿、中转站 API 与自定义存储路径。不要先卸载或删除用户目录。附件中的 Codex 指令要求升级前正常退出、建立小型数据恢复点，升级后核对原数据与 API；不携带发布者私有配置。

新机没有旧 API 配置时仍需由接收者正常配置自己的中转站。本版不会把发布者的密钥发给同事。

## 验证与范围

类型检查、lint、Electron 编译、双平台成品校验通过；数据升级保留、字体/图片导入队列、三库资源包、提示词历史与完整性、模型配置、NAS 恢复、画布排列等隔离回归通过。两个 Skill 的共享包生成、中文来源、导入与重复跳过已隔离验证。

macOS 已原地更新 `/Applications/环中AIStudio.app`，检查实际窗口、库与配置并正常重开。Windows 已从 setup 和 portable 成品提取主 EXE，核对全部 16/24/32/48/64/128/256 图标和 0.2.4 产品信息，两份主程序 SHA256 一致。

**未在 Windows 实机安装/升级、固定任务栏图标或 100%/150%/200% DPI 验收。**本次为 ring1 预发布，保留当前稳定 Latest，不推给稳定自动更新用户。同事按 CODEX_WINDOWS_INSTALL.md 在自己的设备完成最终验收。未发起付费生成或付费智能整理。

平台：Windows 10/11 x64；macOS Apple Silicon arm64。未提供 Windows 32位、原生 ARM64、mac Intel 或 Linux 包。未做商业代码签名，系统可能要求人类确认。Illustrator/PPT 等可选功能依赖对应外部工具，需按使用需求单独核验。

## 下载与回滚

Windows 安装版优先使用 `AIStudio-0.2.4-win-x64-setup.exe`；便携版用于明确需要免安装的情况，避免和安装版同时运行。安装调试压缩包中同时包含两个 Skill、说明与校验清单。

回滚程序参考：https://github.com/congrongdesign/huanzon-aistudio/releases/tag/v0.2.3 （上一内部版）；上一稳定版：https://github.com/congrongdesign/huanzon-aistudio/releases/tag/v0.2.2 。回滚前正常退出并保留新版数据，先在恢复点副本验证旧版是否识别新字段，不能让旧版写入唯一的新数据库。
