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
