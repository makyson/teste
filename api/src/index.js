import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import config from './config.js';
import registerHealthRoute from './routes/health.js';
import registerNlqRoute from './routes/nlq.js';
import registerRulesRoute from './routes/rules.js';
import registerAuthRoute from './routes/auth.js';
import registerTelemetryRoute from './routes/telemetry.js';
import { WebsocketHub } from './ws/hub.js';
import { createRuleManager } from './rules/manager.js';
import { verifyConnectivity as verifyTimescale, closePool } from './db/timescale.js';
import { verifyConnectivity as verifyNeo4j, closeDriver } from './db/neo4j.js';
import { startMqttIngest } from './ingest/mqtt.js';

const app = fastify({
  logger: {
    level: config.logLevel
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.decorate('config', config);

app.register(fastifyWebsocket, { options: { maxPayload: 1048576 } });
app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/app/',
  decorateReply: false
});

const wsHub = new WebsocketHub(app.log);
app.decorate('wsHub', wsHub);
app.decorate('ruleManager', null);

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

app.register((instance, _opts, done) => {
  instance.get('/ws', { websocket: true }, (connection, request) => {
    const { socket } = connection;
    let token = null;
    try {
      const url = new URL(request.raw.url, 'http://localhost');
      token = url.searchParams.get('token');
    } catch (err) {
      socket.close(4001, 'INVALID_REQUEST');
      return;
    }

    if (!token) {
      socket.close(4001, 'TOKEN_REQUIRED');
      return;
    }

    instance.jwt.verify(token, (err, decoded) => {
      if (err) {
        socket.close(4003, 'INVALID_TOKEN');
        return;
      }

      const companyId = decoded?.companyId ?? instance.config.defaultCompanyId;
      wsHub.addClient({ companyId, socket, user: decoded });
      try {
        socket.send(JSON.stringify({ type: 'welcome', companyId }));
      } catch (sendErr) {
        instance.log.error({ err: sendErr }, 'Falha ao enviar mensagem de boas-vindas');
      }
    });
  });
  done();
});

app.register(registerHealthRoute);
app.register(registerAuthRoute);
app.register(registerNlqRoute);
app.register(registerTelemetryRoute);
app.register(registerRulesRoute);

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

  const ruleManager = createRuleManager({
    log: app.log,
    hub: wsHub
  });
  app.ruleManager = ruleManager;
  await ruleManager.start();

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

  if (app.ruleManager) {
    try {
      await app.ruleManager.stop();
    } catch (err) {
      app.log.error({ err }, 'Erro ao parar o gerenciador de regras');
    }
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

  wsHub.clear();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
