# v0.2.4 发布验收

发布：ring1，负责人 HuanZon / Codex；版本 0.2.4，回滚参考上一内部版 0.2.3，稳定 Latest 保持 0.2.2。

- `desktop:preflight:strict -- --ring ring1 --rollback 0.2.3` 通过。
- frozen pnpm install、validate（TypeScript/lint）、Electron tsc、mac/win release 与双平台 desktop:verify 通过。
- desktop-upgrade、image-export、font-creation、font-library、library-import、library-transfer、model-settings、prompt-history、prompt-integrity、backup-reconnection、project-backups、canvas-arrangement、canvas-nearby-placement、canvas-edge-presentation、case-composer、composer-recall 回归通过；使用隔离目录与模拟模型请求。
- Windows setup/portable 提取主 EXE，SHA256 均为 `e1290c72a39bd5b6378a8ad110aab1afbe5a1869f357b4f42c4f6e7b626eec04`，全部图标组的 16/24/32/48/64/128/256 图片字节与发布 ICO 一致，ProductName 环中AIStudio、CompanyName HuanZon、ProductVersion 0.2.4。
- 检查 Windows sharp/libvips、SQLite PE x64 模块与两个 worker；运行目录无软链接；窗口/任务栏 appId、ICO 和 portable 外层重启命令已编译。
- 两个 Skill 结构验证与生成 .hzlib → 应用解析/预览/导入/重复跳过的隔离测试通过，中文标题及来源保留。无发布者密钥和真实数据库。
- macOS 原地更新 `/Applications/环中AIStudio.app`，临时签名并严格验证；实际服务加载其 Contents/Resources/standalone，日志版本0.2.4。正常退出并重开后画布可读，提示词253条、字体92件；项目5个、图片记录80条；两项中转站、激活模型与本机配置保留。六项 API/服务/草稿相关 localStorage 项逐值一致，desktop-settings 与 runtime-config 字节一致。未做付费调用。
- 实际桌面 1440×972 画布、提示词库、字体库及模型配置入口检查通过，图片正常加载；离屏懒加载不计为损坏。未执行真实数据删除或重置。Windows 原生窗口、安装升级链路、固定图标与100/150/200%缩放待同事设备最终验收。

仅将此版作为预发布分发。软件中的 AI 生图、对话、智能整理及外部 Illustrator/PPT 工具需按实际环境另行验收；本报告不声称这些计费或外部依赖操作均已真机执行。
