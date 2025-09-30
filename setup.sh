#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

mkdir -p scripts sql cypher api/src/routes api/src/db api/src/ingest api/src/nlq

cat <<'EOT' > README.md
# Plataforma de Telemetria

Este repositório contém um script único que prepara um ambiente completo de ingestão, agregação e consulta de métricas elétricas usando Docker.

## Visão geral

Os serviços provisionados incluem:

- **API Node.js (Fastify)** para ingestão MQTT, rotas REST e endpoint NLQ com Gemini.
- **TimescaleDB (PostgreSQL 16)** para armazenamento bruto e agregados contínuos.
- **Neo4j 5.x** com APOC para grafo de entidades e métricas.
- **Mosquitto** para recebimento de telemetria via MQTT.
- **Redis** (opcional) disponível para uso futuro em cache/locks.

## Como usar

1. Garanta que Docker e Docker Compose v2 estejam instalados.
2. Execute o script `./setup.sh` na raiz do repositório.
3. Aguarde a criação dos arquivos, subida dos containers e aplicação dos schemas.
4. Opcionalmente, publique uma mensagem de exemplo com `./scripts/demo_publish.sh`.

O arquivo `.env` é gerado com valores padrão seguros para desenvolvimento. Ajuste conforme necessário antes de rodar em produção.
EOT

cat <<'EOT' > .env
PORT=3000
NODE_ENV=development
PGHOST=timescale
PGPORT=5432
PGDATABASE=energy
PGUSER=postgres
PGPASSWORD=postgres
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=TroqueNeo4j!
MQTT_URL=mqtt://mosquitto:1883
MQTT_TOPIC=companies/+/boards/+/telemetry
REDIS_URL=redis://redis:6379
GEMINI_API_KEY=coloque_sua_chave_aqui
GEMINI_MODEL=gemini-1.5-flash
DEFAULT_COMPANY_ID=company-1
JWT_SECRET=TroqueEstaChaveJWT!
AUTH_USERNAME=admin
AUTH_PASSWORD=TroqueEstaSenha!
JWT_EXPIRES_IN=1h
EOT

