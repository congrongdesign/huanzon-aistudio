#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3001}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[smoke] base_url=$BASE_URL"

check_json_field() {
  local file="$1"
  local key="$2"
  node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync('$file','utf8'));if(!(Object.prototype.hasOwnProperty.call(o,'$key'))){process.exit(2)}"
}

create_smoke_project() {
  local out="$TMP_DIR/smoke_project.json"
  local code
  code="$(curl -sS -o "$out" -w '%{http_code}' -X POST "$BASE_URL/api/projects" -H 'Content-Type: application/json' -d '{"name":"smoke-index-project"}')"
  echo "[smoke] create_project status=$code body=$(cat "$out")" >&2
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "[smoke] create_project expected 2xx but got $code"
    exit 4
  fi
  node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync('$out','utf8'));const id=o.project?.id||'';if(!id){process.exit(2)};process.stdout.write(id)" || {
    echo "[smoke] create_project missing project id"
    exit 5
  }
}

request() {
  local name="$1"
  local method="$2"
  local path="$3"
  local body="${4:-}"
  local out="$TMP_DIR/${name}.json"
  local code

  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' -d "$body")"
  else
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path")"
  fi

  echo "[smoke] $name status=$code body=$(cat "$out")"
  check_json_field "$out" "error"
  check_json_field "$out" "errorCode"
  check_json_field "$out" "retryable"
}

request_ok() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expect_key="$4"
  local body="${5:-}"
  local out="$TMP_DIR/${name}.json"
  local code

  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' -d "$body")"
  else
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path")"
  fi

  echo "[smoke] $name status=$code body=$(cat "$out")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "[smoke] $name expected 2xx but got $code"
    exit 3
  fi
  check_json_field "$out" "$expect_key"
}

request_ok_with_keys() {
  local name="$1"
  local method="$2"
  local path="$3"
  local body="$4"
  shift 4
  local keys=("$@")
  local out="$TMP_DIR/${name}.json"
  local code

  code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' -d "$body")"

  echo "[smoke] $name status=$code body=$(cat "$out")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "[smoke] $name expected 2xx but got $code"
    exit 6
  fi
  for key in "${keys[@]}"; do
    check_json_field "$out" "$key"
  done
}

request "batches_get_missing" "GET" "/api/batches/nonexistent-batch-id"
request "batches_pause_missing" "POST" "/api/batches/nonexistent-batch-id/pause"
request "batches_retry_invalid_stage" "POST" "/api/batches/nonexistent-batch-id/pages/1/retry" '{"stage":"bad"}'
request "generate_bad_request" "POST" "/api/generate" '{"prompt":"","baseUrl":"http://127.0.0.1:3001","apiKey":""}'
request "image_process_bad_request" "POST" "/api/image-process" '{"action":"","imageUrl":"","apiKey":"","baseUrl":""}'
request "inpaint_bad_request" "POST" "/api/inpaint" '{"prompt":"","maskBase64":""}'
request "asset_index_bad_request" "POST" "/api/asset-index" '{"mode":"ids","ids":[]}'
request_ok "asset_search_ok" "POST" "/api/asset-search" "records" '{"query":"test","limit":5}'

PROJECT_ID="$(create_smoke_project)"
request_ok_with_keys "asset_index_ok" "POST" "/api/asset-index" "{\"mode\":\"project\",\"projectId\":\"$PROJECT_ID\",\"sourceType\":\"all\",\"includeDesignAssets\":true,\"includeImageRecords\":true,\"waitForCompletion\":true}" "job" "summary"
request_ok_with_keys "asset_search_filtered_ok" "POST" "/api/asset-search" "{\"query\":\"test\",\"projectId\":\"$PROJECT_ID\",\"sourceType\":\"image_record\",\"sortBy\":\"recent\",\"limit\":5,\"offset\":0,\"includeFacets\":true}" "records" "total" "facets" "needsIndex"

echo "[smoke] all checks passed"
