import process from 'node:process';
import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import config from './config.js';
import registerHealthRoute from './routes/health.js';
import registerNlqRoute from './routes/nlq.js';
import registerAuthRoute from './routes/auth.js';
import { verifyConnectivity as verifyTimescale, closePool } from './db/timescale.js';
import { verifyConnectivity as verifyNeo4j, closeDriver } from './db/neo4j.js';
import { startMqttIngest } from './ingest/mqtt.js';

const app = fastify({
  logger: {
    level: config.logLevel
  }
});

app.decorate('config', config);

app.register(fastifyJwt, {
  secret: config.auth.jwtSecret,
  sign: {
    expiresIn: config.auth.tokenExpiresIn
  }
});

app.decorate('authenticate', async function authenticate(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.warn({ err }, 'Falha na verificação do token JWT');
    const error = new Error('Token inválido ou ausente.');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }
});

app.register(registerHealthRoute);
app.register(registerAuthRoute);
app.register(registerNlqRoute);

let stopMqtt = null;

async function boot() {
  try {
    await verifyTimescale();
    app.log.info('TimescaleDB conectado.');
  } catch (err) {
    app.log.error({ err }, 'Falha ao conectar no TimescaleDB');
    throw err;
  }

  try {
    await verifyNeo4j();
    app.log.info('Neo4j conectado.');
  } catch (err) {
    app.log.error({ err }, 'Falha ao conectar no Neo4j');
    throw err;
  }

  stopMqtt = startMqttIngest({
    config,
    logger: app.log
  });

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`[api] listening on ${config.port}`);
  } catch (err) {
    app.log.error({ err }, 'Falha ao iniciar servidor');
    throw err;
  }
}

boot().catch((err) => {
  app.log.error({ err }, 'Erro fatal na inicialização');
  process.exit(1);
});

async function shutdown(signal) {
  app.log.info({ signal }, 'Encerrando aplicação');
  try {
    if (stopMqtt) {
      await stopMqtt();
    }
    await app.close();
  } catch (err) {
    app.log.error({ err }, 'Erro ao fechar Fastify');
  }

  try {
    await closePool();
  } catch (err) {
    app.log.error({ err }, 'Erro ao fechar pool Postgres');
  }

  try {
    await closeDriver();
  } catch (err) {
    app.log.error({ err }, 'Erro ao fechar driver Neo4j');
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