cat <<'EOT' > docker-compose.yml
services:
  api:
    build: ./api
    env_file:
      - .env
    ports:
      - "3000:3000"
    depends_on:
      timescale:
        condition: service_healthy
      neo4j:
        condition: service_healthy
      mosquitto:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1);}).catch(()=>process.exit(1));"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - default

  timescale:
    image: timescale/timescaledb-ha:pg16-latest
    environment:
      POSTGRES_DB: energy
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - timescale_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks:
      - default

  neo4j:
    image: neo4j:5.19-community
    environment:
      NEO4J_AUTH: neo4j/TroqueNeo4j!
      NEO4J_dbms_security_auth__enabled: "true"
      NEO4J_PLUGINS: '["apoc"]'
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - neo4j_data:/data
    healthcheck:
      test: ["CMD-SHELL", "cypher-shell -a bolt://localhost:7687 -u neo4j -p TroqueNeo4j! 'RETURN 1' || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 10
      start_period: 40s
    networks:
      - default

  mosquitto:
    image: eclipse-mosquitto:2.0
    ports:
      - "1883:1883"
    volumes:
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
    healthcheck:
      test: ["CMD-SHELL", "mosquitto_pub -h localhost -t healthcheck -m ok"]
      interval: 30s
      timeout: 5s
      retries: 5
    networks:
      - default

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - default

networks:
  default:
    driver: bridge

volumes:
  timescale_data:
  neo4j_data:
EOT

cat <<'EOT' > mosquitto.conf
listener 1883
allow_anonymous true
persistence false
EOT

cat <<'EOT' > sql/01_timescale_init.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry_raw (
    company_id TEXT NOT NULL,
    logical_id TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    voltage DOUBLE PRECISION,
    current DOUBLE PRECISION,
    frequency DOUBLE PRECISION,
    power_factor DOUBLE PRECISION,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

SELECT create_hypertable('telemetry_raw', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_company_ts
    ON telemetry_raw (company_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_device_ts
    ON telemetry_raw (logical_id, ts DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS ca_device_daily
WITH (timescaledb.continuous) AS
SELECT
    company_id,
    logical_id,
    time_bucket('1 day', ts) AS day,
    SUM(
        ((voltage * current * COALESCE(power_factor, 1)) / 1000.0)
        * COALESCE(
            EXTRACT(EPOCH FROM LEAD(ts, 1, ts + INTERVAL '1 minute') OVER (
                PARTITION BY company_id, logical_id ORDER BY ts
            ) - ts) / 3600.0,
            1.0 / 60.0
        )
    ) AS kwh_estimated,
    AVG(voltage * current) AS avg_power,
    MIN(frequency) AS min_freq,
    MAX(frequency) AS max_freq,
    AVG(power_factor) AS pf_avg
FROM telemetry_raw
GROUP BY company_id, logical_id, time_bucket('1 day', ts);

DO $$
BEGIN
    PERFORM add_continuous_aggregate_policy(
        'ca_device_daily',
        start_offset => INTERVAL '35 days',
        end_offset => INTERVAL '1 hour',
        schedule_interval => INTERVAL '15 minutes'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE telemetry_raw
    SET (timescaledb.compress = TRUE,
         timescaledb.compress_segmentby = 'company_id,logical_id');

DO $$
BEGIN
    PERFORM add_compression_policy('telemetry_raw', INTERVAL '7 days');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    PERFORM add_retention_policy('telemetry_raw', INTERVAL '180 days');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;
EOT

cat <<'EOT' > cypher/01_schema.cypher
CREATE CONSTRAINT company_id_unique IF NOT EXISTS
FOR (c:Company)
REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT site_id_unique IF NOT EXISTS
FOR (s:Site)
REQUIRE s.id IS UNIQUE;

CREATE CONSTRAINT device_id_unique IF NOT EXISTS
FOR (d:LogicalDevice)
REQUIRE d.id IS UNIQUE;

CREATE INDEX daily_metric_day_index IF NOT EXISTS
FOR (m:DailyMetric)
ON (m.day);

CREATE CONSTRAINT rule_id_unique IF NOT EXISTS
FOR (r:Rule)
REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT alert_id_unique IF NOT EXISTS
FOR (a:Alert)
REQUIRE a.id IS UNIQUE;

MERGE (c:Company {id: 'company-1'})
ON CREATE SET c.name = 'Empresa Demo'
RETURN c;
EOT

cat <<'EOT' > scripts/bootstrap.sh
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
EOT

cat <<'EOT' > scripts/demo_publish.sh
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
EOT

cat <<'EOT' > api/Dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
EOT

cat <<'EOT' > api/package.json
{
  "name": "energy-telemetry-api",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "license": "MIT",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "fastify": "^4.26.2",
    "mqtt": "^5.3.5",
    "neo4j-driver": "^5.18.0",
    "pg": "^8.11.5"
  }
}
EOT

cat <<'EOT' > api/src/config.js
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const rootDir = path.resolve(new URL('../../', import.meta.url).pathname);
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const requiredVars = [
  'PORT',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'NEO4J_URI',
  'NEO4J_USER',
  'NEO4J_PASSWORD',
  'MQTT_URL',
  'MQTT_TOPIC',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'DEFAULT_COMPANY_ID'
];

const config = {};

for (const key of requiredVars) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  config[key] = value;
}

config.NODE_ENV = process.env.NODE_ENV || 'development';
config.REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
config.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export default Object.freeze({
  port: Number.parseInt(config.PORT, 10) || 3000,
  nodeEnv: config.NODE_ENV,
  postgres: {
    host: config.PGHOST,
    port: Number.parseInt(config.PGPORT, 10) || 5432,
    database: config.PGDATABASE,
    user: config.PGUSER,
    password: config.PGPASSWORD
  },
  neo4j: {
    uri: config.NEO4J_URI,
    user: config.NEO4J_USER,
    password: config.NEO4J_PASSWORD
  },
  mqtt: {
    url: config.MQTT_URL,
    topic: config.MQTT_TOPIC
  },
  redis: {
    url: config.REDIS_URL
  },
  gemini: {
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL
  },
  defaultCompanyId: config.DEFAULT_COMPANY_ID,
  logLevel: config.LOG_LEVEL
});
EOT

cat <<'EOT' > api/src/index.js
import process from 'node:process';
import fastify from 'fastify';
import config from './config.js';
import registerHealthRoute from './routes/health.js';
import registerNlqRoute from './routes/nlq.js';
import { verifyConnectivity as verifyTimescale, closePool } from './db/timescale.js';
import { verifyConnectivity as verifyNeo4j, closeDriver } from './db/neo4j.js';
import { startMqttIngest } from './ingest/mqtt.js';

const app = fastify({
  logger: {
    level: config.logLevel
  }
});

app.decorate('config', config);

app.register(registerHealthRoute);
app.register(registerNlqRoute);

let stopMqtt = null;

async function boot() {
  try {
    await verifyTimescale();
    app.log.info('TimescaleDB conectado.');
  } catch (err) {
    app.log.error({ err }, 'Falha ao conectar no TimescaleDB');
    throw err;
  }

  try {
    await verifyNeo4j();
    app.log.info('Neo4j conectado.');
  } catch (err) {
    app.log.error({ err }, 'Falha ao conectar no Neo4j');
    throw err;
  }

  stopMqtt = startMqttIngest({
    config,
    logger: app.log
  });

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`[api] listening on ${config.port}`);
  } catch (err) {
    app.log.error({ err }, 'Falha ao iniciar servidor');
    throw err;
  }
}

boot().catch((err) => {
  app.log.error({ err }, 'Erro fatal na inicialização');
  process.exit(1);
});

async function shutdown(signal) {
  app.log.info({ signal }, 'Encerrando aplicação');
  try {
    if (stopMqtt) {
      await stopMqtt();
    }
    await app.close();
  } catch (err) {
    app.log.error({ err }, 'Erro ao fechar Fastify');
  }

  try {
    await closePool();
  } catch (err) {
    app.log.error({ err }, 'Erro ao fechar pool Postgres');
  }

  try {
    await closeDriver();
  } catch (err) {
    app.log.error({ err }, 'Erro ao fechar driver Neo4j');
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
EOT

cat <<'EOT' > api/src/routes/health.js
export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => ({ ok: true }));
}
EOT

cat <<'EOT' > api/src/routes/nlq.js
import { generateCypher } from '../nlq/gemini.js';
import { runCypher } from '../db/neo4j.js';

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function buildAnswer(rows, companyId) {
  if (!rows.length) {
    return `Nenhum resultado encontrado para a empresa ${companyId}.`;
  }

  const sample = rows[0];
  const keys = Object.keys(sample);
  if (!keys.length) {
    return `Consulta executada com sucesso para a empresa ${companyId}, porém não há colunas retornadas.`;
  }

  const preview = keys
    .slice(0, 5)
    .map((key) => `${key}: ${sample[key]}`)
    .join(', ');

  if (rows.length === 1) {
    return `Encontrada 1 linha para a empresa ${companyId}. Principais valores: ${preview}.`;
  }

  return `Encontradas ${rows.length} linhas para a empresa ${companyId}. Exemplo de linha: ${preview}.`;
}

export default async function registerNlqRoutes(fastify) {
  fastify.post('/nlq/query', {
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1 },
          companyId: { type: 'string', minLength: 1 }
        }
      }
    },
    handler: async (request, reply) => {
      const { text, companyId } = request.body;
      const normalizedText = normalizeText(text);
      if (!normalizedText) {
        reply.code(400);
        return {
          code: 'INVALID_TEXT',
          message: 'O campo "text" deve ser uma string não vazia.'
        };
      }

      const targetCompanyId = normalizeText(companyId) || fastify.config.defaultCompanyId;
      const start = Date.now();

      let cypher;
      try {
        cypher = await generateCypher({
          text: normalizedText,
          companyId: targetCompanyId
        });
      } catch (err) {
        fastify.log.error({ err }, 'Erro ao gerar Cypher via Gemini');
        reply.code(502);
        return {
          code: 'GEMINI_ERROR',
          message: 'Não foi possível gerar a consulta a partir do texto informado.'
        };
      }

      let rows;
      try {
        const result = await runCypher(cypher, { companyId: targetCompanyId });
        rows = result.records.map((record) => record.toObject());
      } catch (err) {
        fastify.log.error({ err, cypher }, 'Erro ao executar Cypher');
        reply.code(500);
        return {
          code: 'NEO4J_ERROR',
          message: 'Falha ao executar consulta no grafo.'
        };
      }

      const total = Date.now() - start;
      fastify.log.info({ cypher, totalMs: total }, 'NLQ executado');

      return {
        answer: buildAnswer(rows, targetCompanyId),
        cypher,
        rows
      };
    }
  });
}
EOT

