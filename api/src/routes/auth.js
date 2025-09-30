function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export default async function registerAuthRoutes(fastify) {
  fastify.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 1 },
          companyId: { type: 'string', minLength: 1 }
        }
      },
      response: {
        200: {
          type: 'object',
          required: ['token', 'tokenType', 'expiresIn', 'companyId'],
          properties: {
            token: { type: 'string' },
            tokenType: { type: 'string', enum: ['Bearer'] },
            expiresIn: { type: 'string' },
            companyId: { type: 'string' }
          }
        },
        401: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    },
    handler: async (request, reply) => {
      const { username, password, companyId } = request.body;

      if (
        username !== fastify.config.auth.username ||
        password !== fastify.config.auth.password
      ) {
        fastify.log.warn({ username }, 'Tentativa de login inválida');
        reply.code(401);
        return {
          code: 'INVALID_CREDENTIALS',
          message: 'Usuário ou senha inválidos.'
        };
      }

      const normalizedCompanyId =
        normalizeString(companyId) || fastify.config.defaultCompanyId;

      const token = await reply.jwtSign({
        sub: username,
        companyId: normalizedCompanyId
      });

      fastify.log.info({ username }, 'Usuário autenticado com sucesso');

      return {
        token,
        tokenType: 'Bearer',
        expiresIn: fastify.config.auth.tokenExpiresIn,
        companyId: normalizedCompanyId
      };
    }
  });
}
