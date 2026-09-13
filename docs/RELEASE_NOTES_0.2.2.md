# 环中AIStudio v0.2.2

## GPT Image 2.5 接口更新

- 新增 `gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`
- `gpt-image-2.5` 支持比例或 1K 像素，质量使用 `auto`
- Flare / Sunburst 支持 1K、2K、4K 像素分辨率
- Flare 支持 `low`、`medium`、`high` 质量
- Sunburst 支持 `low`、`medium`、`high`、`xhigh`、`max` 质量
- VIP / Flare / Sunburst 支持透明背景参数
- 原有 `gpt-image-2-vip` 保持像素分辨率模式，并默认使用 `medium` 质量

## 修复

- 修正新版 GRSAI 图像模型的质量、背景和分辨率参数提交
- 已有用户检测模型后会自动补充 image2.5 常用模型入口
- 增加 Windows/macOS 桌面构建所需 pnpm 构建脚本白名单，避免安装阶段跳过 Electron、sharp 等原生依赖

## 安装

- macOS Apple Silicon：`环中AIStudio-0.2.2-arm64.dmg`
- Windows x64：`环中AIStudio-0.2.2-win-x64-setup.exe`
- Windows x64 免安装：`环中AIStudio-0.2.2-win-x64-portable.exe`

未签名安装包可能触发 macOS Gatekeeper 或 Windows SmartScreen 提示。
