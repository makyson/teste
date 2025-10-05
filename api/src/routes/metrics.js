// src/routes/metrics.js
import { runSql } from "../db/timescale.js";
import { computeMetricsFromReadings } from "../metrics/geminiMetrics.js";

function parseDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function resolveCompanyId(request, explicit) {
  const tokenCompany = request.user?.companyId;
  if (explicit && tokenCompany && explicit !== tokenCompany) {
    const err = new Error("FORBIDDEN_COMPANY");
    err.statusCode = 403;
    err.code = "FORBIDDEN_COMPANY";
    throw err;
  }
  const fallback = request.server.config.defaultCompanyId;
  const v = explicit ?? tokenCompany ?? fallback;
  return typeof v === "string" && v.length ? v : fallback;
}

export default async function registerMetricsRoutes(fastify) {
  fastify.register(async (instance) => {
    instance.addHook("preHandler", fastify.authenticate);

    instance.get(
      "/devices/:id/metrics/ai",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              start: { type: "string" },
              end: { type: "string" },
              limit: { type: "integer", minimum: 1, maximum: 20000 },
              companyId: { type: "string" },
            },
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        if (!id) {
          reply.code(400);
          return { code: "INVALID_DEVICE", message: "DeviceId obrigatório." };
        }

        let companyId;
        try {
          companyId = resolveCompanyId(request, request.query?.companyId);
        } catch (err) {
          if (err.code === "FORBIDDEN_COMPANY") {
            reply.code(403);
            return {
              code: "FORBIDDEN",
              message: "Acesso negado à empresa informada.",
            };
          }
          throw err;
        }

        const now = new Date();
        const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const start = parseDate(request.query?.start, defaultStart);
        const end = parseDate(request.query?.end, now);
        if (start >= end) {
          reply.code(400);
          return {
            code: "INVALID_RANGE",
            message: "Intervalo inválido (start >= end).",
          };
        }

        const limit = Number.isInteger(request.query?.limit)
          ? request.query.limit
          : 10000; // proteção simples

        // Pegamos leituras cruas para o período
        const sql = `
          SELECT ts, voltage, current, frequency, power_factor
          FROM telemetry_raw
          WHERE company_id = $1
            AND logical_id = $2
            AND ts >= $3
            AND ts <= $4
          ORDER BY ts ASC
          LIMIT $5;
        `;
        const params = [
          companyId,
          id,
          start.toISOString(),
          end.toISOString(),
          limit,
        ];

        const res = await runSql(sql, params);
        const readings = res.rows.map((r) => ({
          ts: r.ts,
          voltage: r.voltage,
          current: r.current,
          frequency: r.frequency,
          powerFactor: r.power_factor,
        }));

        // Usa o Gemini para calcular as 6 métricas padronizadas
        const metrics = await computeMetricsFromReadings(readings);

        return {
          deviceId: id,
          companyId,
          start: start.toISOString(),
          end: end.toISOString(),
          count: readings.length,
          ...metrics,
        };
      }
    );
  });
}
