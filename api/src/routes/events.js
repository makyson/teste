import { listEvents, clearCompanyEvents, clearAllEvents } from '../events/store.js';

function resolveCompanyId(request, explicit) {
  const tokenCompany = request.user?.companyId;
  if (explicit && tokenCompany && explicit !== tokenCompany) {
    const err = new Error('FORBIDDEN_COMPANY');
    err.statusCode = 403;
    err.code = 'FORBIDDEN_COMPANY';
    throw err;
  }
  const fallback = request.server?.config?.defaultCompanyId;
  const value = explicit ?? tokenCompany ?? fallback;
  return typeof value === 'string' && value.length ? value : fallback;
}

export default async function registerEventsRoutes(fastify) {
  fastify.register(async (instance) => {
    instance.addHook('preHandler', fastify.authenticate);

    instance.get('/events', {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            companyId: { type: 'string' },
            type: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 200 }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    ruleId: { type: 'string' },
                    name: { type: 'string' },
                    companyId: { type: 'string' },
                    generatedAt: { type: 'string' },
                    metadata: { type: 'object' },
                    rows: {
                      type: 'array',
                      items: { type: 'object' }
                    }
                  },
                  additionalProperties: true
                }
              }
            },
            required: ['items']
          }
        }
      }
    }, async (request, reply) => {
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

      const type = request.query?.type || null;
      const limit = typeof request.query?.limit === 'number' ? request.query.limit : undefined;
      const events = listEvents(companyId, { type, limit });
      return { items: events };
    });
  });
}



