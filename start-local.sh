#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_PORT="${WEB_PORT:-5174}"
PROXY_PORT="${PROXY_PORT:-8787}"
LLM_PORT="${LLM_PORT:-8789}"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required"
  exit 1
fi

cleanup() {
  local code=$?
  jobs -pr | xargs -r kill >/dev/null 2>&1 || true
  wait || true
  exit "$code"
}

trap cleanup INT TERM EXIT

cd "$ROOT_DIR"

HOST=127.0.0.1 PORT="$WEB_PORT" STATIC_DIR="$ROOT_DIR" node proxy-standalone.js &
if [[ "$PROXY_PORT" != "$WEB_PORT" ]]; then
  HOST=127.0.0.1 PORT="$PROXY_PORT" node proxy-standalone.js &
fi
if [[ -n "${GLM_API_KEY:-}" ]]; then
  HOST=127.0.0.1 PORT="$LLM_PORT" GLM_API_KEY="$GLM_API_KEY" node glm-zai-local-adapter.mjs &
else
  echo "LLM:   skipped (GLM_API_KEY is not set)"
fi

echo "Web:   http://127.0.0.1:${WEB_PORT}/Графики.html"
echo "API:   http://127.0.0.1:${WEB_PORT}/api/health"
echo "Proxy: http://127.0.0.1:${PROXY_PORT}/health"
if [[ -n "${GLM_API_KEY:-}" ]]; then
  echo "LLM:   http://127.0.0.1:${LLM_PORT}/health"
fi

wait
