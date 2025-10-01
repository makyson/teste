-- =========================
-- Extensão + Tabela base
-- =========================
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry_raw (
    company_id    TEXT NOT NULL,
    logical_id    TEXT NOT NULL,
    ts            TIMESTAMPTZ NOT NULL,
    voltage       DOUBLE PRECISION,
    current       DOUBLE PRECISION,
    frequency     DOUBLE PRECISION,
    power_factor  DOUBLE PRECISION,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb
);

SELECT create_hypertable('telemetry_raw', 'ts', if_not_exists => TRUE);


CREATE INDEX IF NOT EXISTS idx_telemetry_raw_company_ts
    ON telemetry_raw (company_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_raw_device_ts
    ON telemetry_raw (logical_id, ts DESC);

-- =========================
-- MV (normal) para energia diária (pode usar CTE)
-- =========================
DROP MATERIALIZED VIEW IF EXISTS ca_device_daily_energy;
CREATE MATERIALIZED VIEW ca_device_daily_energy AS
WITH ordered AS (
  SELECT
    company_id,
    logical_id,
    time_bucket('1 day', ts, 'UTC') AS day,
    ts,
    voltage,
    current,
    frequency,
    power_factor,
    COALESCE(
      EXTRACT(EPOCH FROM LEAD(ts, 1, ts + INTERVAL '60 minutes')
              OVER (PARTITION BY company_id, logical_id ORDER BY ts) - ts) / 3600.0,
      1.0
    ) AS duration_hours
  FROM telemetry_raw
)
SELECT
  company_id,
  logical_id,
  day,
  SUM(((voltage * current * COALESCE(power_factor, 1)) / 1000.0) * duration_hours) AS kwh_estimated
FROM ordered
GROUP BY company_id, logical_id, day
WITH NO DATA;

CREATE INDEX IF NOT EXISTS ca_device_daily_energy_idx
  ON ca_device_daily_energy (day DESC, company_id, logical_id);

-- backfill inicial
REFRESH MATERIALIZED VIEW ca_device_daily_energy;

-- =========================
-- Continuous Aggregate (sem CTE) para métricas simples
-- =========================
DROP MATERIALIZED VIEW IF EXISTS ca_device_daily_simple;
CREATE MATERIALIZED VIEW ca_device_daily_simple
WITH (timescaledb.continuous) AS
SELECT
  company_id,
  logical_id,
  time_bucket('1 day', ts, 'UTC') AS day,
  AVG(voltage * current) AS avg_power,
  MIN(frequency)         AS min_freq,
  MAX(frequency)         AS max_freq,
  AVG(power_factor)      AS pf_avg
FROM telemetry_raw
GROUP BY company_id, logical_id, day;

CREATE INDEX IF NOT EXISTS ca_device_daily_simple_idx
  ON ca_device_daily_simple (day DESC, company_id, logical_id);

DO $$
BEGIN
  PERFORM add_continuous_aggregate_policy(
    'ca_device_daily_simple',
    start_offset      => INTERVAL '35 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- (opcional) refresh inicial da janela recente
CALL refresh_continuous_aggregate('ca_device_daily_simple',
  now() - INTERVAL '35 days', now());

-- =========================
-- Políticas (compressão/retention)
-- =========================
ALTER TABLE telemetry_raw
  SET (timescaledb.compress = TRUE,
       timescaledb.compress_segmentby = 'company_id,logical_id');

DO $$
BEGIN
  PERFORM add_compression_policy('telemetry_raw', INTERVAL '7 days');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  PERFORM add_retention_policy('telemetry_raw', INTERVAL '180 days');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- =========================
-- Views de compatibilidade
-- =========================
CREATE OR REPLACE VIEW companies AS
SELECT DISTINCT company_id AS id
FROM telemetry_raw;

CREATE OR REPLACE VIEW sites AS
SELECT DISTINCT
  (payload ->> 'board_id') AS id,
  company_id
FROM telemetry_raw
WHERE payload ? 'board_id';

CREATE OR REPLACE VIEW logical_devices AS
SELECT DISTINCT
  logical_id AS id,
  (payload ->> 'board_id') AS site_id
FROM telemetry_raw;

CREATE OR REPLACE VIEW daily_metrics AS
WITH ordered AS (
  SELECT
    company_id,
    logical_id,
    time_bucket('1 day', ts, 'UTC') AS day,
    COALESCE(voltage, 0) AS voltage,
    COALESCE(current, 0) AS current,
    frequency,
    power_factor,
    GREATEST(
      EXTRACT(EPOCH FROM COALESCE(LEAD(ts) OVER (PARTITION BY company_id, logical_id ORDER BY ts), ts + INTERVAL '60 minutes') - ts) / 3600.0,
      0
    ) AS duration_hours
  FROM telemetry_raw
),
aggregated AS (
  SELECT
    company_id,
    logical_id,
    day,
    SUM(((voltage * current * COALESCE(power_factor, 1)) / 1000.0) * duration_hours) AS kwh,
    AVG(voltage * current) AS avg_power,
    MIN(frequency)        AS min_freq,
    MAX(frequency)        AS max_freq,
    AVG(power_factor)     AS pf_avg
  FROM ordered
  GROUP BY company_id, logical_id, day
)
SELECT
  agg.company_id,
  ld.id AS device_id,
  s.id  AS site_id,
  agg.day,
  agg.kwh,
  agg.avg_power,
  agg.min_freq,
  agg.max_freq,
  agg.pf_avg
FROM aggregated agg
LEFT JOIN logical_devices ld
  ON ld.id = agg.logical_id
LEFT JOIN sites s
  ON s.company_id = agg.company_id
 AND s.id = ld.site_id;





CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS nlq_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('schedule_report','threshold_alert')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active')),
  schedule_cron TEXT,
  prompt TEXT NOT NULL,
  cypher TEXT,
  sql TEXT,
  sql_params JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nlq_rules_company ON nlq_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_nlq_rules_status ON nlq_rules(status);
