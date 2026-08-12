#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_BACKUP_DIR="${ROOT_DIR}-tools-build-excluded"

restore_tools() {
  if [[ -d "$TOOLS_BACKUP_DIR" && ! -e "$ROOT_DIR/tools" ]]; then
    mv "$TOOLS_BACKUP_DIR" "$ROOT_DIR/tools"
  fi
}

trap restore_tools EXIT

echo "============================================"
echo "  环中AIStudio - Windows 桌面安装包打包"
echo "============================================"

cd "$ROOT_DIR"

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

echo "[1/7] 安装依赖..."
corepack pnpm install

echo "[2/7] 准备 Windows 图片处理依赖..."
corepack pnpm add -D @img/sharp-win32-x64@0.34.5 @img/sharp-libvips-win32-x64@1.2.4 \
  --config.supportedArchitectures.cpu=x64 \
  --config.supportedArchitectures.os=win32 \
  --config.supportedArchitectures.libc=glibc

echo "[3/7] 临时移出本机 LibreOffice/Poppler 工具目录..."
if [[ -d tools ]]; then
  rm -rf "$TOOLS_BACKUP_DIR"
  mv tools "$TOOLS_BACKUP_DIR"
fi

echo "[4/7] 构建 Next.js standalone..."
rm -rf .next
corepack pnpm next build
restore_tools

echo "[5/7] 复制 static/public 和 Windows sharp 运行依赖..."
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

if [[ ! -f electron/icon.ico ]]; then
  echo "生成 Windows icon.ico..."
  ICONSET="electron/icon.iconset"
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256; do
    sips -z "$size" "$size" electron/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  done
  node <<'NODE'
const fs = require('fs');
const path = require('path');
const sizes = [16, 32, 64, 128, 256];
const images = sizes.map((size) => ({
  size,
  data: fs.readFileSync(path.join('electron', 'icon.iconset', `icon_${size}x${size}.png`)),
}));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
fs.writeFileSync(path.join('electron', 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
NODE
fi

echo "[6/7] 编译 Electron 主进程..."
npx tsc -p electron/tsconfig.json

echo "[7/7] 生成 Windows 安装包..."
rm -rf release
rm -rf .next/standalone-win
mkdir -p .next/standalone-win
cp -aL .next/standalone/. .next/standalone-win/

# pnpm stores some runtime packages behind links inside .pnpm/node_modules.
# Windows installers cannot use the macOS links reliably, so materialize them.
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
  echo "错误: Windows standalone 仍包含 $remaining_links 个软链接"
  exit 1
fi

npx electron-builder --win --x64 --config electron-builder.yml

echo ""
echo "============================================"
echo "  打包完成"
echo "  安装包目录: $ROOT_DIR/release"
echo "============================================"
ls -lh release
