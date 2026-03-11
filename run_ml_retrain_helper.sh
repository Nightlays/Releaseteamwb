#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./tools/bootstrap_ml_env.sh
source .venv/bin/activate
exec python tools/ml_retrain_helper.py
