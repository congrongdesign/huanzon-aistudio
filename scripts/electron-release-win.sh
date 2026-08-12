#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "============================================"
echo "  环中AIStudio - Windows 发布包构建"
echo "============================================"

bash ./scripts/electron-prepare-release.sh win

echo "[release] 生成 Windows NSIS 安装包 + 更新元数据..."
rm -rf release/win-unpacked release/*.exe release/*.exe.blockmap release/latest.yml
npx electron-builder --win --x64 --config electron-builder.yml --publish never

echo "[verify] 校验桌面发布产物..."
corepack pnpm run desktop:verify -- --platform win
