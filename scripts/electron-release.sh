#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

case "${1:-all}" in
  mac)
    corepack pnpm run desktop:release:mac
    ;;
  win)
    corepack pnpm run desktop:release:win
    ;;
  all)
    corepack pnpm run desktop:release:mac
    corepack pnpm run desktop:release:win
    ;;
  *)
    echo "Usage: $0 [mac|win|all]" >&2
    exit 1
    ;;
esac
