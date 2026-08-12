#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_BACKUP_DIR="${ROOT_DIR}-tools-build-excluded"
TARGET_PLATFORM="${1:-mac}"

restore_tools() {
  if [[ -d "$TOOLS_BACKUP_DIR" && ! -e "$ROOT_DIR/tools" ]]; then
    mv "$TOOLS_BACKUP_DIR" "$ROOT_DIR/tools"
  fi
}

cleanup() {
  restore_tools
}

trap cleanup EXIT

cd "$ROOT_DIR"

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

if [[ "$TARGET_PLATFORM" != "mac" && "$TARGET_PLATFORM" != "win" ]]; then
  echo "Usage: $0 [mac|win]" >&2
  exit 1
fi

echo "[1/7] 安装依赖..."
corepack pnpm install

if [[ "$TARGET_PLATFORM" == "win" ]]; then
  echo "[2/7] 准备 Windows sharp 运行依赖..."
  corepack pnpm add -D @img/sharp-win32-x64@0.34.5 @img/sharp-libvips-win32-x64@1.2.4 \
    --config.supportedArchitectures.cpu=x64 \
    --config.supportedArchitectures.os=win32 \
    --config.supportedArchitectures.libc=glibc
else
  echo "[2/7] macOS 运行依赖使用当前平台依赖..."
fi

echo "[3/7] 生成桌面图标..."
corepack pnpm run desktop:icons

echo "[4/7] 准备 electron-updater 运行依赖..."
corepack pnpm run desktop:prepare-updater

echo "[5/7] 构建 Next.js standalone..."
if [[ -d tools ]]; then
  rm -rf "$TOOLS_BACKUP_DIR"
  mv tools "$TOOLS_BACKUP_DIR"
fi
rm -rf .next
corepack pnpm next build
restore_tools

echo "[6/7] 清理和补齐 standalone 资源..."
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

if [[ "$TARGET_PLATFORM" == "win" ]]; then
  echo "[6b/7] 物化 Windows standalone 运行依赖..."
  for pkg in "@img+sharp-win32-x64@0.34.5" "@img+sharp-libvips-win32-x64@1.2.4"; do
    rm -rf ".next/standalone/node_modules/.pnpm/$pkg"
    cp -R "node_modules/.pnpm/$pkg" ".next/standalone/node_modules/.pnpm/$pkg"
  done

  mkdir -p \
    .next/standalone/node_modules/@img \
    .next/standalone/node_modules/.pnpm/node_modules/@img \
    .next/standalone/node_modules/.pnpm/sharp@0.34.5/node_modules/@img

  ln -sfn "../../../@img+sharp-win32-x64@0.34.5/node_modules/@img/sharp-win32-x64" \
    ".next/standalone/node_modules/.pnpm/sharp@0.34.5/node_modules/@img/sharp-win32-x64"
  ln -sfn "../../../@img+sharp-libvips-win32-x64@1.2.4/node_modules/@img/sharp-libvips-win32-x64" \
    ".next/standalone/node_modules/.pnpm/sharp@0.34.5/node_modules/@img/sharp-libvips-win32-x64"
  ln -sfn "../../@img+sharp-win32-x64@0.34.5/node_modules/@img/sharp-win32-x64" \
    ".next/standalone/node_modules/.pnpm/node_modules/@img/sharp-win32-x64"
  ln -sfn "../../@img+sharp-libvips-win32-x64@1.2.4/node_modules/@img/sharp-libvips-win32-x64" \
    ".next/standalone/node_modules/.pnpm/node_modules/@img/sharp-libvips-win32-x64"
  ln -sfn "../.pnpm/@img+sharp-win32-x64@0.34.5/node_modules/@img/sharp-win32-x64" \
    ".next/standalone/node_modules/@img/sharp-win32-x64"
  ln -sfn "../.pnpm/@img+sharp-libvips-win32-x64@1.2.4/node_modules/@img/sharp-libvips-win32-x64" \
    ".next/standalone/node_modules/@img/sharp-libvips-win32-x64"

  rm -rf .next/standalone-win
  mkdir -p .next/standalone-win
  cp -aL .next/standalone/. .next/standalone-win/

  source_dir=".next/standalone-win/node_modules/.pnpm/node_modules"
  target_dir=".next/standalone-win/node_modules"
  if [[ -d "$source_dir" ]]; then
    for entry in "$source_dir"/*; do
      [[ -e "$entry" ]] || continue
      name="$(basename "$entry")"
      if [[ "$name" == @* && -d "$entry" ]]; then
        mkdir -p "$target_dir/$name"
        for scoped_entry in "$entry"/*; do
          [[ -e "$scoped_entry" ]] || continue
          scoped_name="$(basename "$scoped_entry")"
          rm -rf "$target_dir/$name/$scoped_name"
          cp -R "$scoped_entry" "$target_dir/$name/$scoped_name"
        done
      else
        rm -rf "$target_dir/$name"
        cp -R "$entry" "$target_dir/$name"
      fi
    done
  fi

  remaining_links="$(find .next/standalone-win -type l | wc -l | tr -d ' ')"
  if [[ "$remaining_links" != "0" ]]; then
    echo "错误: Windows standalone 仍包含 $remaining_links 个软链接" >&2
    find .next/standalone-win -type l | head -40 >&2
    exit 1
  fi
fi

echo "[7/7] 编译 Electron 主进程..."
npx tsc -p electron/tsconfig.json