cat <<'EOT' > api/src/db/timescale.js
import process from 'node:process';
import pg from 'pg';
import config from '../config.js';

const pool = new pg.Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
  max: 10,
  idleTimeoutMillis: 30_000
});

export async function verifyConnectivity() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function insertTelemetry(entry) {
  const {
    companyId,
    logicalId,
    ts,
    voltage = null,
    current = null,
    frequency = null,
    powerFactor = null,
    payload
  } = entry;

  const query = `
    INSERT INTO telemetry_raw (
      company_id,
      logical_id,
      ts,
      voltage,
      current,
      frequency,
      power_factor,
      payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
  `;

  const values = [
    companyId,
    logicalId,
    ts,
    voltage,
    current,
    frequency,
    powerFactor,
    JSON.stringify(payload ?? {})
  ];

  await pool.query(query, values);
}

export async function closePool() {
  await pool.end();
}

process.on('beforeExit', () => {
  pool.end().catch(() => {});
});

export default pool;
EOT

cat <<'EOT' > api/src/db/neo4j.js
import neo4j from 'neo4j-driver';
import config from '../config.js';

const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
  {
    encrypted: 'ENCRYPTION_OFF'
  }
);

export async function verifyConnectivity() {
  await driver.verifyConnectivity();
}

export async function runCypher(query, params = {}) {
  const session = driver.session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

export async function closeDriver() {
  await driver.close();
}

export default driver;
EOT

cat <<'EOT' > api/src/ingest/mqtt.js
import mqtt from 'mqtt';
import { insertTelemetry } from '../db/timescale.js';

function extractCompanyId(topic) {
  const pattern = /^companies\/([^/]+)\/boards\/[^/]+\/telemetry$/;
  const match = topic.match(pattern);
  if (!match) {
    return null;
  }
  return match[1];
}

export function startMqttIngest({ config, logger }) {
  const client = mqtt.connect(config.mqtt.url, {
    reconnectPeriod: 5_000
  });

  client.on('connect', () => {
    logger.info({ topic: config.mqtt.topic }, 'Conectado ao broker MQTT');
    client.subscribe(config.mqtt.topic, (err) => {
      if (err) {
        logger.error({ err }, 'Falha ao assinar tópico MQTT');
      } else {
        logger.info({ topic: config.mqtt.topic }, 'Assinatura MQTT concluída');
      }
    });
  });

  client.on('error', (err) => {
    logger.error({ err }, 'Erro no cliente MQTT');
  });

  client.on('message', async (topic, payloadBuffer) => {
    const companyId = extractCompanyId(topic);
    if (!companyId) {
      logger.warn({ topic }, 'Tópico desconhecido recebido');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(payloadBuffer.toString('utf8'));
    } catch (err) {
      logger.error({ err, topic }, 'Falha ao parsear mensagem MQTT');
      return;
    }

    if (!payload.logical_id || !payload.ts) {
      logger.warn({ topic, payload }, 'Mensagem MQTT incompleta, ignorando');
      return;
    }

    try {
      await insertTelemetry({
        companyId,
        logicalId: payload.logical_id,
        ts: payload.ts,
        voltage: payload.voltage ?? null,
        current: payload.current ?? null,
        frequency: payload.frequency ?? null,
        powerFactor: payload.power_factor ?? null,
        payload
      });
    } catch (err) {
      logger.error({ err, topic }, 'Falha ao inserir telemetria');
    }
  });

  return () =>
    new Promise((resolve) => {
      client.end(false, {}, resolve);
    });
}
EOT

cat <<'EOT' > api/src/nlq/prompts.js
const schemaDescription = `
Esquema lógico em Neo4j:
(:Company {id, name})-[:HAS_SITE]->(:Site {id, name})-[:HAS_DEVICE]->(:LogicalDevice {id, logicalId, name})-[:HAS_DAILY]->(:DailyMetric {day, kwh, avg_power, min_freq, max_freq, pf_avg})
(:Rule {id, name})-[:FIRED]->(:Alert {id, created_at, severity})
`;

const instructions = `
Você é um assistente especializado em gerar consultas Cypher para Neo4j.
Responda SEMPRE apenas com a consulta Cypher, sem texto adicional, sem explicações e sem blocos de código.
Utilize sempre parâmetros nomeados e filtre pela empresa informada usando MATCH (c:Company {id: $companyId}).
Use as relações do esquema para navegar até métricas diárias (:DailyMetric).
Prefira retornar colunas nomeadas em snake_case.
`;

const fewShots = [
  {
    question: 'quero o resumo desse mês',
    cypher: `MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(d:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)
WHERE date(m.day) >= date.truncate('month', date())
RETURN d.id AS device_id,
       sum(m.kwh) AS total_kwh,
       avg(m.avg_power) AS media_potencia,
       avg(m.pf_avg) AS fator_potencia_medio
ORDER BY total_kwh DESC`
  },
  {
    question: 'qual aparelho consumiu mais nos últimos 30 dias?',
    cypher: `MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(d:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)
WHERE m.day >= date() - duration({days: 30})
RETURN d.id AS device_id,
       sum(m.kwh) AS consumo_total_kwh
ORDER BY consumo_total_kwh DESC
LIMIT 1`
  },
  {
    question: 'listar alertas críticos do último mês',
    cypher: `MATCH (c:Company {id: $companyId})<-[:FIRED]-(:Rule)-[:FIRED]->(a:Alert)
WHERE a.severity = 'critical' AND a.created_at >= datetime() - duration({days: 30})
RETURN a.id AS alert_id,
       a.severity AS severidade,
       a.created_at AS criado_em
ORDER BY a.created_at DESC`
  }
];

export function buildPrompt({ text, companyId }) {
  const examples = fewShots
    .map((example) => `Usuário: ${example.question}\nCypher: ${example.cypher}`)
    .join('\n\n');

  return [
    instructions.trim(),
    schemaDescription.trim(),
    examples,
    `Usuário: ${text}\nEmpresa: ${companyId}\nCypher:`
  ]
    .filter(Boolean)
    .join('\n\n');
}
EOT

cat <<'EOT' > api/src/nlq/gemini.js
import config from '../config.js';
import { buildPrompt } from './prompts.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function sanitizeCypher(text) {
  if (!text) {
    return '';
  }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```cypher\s*/i, '');
  cleaned = cleaned.replace(/^```/i, '');
  cleaned = cleaned.replace(/```$/i, '');
  cleaned = cleaned.replace(/^cypher\s*:/i, '');
  cleaned = cleaned.replace(/^consulta\s*:/i, '');
  cleaned = cleaned.trim();
  return cleaned;
}

export async function generateCypher({ text, companyId }) {
  const prompt = buildPrompt({ text, companyId });
  const endpoint = `${BASE_URL}/models/${config.gemini.model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.gemini.apiKey}`
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini respondeu com status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const cypher = sanitizeCypher(candidate);

  if (!cypher) {
    throw new Error('Gemini não retornou uma consulta Cypher.');
  }

  return cypher;
}
EOT

chmod +x scripts/bootstrap.sh scripts/demo_publish.sh

if command -v docker >/dev/null 2>&1 && command -v docker compose >/dev/null 2>&1; then
  docker compose up -d --build
  if [ -x scripts/bootstrap.sh ]; then
    ./scripts/bootstrap.sh || echo "[setup] Falha ao executar bootstrap" >&2
  fi
else
  echo "Docker ou docker compose não encontrados. Criação de arquivos concluída, mas execução de containers foi pulada." >&2
fi
EOT

chmod +x setup.sh
