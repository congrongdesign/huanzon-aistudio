#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="${ROOT_DIR}/tools"
INSTALLERS_DIR="${TOOLS_DIR}/installers"
MM_DIR="${TOOLS_DIR}/micromamba-linux"
ENV_DIR="${TOOLS_DIR}/cloud-doc-tools"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

mkdir -p "${INSTALLERS_DIR}" "${TOOLS_DIR}"

if [[ "${PLATFORM}" != "linux" ]]; then
  echo "Cloud doc tools installer is intended for Linux deploy environments. Current: ${PLATFORM}. Skipping."
  exit 0
fi

case "${ARCH}" in
  x86_64|amd64) MM_PLATFORM="linux-64" ;;
  aarch64|arm64) MM_PLATFORM="linux-aarch64" ;;
  *) echo "Unsupported Linux architecture for micromamba: ${ARCH}" >&2; exit 1 ;;
esac

MM_URL="https://micro.mamba.pm/api/micromamba/${MM_PLATFORM}/latest"
MM_TARBALL="${INSTALLERS_DIR}/micromamba-${MM_PLATFORM}.tar.bz2"

if [[ ! -x "${MM_DIR}/bin/micromamba" ]]; then
  echo "Downloading micromamba (${MM_PLATFORM})..."
  mkdir -p "${MM_DIR}"
  curl -L --retry 3 --connect-timeout 20 "${MM_URL}" -o "${MM_TARBALL}"
  tar -xjf "${MM_TARBALL}" -C "${MM_DIR}"
fi

if [[ ! -x "${ENV_DIR}/bin/soffice" || ! -x "${ENV_DIR}/bin/pdftoppm" ]]; then
  echo "Installing LibreOffice and Poppler into ${ENV_DIR}..."
  "${MM_DIR}/bin/micromamba" create -y -p "${ENV_DIR}" -c conda-forge libreoffice poppler
else
  echo "LibreOffice and Poppler already installed in ${ENV_DIR}."
fi

echo "Verifying document tools..."
"${ENV_DIR}/bin/soffice" --version || true
"${ENV_DIR}/bin/pdftoppm" -v 2>&1 | head -n 1 || true
