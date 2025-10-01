// src/routes/telemetry.js
import { insertTelemetry } from "../db/timescale.js";

function normalizeIncomingBody(body) {
  // Suporta: objeto único, array de objetos, ou { samples: [...] }
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (Array.isArray(body.samples)) return body.samples;
    return [body];
  }
  return [];
}

function toSnakeSample(sample) {
  // aceita camelCase e snake_case e devolve sempre snake_case
  const s = sample || {};
  const logical_id =
    s.logical_id ?? s.logicalId ?? s.deviceId ?? s.device_id ?? null;
  const ts = s.ts ?? s.timestamp ?? s.time ?? null;
  const voltage = s.voltage ?? null;
  const current = s.current ?? null;
  const frequency = s.frequency ?? null;
  const power_factor = s.power_factor ?? s.powerFactor ?? null;
  return { logical_id, ts, voltage, current, frequency, power_factor, _raw: s };
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function validateSample(s) {
  const errs = [];
  if (!s.logical_id) errs.push("logical_id ausente");
  if (!s.ts) errs.push("ts ausente");

  // valida ISO date rapidamente
  if (s.ts) {
    const t = Date.parse(s.ts);
    if (Number.isNaN(t))
      errs.push("ts inválido (use ISO 8601, ex: 2025-09-01T00:00:00Z)");
  }

  if (s.voltage != null && !isFiniteNumber(s.voltage))
    errs.push("voltage inválido");
  if (s.current != null && !isFiniteNumber(s.current))
    errs.push("current inválido");
  if (s.frequency != null && !isFiniteNumber(s.frequency))
    errs.push("frequency inválido");
  if (s.power_factor != null) {
    if (!isFiniteNumber(s.power_factor)) errs.push("power_factor inválido");
    else if (s.power_factor < 0 || s.power_factor > 1)
      errs.push("power_factor fora de 0..1");
  }
  return errs;
}

export default async function registerTelemetryRoutes(fastify) {
  fastify.post(
    "/companies/:companyId/boards/:boardId/telemetry",
    {
      preValidation: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["companyId", "boardId"],
          properties: {
            companyId: { type: "string", minLength: 1 },
            boardId: { type: "string", minLength: 1 },
          },
        },
        body: {
          // continuamos compatíveis com o que você tinha
          oneOf: [
            {
              type: "object",
              required: ["logical_id", "ts"],
              properties: {
                logical_id: { type: "string", minLength: 1 },
                ts: { type: "string", minLength: 1 },
                voltage: { type: "number" },
                current: { type: "number" },
                frequency: { type: "number" },
                power_factor: { type: "number" },
              },
            },
            {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["logical_id", "ts"],
                properties: {
                  logical_id: { type: "string", minLength: 1 },
                  ts: { type: "string", minLength: 1 },
                  voltage: { type: "number" },
                  current: { type: "number" },
                  frequency: { type: "number" },
                  power_factor: { type: "number" },
                },
              },
            },
            // plus: { "samples": [ ... ] }
            {
              type: "object",
              required: ["samples"],
              properties: {
                samples: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    required: ["logical_id", "ts"],
                    properties: {
                      logical_id: { type: "string", minLength: 1 },
                      ts: { type: "string", minLength: 1 },
                      voltage: { type: "number" },
                      current: { type: "number" },
                      frequency: { type: "number" },
                      power_factor: { type: "number" },
                    },
                  },
                },
              },
            },
          ],
        },
        response: {
          202: {
            type: "object",
            required: ["accepted"],
            properties: {
              accepted: { type: "integer", minimum: 1 },
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer" },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer" },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { companyId, boardId } = request.params;

      const incoming = normalizeIncomingBody(request.body);
      if (incoming.length === 0) {
        reply.code(400);
        return {
          code: "INVALID_PAYLOAD",
          message:
            'Envie um objeto, um array, ou {"samples":[...]} com amostras válidas.',
        };
      }

      let accepted = 0;
      const errors = [];

      for (let i = 0; i < incoming.length; i += 1) {
        const snake = toSnakeSample(incoming[i]);
        const errs = validateSample(snake);
        if (errs.length) {
          errors.push({
            index: i,
            reason: `payload inválido: ${errs.join(", ")}`,
          });
          continue;
        }

        try {
          await insertTelemetry({
            companyId,
            logicalId: snake.logical_id,
            ts: snake.ts,
            voltage: snake.voltage ?? null,
            current: snake.current ?? null,
            frequency: snake.frequency ?? null,
            powerFactor: snake.power_factor ?? null,
            // mantém o payload bruto + board_id para auditoria
            payload: { ...snake._raw, board_id: boardId },
          });
          fastify.wsHub?.broadcast(companyId, {
            type: 'device.telemetry',
            companyId,
            deviceId: snake.logical_id,
            sample: {
              logical_id: snake.logical_id,
              ts: snake.ts,
              voltage: snake.voltage ?? null,
              current: snake.current ?? null,
              frequency: snake.frequency ?? null,
              power_factor: snake.power_factor ?? null
            }
          });

          accepted += 1;
        } catch (err) {
          fastify.log.error(
            { err, sample: snake },
            "Falha ao inserir amostra de telemetria"
          );
          errors.push({ index: i, reason: err?.message || "falha ao inserir" });
        }
      }

      if (accepted === 0) {
        reply.code(400);
        return {
          code: "NO_SAMPLES_ACCEPTED",
          message: "Nenhuma amostra válida foi processada.",
          errors,
        };
      }

      reply.code(202);
      return { accepted, ...(errors.length ? { errors } : {}) };
    }
  );
}
