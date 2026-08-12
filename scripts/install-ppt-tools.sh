#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools"
INSTALLERS_DIR="$TOOLS_DIR/installers"
MM_DIR="$TOOLS_DIR/micromamba"
POPLER_ENV="$TOOLS_DIR/envs/poppler"
LO_DIR="$TOOLS_DIR/LibreOffice"

LO_VERSION="26.2.3"
LO_FILE="LibreOffice_${LO_VERSION}_MacOS_aarch64.dmg"
LO_URL="https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/${LO_VERSION}/mac/aarch64/${LO_FILE}"
MM_URL="https://micro.mamba.pm/api/micromamba/osx-arm64/latest"

mkdir -p "$INSTALLERS_DIR" "$TOOLS_DIR/envs" "$LO_DIR"

echo "[1/5] 下载 LibreOffice 安装包..."
if [[ ! -s "$INSTALLERS_DIR/$LO_FILE" ]]; then
  curl -L "$LO_URL" -o "$INSTALLERS_DIR/$LO_FILE"
else
  echo "  - 已存在，跳过下载: $INSTALLERS_DIR/$LO_FILE"
fi

echo "[2/5] 安装 LibreOffice 到项目目录 tools/LibreOffice ..."
if [[ ! -x "$LO_DIR/LibreOffice.app/Contents/MacOS/soffice" ]]; then
  MOUNT_OUTPUT="$(hdiutil attach "$INSTALLERS_DIR/$LO_FILE" -nobrowse)"
  MOUNT_PATH="$(echo "$MOUNT_OUTPUT" | awk '/\/Volumes\// {print $NF; exit}')"
  if [[ -z "$MOUNT_PATH" || ! -d "$MOUNT_PATH" ]]; then
    echo "未找到挂载目录，安装失败。"
    exit 1
  fi
  rsync -a "$MOUNT_PATH/LibreOffice.app" "$LO_DIR/"
  hdiutil detach "$MOUNT_PATH" -force >/dev/null 2>&1 || true
else
  echo "  - 已安装，跳过复制"
fi

echo "[3/5] 下载 micromamba ..."
if [[ ! -x "$MM_DIR/bin/micromamba" ]]; then
  mkdir -p "$MM_DIR"
  curl -L "$MM_URL" -o "$INSTALLERS_DIR/micromamba.tar.bz2"
  tar -xjf "$INSTALLERS_DIR/micromamba.tar.bz2" -C "$MM_DIR"
else
  echo "  - 已存在，跳过下载"
fi

echo "[4/5] 安装 Poppler (pdftoppm) 到 tools/envs/poppler ..."
if [[ ! -x "$POPLER_ENV/bin/pdftoppm" ]]; then
  "$MM_DIR/bin/micromamba" create -y -p "$POPLER_ENV" -c conda-forge poppler
else
  echo "  - 已安装，跳过"
fi

echo "[5/5] 验证安装结果"
SOFFICE_BIN="$LO_DIR/LibreOffice.app/Contents/MacOS/soffice"
PDFTOPPM_BIN="$POPLER_ENV/bin/pdftoppm"

if [[ -x "$SOFFICE_BIN" ]]; then
  echo "  - LibreOffice: $SOFFICE_BIN"
  "$SOFFICE_BIN" --version || true
else
  echo "  - LibreOffice 安装失败"
  exit 1
fi

if [[ -x "$PDFTOPPM_BIN" ]]; then
  echo "  - pdftoppm: $PDFTOPPM_BIN"
  "$PDFTOPPM_BIN" -v 2>&1 | head -n 1 || true
else
  echo "  - Poppler 安装失败"
  exit 1
fi

echo ""
echo "安装完成。PPT 上传拆页已可直接使用。"
