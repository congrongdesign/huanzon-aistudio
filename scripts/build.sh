#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
else
  PNPM_BIN="corepack pnpm"
fi

echo "Installing dependencies..."
${PNPM_BIN} install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

if [[ "${INSTALL_DOC_TOOLS:-0}" == "1" ]]; then
  echo "Installing optional LibreOffice/Poppler document tools..."
  bash ./scripts/install-cloud-doc-tools.sh
else
  echo "Skipping optional document tools install (set INSTALL_DOC_TOOLS=1 to enable)."
fi

echo "Building the Next.js project..."
${PNPM_BIN} next build

echo "Bundling server with tsup..."
${PNPM_BIN} tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
