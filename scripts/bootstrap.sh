#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker não encontrado no PATH" >&2
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose não encontrado (requer Docker Compose v2)" >&2
  exit 1
fi

echo "[bootstrap] Subindo containers..."
docker compose up -d --build

echo "[bootstrap] Aplicando schema TimescaleDB..."
if ! docker compose exec -T timescale psql -U postgres -d energy < sql/01_timescale_init.sql; then
  echo "[bootstrap] Falha ao aplicar schema TimescaleDB" >&2
else
  echo "[bootstrap] Schema TimescaleDB aplicado."
fi

echo "[bootstrap] Aplicando schema Neo4j..."
if ! docker compose exec -T neo4j cypher-shell -u neo4j -p "${NEO4J_PASSWORD:-TroqueNeo4j!}" < cypher/01_schema.cypher; then
  echo "[bootstrap] Falha ao aplicar schema Neo4j" >&2
else
  echo "[bootstrap] Schema Neo4j aplicado."
fi

echo "[bootstrap] Pronto."
