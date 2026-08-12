#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/coze-deploy-kit/dist"
STAGE_DIR="${OUT_DIR}/ai-platform-coze-upload"
ZIP_PATH="${OUT_DIR}/ai-platform-coze-upload.zip"

mkdir -p "${OUT_DIR}"
rm -rf "${STAGE_DIR}" "${ZIP_PATH}"
mkdir -p "${STAGE_DIR}"

cd "${ROOT_DIR}"

copy_file() {
  local src="$1"
  if [[ -f "${src}" ]]; then
    mkdir -p "${STAGE_DIR}/$(dirname "${src}")"
    cp "${src}" "${STAGE_DIR}/${src}"
  fi
}

copy_dir() {
  local src="$1"
  if [[ -d "${src}" ]]; then
    mkdir -p "${STAGE_DIR}/$(dirname "${src}")"
    rsync -a --delete \
      --exclude 'dist/' \
      --exclude '.DS_Store' \
      --exclude '*backup*' \
      --exclude '*broken*' \
      --exclude '*.bak' \
      "${src}/" "${STAGE_DIR}/${src}/"
  fi
}

# Root config and lockfiles required by Coze/Next/pnpm.
for file in \
  .coze \
  .babelrc \
  .npmrc \
  .gitignore \
  AGENTS.md \
  README.md \
  components.json \
  eslint.config.mjs \
  next-env.d.ts \
  next.config.ts \
  package.json \
  pnpm-lock.yaml \
  postcss.config.mjs \
  tsconfig.json; do
  copy_file "${file}"
done

# Application source and public assets.
for dir in src public scripts assets coze-deploy-kit; do
  copy_dir "${dir}"
done

# Remove anything unsafe if it appears through future changes.
find "${STAGE_DIR}" \( \
  -name '.env' -o \
  -name '.env.*' -o \
  -name '.DS_Store' -o \
  -name '*backup*' -o \
  -name '*broken*' -o \
  -name '*.bak' \
\) | while read -r path; do rm -rf "${path}"; done
rm -rf \
  "${STAGE_DIR}/node_modules" \
  "${STAGE_DIR}/.next" \
  "${STAGE_DIR}/.git" \
  "${STAGE_DIR}/release" \
  "${STAGE_DIR}/output" \
  "${STAGE_DIR}/.desktop-runtime" \
  "${STAGE_DIR}/.playwright-cli" \
  "${STAGE_DIR}/coze-deploy-kit/dist"

(
  cd "${OUT_DIR}"
  zip -qr "${ZIP_PATH}" "ai-platform-coze-upload"
)

echo "Created: ${ZIP_PATH}"
