#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_BACKUP_DIR="${ROOT_DIR}-tools-build-excluded"
APP_NAME="环中AIStudio"
APP_DIR="${ROOT_DIR}/release/${APP_NAME}.app"
DMG_PATH="${ROOT_DIR}/release/${APP_NAME}-0.1.1-arm64.dmg"
DMG_STAGE="${ROOT_DIR}/release/.dmg-stage"
ASAR_STAGE="${ROOT_DIR}/release/.asar-stage"

restore_tools() {
  if [[ -d "$TOOLS_BACKUP_DIR" && ! -e "$ROOT_DIR/tools" ]]; then
    mv "$TOOLS_BACKUP_DIR" "$ROOT_DIR/tools"
  fi
}

cleanup() {
  restore_tools
  rm -rf "$DMG_STAGE" "$ASAR_STAGE"
}

trap cleanup EXIT

echo "============================================"
echo "  环中AIStudio - macOS 安装包打包"
echo "============================================"

cd "$ROOT_DIR"

echo "[1/6] 构建 Next.js standalone..."
if [[ -d tools ]]; then
  rm -rf "$TOOLS_BACKUP_DIR"
  mv tools "$TOOLS_BACKUP_DIR"
fi
rm -rf .next
corepack pnpm next build
restore_tools

echo "[2/6] 准备 standalone 资源..."
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static .next/standalone/public
cp -R .next/static .next/standalone/.next/static
cp -R public .next/standalone/public
rm -rf \
  .next/standalone/.codex \
  .next/standalone/.coze \
  .next/standalone/.cozeproj \
  .next/standalone/.git \
  .next/standalone/.next/cache \
  .next/standalone/.playwright-cli \
  .next/standalone/docs \
  .next/standalone/electron \
  .next/standalone/output \
  .next/standalone/release \
  .next/standalone/src \
  .next/standalone/tools
find .next/standalone -maxdepth 1 -type f \( \
  -name '.env.local' -o \
  -name 'AGENTS.md' -o \
  -name 'DESIGN.md' -o \
  -name 'DESKTOP_PACKAGE_GUIDE.md' -o \
  -name 'LOCAL_MODE_README.md' -o \
  -name 'README.md' -o \
  -name 'components.json' -o \
  -name 'electron-builder.yml' -o \
  -name 'eslint.config.mjs' -o \
  -name 'next.config.ts' -o \
  -name 'pnpm-lock.yaml' -o \
  -name 'postcss.config.mjs' -o \
  -name 'tsconfig.json' -o \
  -name 'tsconfig.tsbuildinfo' \
\) -delete

echo "[3/6] 编译 Electron 主进程..."
npx tsc -p electron/tsconfig.json

echo "[4/6] 组装 macOS 应用..."
rm -rf release/mac-arm64 "$APP_DIR"
mkdir -p release
cp -R node_modules/electron/dist/Electron.app "$APP_DIR"

/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.huanzon.aistudio" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon.icns" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Electron" "$APP_DIR/Contents/Info.plist"

rm -f "$APP_DIR/Contents/Resources/app.asar"
mkdir -p "$ASAR_STAGE/electron"
cp -R electron/dist "$ASAR_STAGE/electron/dist"
cp package.json "$ASAR_STAGE/package.json"
npx asar pack "$ASAR_STAGE" "$APP_DIR/Contents/Resources/app.asar"

rm -rf "$APP_DIR/Contents/Resources/standalone"
cp -R .next/standalone "$APP_DIR/Contents/Resources/standalone"
cp electron/icon.icns "$APP_DIR/Contents/Resources/icon.icns"
cp electron/icon.png "$APP_DIR/Contents/Resources/icon.png"

echo "[5/6] 创建 DMG..."
rm -rf "$DMG_STAGE" "$DMG_PATH"
mkdir -p "$DMG_STAGE"
cp -R "$APP_DIR" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH" >/dev/null

echo "[6/6] 完成"
ls -lh "$APP_DIR" "$DMG_PATH"
