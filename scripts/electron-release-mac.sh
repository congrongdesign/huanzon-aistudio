#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "============================================"
echo "  环中AIStudio - macOS 发布包构建"
echo "============================================"

bash ./scripts/electron-prepare-release.sh mac

echo "[release] 生成 macOS DMG + ZIP 更新包..."
rm -rf release/mac-arm64 release/mac-x64 release/*.dmg release/*.zip release/latest-mac.yml
CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}" npx electron-builder --mac --config electron-builder.yml --config.electronDist=node_modules/electron/dist --publish never

echo "[verify] 校验桌面发布产物..."
corepack pnpm run desktop:verify -- --platform mac
