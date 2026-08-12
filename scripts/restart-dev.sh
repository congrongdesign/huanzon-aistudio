#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Kill existing tsx/next dev processes for this workspace only
pkill -f "tsx watch src/server.ts" 2>/dev/null || true
pkill -f "next/dist/bin/next" 2>/dev/null || true

# Remove stale lock if no next dev process remains
if ! pgrep -f "next/dist/bin/next" >/dev/null 2>&1; then
  rm -f .next/dev/lock || true
fi

echo "Restarting dev server..."
exec bash ./scripts/dev.sh
