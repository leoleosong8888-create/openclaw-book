#!/usr/bin/env bash
set -euo pipefail
cd /home/leo/.openclaw/workspace

if [[ ! -f .env.bus ]]; then
  echo "버스 조회 실패: /home/leo/.openclaw/workspace/.env.bus 파일이 없습니다. (.env.bus.example 참고)"
  exit 1
fi

set -a
source ./.env.bus
set +a

node ./scripts/yongin-bus-check.mjs
