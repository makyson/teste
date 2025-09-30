#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker não encontrado" >&2
  exit 1
fi

topic="companies/${1:-company-1}/boards/${2:-board-1}/telemetry"
payload='{
  "logical_id": "device-123",
  "ts": "2025-09-29T12:00:00Z",
  "voltage": 220.1,
  "current": 4.2,
  "frequency": 60.0,
  "power_factor": 0.95
}'

echo "[demo] Publicando em ${topic}"
docker compose exec -T mosquitto mosquitto_pub -t "${topic}" -m "${payload}"
