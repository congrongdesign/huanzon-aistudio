#!/bin/bash
set -Eeuo pipefail


PORT="${PORT:-5000}"
COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


cd "${COZE_WORKSPACE_PATH}"

if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
else
  PNPM_BIN="corepack pnpm"
fi

kill_port_if_listening() {
    local pids
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -z "${pids}" ]] && command -v lsof >/dev/null 2>&1; then
      pids=$(lsof -tiTCP:"${DEPLOY_RUN_PORT}" -sTCP:LISTEN 2>/dev/null | paste -sd' ' - || true)
    fi
    if [[ -z "${pids}" ]]; then
      echo "Port ${DEPLOY_RUN_PORT} is free."
      return
    fi
    local killable=()
    for pid in ${pids}; do
      local command_line
      command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
      if [[ "${command_line}" == *"${COZE_WORKSPACE_PATH}"* || "${command_line}" == *"tsx watch src/server.ts"* || "${command_line}" == *"next-server"* ]]; then
        killable+=("${pid}")
      else
        echo "Port ${DEPLOY_RUN_PORT} is used by non-project process ${pid}: ${command_line}"
      fi
    done
    if [[ ${#killable[@]} -eq 0 ]]; then
      echo "No project process can be killed automatically on port ${DEPLOY_RUN_PORT}."
      return
    fi
    echo "Port ${DEPLOY_RUN_PORT} in use by project PIDs: ${killable[*]} (SIGKILL)"
    printf '%s\n' "${killable[@]}" | xargs -I {} kill -9 {}
    sleep 1
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -n "${pids}" ]]; then
      echo "Warning: port ${DEPLOY_RUN_PORT} still busy after SIGKILL, PIDs: ${pids}"
    else
      echo "Port ${DEPLOY_RUN_PORT} cleared."
    fi
}

echo "Clearing port ${PORT} before start."
kill_port_if_listening
echo "Starting HTTP service on port ${PORT} for dev..."

PORT=$PORT ${PNPM_BIN} tsx watch src/server.ts
