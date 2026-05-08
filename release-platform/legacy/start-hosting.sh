#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ".env created from .env.example"
  echo "Fill GLM_API_KEY in .env and run the script again"
  exit 1
fi

if ! grep -q '^GLM_API_KEY=.\+' .env; then
  echo "GLM_API_KEY is missing in .env"
  exit 1
fi

docker compose up -d --build
docker compose ps
