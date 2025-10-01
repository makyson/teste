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
WITH ordered AS (
    SELECT
        company_id,
        logical_id,
        time_bucket('1 day', ts) AS day,
        ts,
        voltage,
        current,
        frequency,
        power_factor,
        COALESCE(
            EXTRACT(EPOCH FROM LEAD(ts, 1, ts + INTERVAL '1 minute') OVER (
                PARTITION BY company_id, logical_id ORDER BY ts
            ) - ts) / 3600.0,
            1.0 / 60.0
        ) AS duration_hours
    FROM telemetry_raw
)
SELECT
    company_id,
    logical_id,
    day,
    SUM(((voltage * current * COALESCE(power_factor, 1)) / 1000.0) * duration_hours) AS kwh_estimated,
    AVG(voltage * current) AS avg_power,
    MIN(frequency) AS min_freq,
    MAX(frequency) AS max_freq,
    AVG(power_factor) AS pf_avg
FROM ordered
GROUP BY company_id, logical_id, day;

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




-- cria CA sem CTE
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




-- 1) Empresas a partir do tráfego real
CREATE OR REPLACE VIEW companies AS
SELECT DISTINCT company_id AS id
FROM telemetry_raw;

-- 2) “Sites/Boards” a partir do board_id salvo no payload
CREATE OR REPLACE VIEW sites AS
SELECT DISTINCT
  (payload ->> 'board_id') AS id,
  company_id
FROM telemetry_raw
WHERE payload ? 'board_id';

-- 3) Dispositivos lógicos, associados ao “site” (board_id do payload)
CREATE OR REPLACE VIEW logical_devices AS
SELECT DISTINCT
  logical_id AS id,
  (payload ->> 'board_id') AS site_id
FROM telemetry_raw;

-- 4) Métricas diárias no formato que o NLQ espera (kwh + métricas)
--    Junta as duas aggregates pelas chaves (company_id, logical_id, day)
CREATE OR REPLACE VIEW daily_metrics AS
SELECT
  e.company_id,
  ld.id                       AS device_id,
  s.id                        AS site_id,
  e.day                       AS day,
  e.kwh_estimated             AS kwh,
  s2.avg_power,
  s2.min_freq,
  s2.max_freq,
  s2.pf_avg
FROM ca_device_daily_energy  e
LEFT JOIN ca_device_daily_simple s2
  ON s2.company_id = e.company_id
 AND s2.logical_id = e.logical_id
 AND s2.day        = e.day
LEFT JOIN logical_devices ld
  ON ld.id = e.logical_id
LEFT JOIN sites s
  ON s.company_id = e.company_id
 AND s.id         = ld.site_id;

