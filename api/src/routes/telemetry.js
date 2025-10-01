import { insertTelemetry } from '../db/timescale.js';

function normalizeSamples(body) {
  if (Array.isArray(body)) {
    return body;
  }

  if (body && typeof body === 'object') {
    return [body];
  }

  return [];
}

export default async function registerTelemetryRoutes(fastify) {
  fastify.post('/companies/:companyId/boards/:boardId/telemetry', {
    preValidation: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['companyId', 'boardId'],
        properties: {
          companyId: { type: 'string', minLength: 1 },
          boardId: { type: 'string', minLength: 1 }
        }
      },
      body: {
        oneOf: [
          {
            type: 'object',
            required: ['logical_id', 'ts'],
            properties: {
              logical_id: { type: 'string', minLength: 1 },
              ts: { type: 'string', minLength: 1 },
              voltage: { type: 'number' },
              current: { type: 'number' },
              frequency: { type: 'number' },
              power_factor: { type: 'number' }
            }
          },
          {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['logical_id', 'ts'],
              properties: {
                logical_id: { type: 'string', minLength: 1 },
                ts: { type: 'string', minLength: 1 },
                voltage: { type: 'number' },
                current: { type: 'number' },
                frequency: { type: 'number' },
                power_factor: { type: 'number' }
              }
            }
          }
        ]
      },
      response: {
        202: {
          type: 'object',
          required: ['accepted'],
          properties: {
            accepted: { type: 'integer', minimum: 1 }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { companyId, boardId } = request.params;
    const samples = normalizeSamples(request.body);

    if (samples.length === 0) {
      reply.code(400);
      return {
        code: 'INVALID_PAYLOAD',
        message: 'O corpo da requisição deve ser um objeto ou array com amostras válidas.'
      };
    }

    let accepted = 0;

    for (const sample of samples) {
      if (!sample.logical_id || !sample.ts) {
        fastify.log.warn({ sample }, 'Amostra ignorada por falta de logical_id ou ts');
        continue;
      }

      try {
        await insertTelemetry({
          companyId,
          logicalId: sample.logical_id,
          ts: sample.ts,
          voltage: sample.voltage ?? null,
          current: sample.current ?? null,
          frequency: sample.frequency ?? null,
          powerFactor: sample.power_factor ?? null,
          payload: { ...sample, board_id: boardId }
        });
        accepted += 1;
      } catch (err) {
        fastify.log.error({ err, sample }, 'Falha ao inserir amostra de telemetria');
      }
    }

    if (accepted === 0) {
      reply.code(400);
      return {
        code: 'NO_SAMPLES_ACCEPTED',
        message: 'Nenhuma amostra válida foi processada.'
      };
    }

    reply.code(202);
    return { accepted };
  });
}
