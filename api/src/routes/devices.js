import { runSql } from '../db/timescale.js';

function parseDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date;
}

function resolveCompanyId(request, explicit) {
  const tokenCompany = request.user?.companyId;
  if (explicit && tokenCompany && explicit !== tokenCompany) {
    const err = new Error('FORBIDDEN_COMPANY');
    err.statusCode = 403;
    err.code = 'FORBIDDEN_COMPANY';
    throw err;
  }
  const value = explicit ?? tokenCompany ?? request.server.config.defaultCompanyId;
  return typeof value === 'string' && value.length ? value : request.server.config.defaultCompanyId;
}

function mapDeviceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    lastTs: row.last_ts,
    voltage: row.voltage,
    current: row.current,
    frequency: row.frequency,
    powerFactor: row.power_factor
  };
}

function mapMetricsRow(row) {
  return {
    bucket: row.bucket,
    avgVoltage: Number(row.avg_voltage ?? 0),
    maxVoltage: Number(row.max_voltage ?? 0),
    minVoltage: Number(row.min_voltage ?? 0),
    avgCurrent: Number(row.avg_current ?? 0),
    avgFrequency: Number(row.avg_frequency ?? 0),
    avgPowerFactor: Number(row.avg_power_factor ?? 0)
  };
}

export default async function registerDeviceRoutes(fastify) {
  fastify.register(async (instance) => {
    instance.addHook('preHandler', fastify.authenticate);

    instance.get('/devices', async (request, reply) => {
      let companyId;
      try {
        companyId = resolveCompanyId(request, request.query?.companyId);
      } catch (err) {
        if (err.code === 'FORBIDDEN_COMPANY') {
          reply.code(403);
          return { code: 'FORBIDDEN', message: 'Acesso negado à empresa informada.' };
        }
        throw err;
      }

      const sql = `
        WITH ranked AS (
          SELECT
            company_id,
            logical_id AS id,
            ts,
            voltage,
            current,
            frequency,
            power_factor,
            ROW_NUMBER() OVER (PARTITION BY company_id, logical_id ORDER BY ts DESC) AS rn
          FROM telemetry_raw
          WHERE company_id = $1
        )
        SELECT
          company_id,
          id,
          ts AS last_ts,
          voltage,
          current,
          frequency,
          power_factor
        FROM ranked
        WHERE rn = 1
        ORDER BY id;
      `;

      const result = await runSql(sql, [companyId]);
      return { items: result.rows.map(mapDeviceRow) };
    });

    instance.get('/devices/:id/metrics', {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
            bucket: { type: 'string' }
          }
        }
      }
    }, async (request, reply) => {
      const { id } = request.params;
      if (!id) {
        reply.code(400);
        return { code: 'INVALID_DEVICE', message: 'DeviceId obrigatório.' };
      }

      let companyId;
      try {
        companyId = resolveCompanyId(request, request.query?.companyId);
      } catch (err) {
        if (err.code === 'FORBIDDEN_COMPANY') {
          reply.code(403);
          return { code: 'FORBIDDEN', message: 'Acesso negado à empresa informada.' };
        }
        throw err;
      }

      const now = new Date();
      const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const startDate = parseDate(request.query?.start, defaultStart);
      const endDate = parseDate(request.query?.end, now);
      if (startDate >= endDate) {
        reply.code(400);
        return { code: 'INVALID_RANGE', message: 'Intervalo inválido (start >= end).' };
      }

      const bucket = ['minute', 'hour', 'day'].includes(request.query?.bucket)
        ? request.query.bucket
        : 'hour';

      const sql = `
        SELECT
          to_char(date_trunc($5, ts), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
          AVG(voltage) AS avg_voltage,
          MAX(voltage) AS max_voltage,
          MIN(voltage) AS min_voltage,
          AVG(current) AS avg_current,
          AVG(frequency) AS avg_frequency,
          AVG(power_factor) AS avg_power_factor
        FROM telemetry_raw
        WHERE company_id = $1
          AND logical_id = $2
          AND ts >= $3
          AND ts <= $4
        GROUP BY date_trunc($5, ts)
        ORDER BY bucket;
      `;

      const params = [
        companyId,
        id,
        startDate.toISOString(),
        endDate.toISOString(),
        bucket
      ];

      const result = await runSql(sql, params);
      return {
        deviceId: id,
        companyId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        bucket,
        points: result.rows.map(mapMetricsRow)
      };
    });
  });
}
