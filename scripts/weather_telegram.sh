#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/home/leo/.openclaw/workspace"
ENV_FILE="$BASE_DIR/scripts/weather_telegram.env"
JS_FILE="$BASE_DIR/scripts/weather_telegram_topic.js"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  echo "[WARN] Missing $ENV_FILE" >&2
fi

exec /usr/bin/node "$JS_FILE"
