#!/bin/bash
# ============================================================
# 环中AIStudio 桌面安装包 - 本地构建指南
# ============================================================
#
# 前置要求：
#   - Node.js 18+ 
#   - pnpm (npm install -g pnpm)
#   - Git
#   - Windows: 无额外依赖
#   - macOS: 无额外依赖
#   - Linux: sudo apt install libgtk-3-dev libxcb-dri3-0 libgbm1 libnss3 libatk-bridge2.0-0 libasound2
#
# 使用步骤：
#   1. 克隆项目到本地
#   2. 进入项目目录
#   3. 执行: bash scripts/desktop-build.sh
#   4. 安装包输出到 release/ 目录
#
# ============================================================

set -e

echo "========================================="
echo "  环中AIStudio 桌面安装包构建"
echo "========================================="

# 1. 安装项目依赖
echo ""
echo "[1/5] 安装项目依赖..."
pnpm install

# 2. 安装 Electron 开发依赖
echo ""
echo "[2/5] 安装 Electron 依赖..."
pnpm add -D electron@latest electron-builder@latest

# 3. 构建 Next.js standalone
echo ""
echo "[3/5] 构建 Next.js..."
pnpm next build

# 复制静态资源到 standalone 目录
echo "复制静态资源..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || mkdir -p .next/standalone/public

# 4. 编译 Electron 主进程
echo ""
echo "[4/5] 编译 Electron 主进程..."
npx tsc -p electron/tsconfig.json

# 5. 打包安装程序
echo ""
echo "[5/5] 打包安装程序..."
npx electron-builder --config electron-builder.yml

echo ""
echo "========================================="
echo "  构建完成！"
echo "  安装包位置: release/"
echo ""
echo "  Windows: release/环中AIStudio Setup x.x.x.exe"
echo "  macOS:   release/环中AIStudio-x.x.x.dmg"
echo "  Linux:   release/环中AIStudio-x.x.x.AppImage"
echo "========================================="
