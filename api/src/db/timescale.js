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
