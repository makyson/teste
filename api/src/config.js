import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const rootDir = path.resolve(new URL('../../', import.meta.url).pathname);
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const requiredVars = [
  'PORT',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'NEO4J_URI',
  'NEO4J_USER',
  'NEO4J_PASSWORD',
  'MQTT_URL',
  'MQTT_TOPIC',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'DEFAULT_COMPANY_ID',
  'JWT_SECRET',
  'AUTH_USERNAME',
  'AUTH_PASSWORD'
];

const config = {};

for (const key of requiredVars) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  config[key] = value;
}

config.NODE_ENV = process.env.NODE_ENV || 'development';
config.REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
config.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
config.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

export default Object.freeze({
  port: Number.parseInt(config.PORT, 10) || 3000,
  nodeEnv: config.NODE_ENV,
  postgres: {
    host: config.PGHOST,
    port: Number.parseInt(config.PGPORT, 10) || 5432,
    database: config.PGDATABASE,
    user: config.PGUSER,
    password: config.PGPASSWORD
  },
  neo4j: {
    uri: config.NEO4J_URI,
    user: config.NEO4J_USER,
    password: config.NEO4J_PASSWORD
  },
  mqtt: {
    url: config.MQTT_URL,
    topic: config.MQTT_TOPIC
  },
  redis: {
    url: config.REDIS_URL
  },
  gemini: {
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL
  },
  defaultCompanyId: config.DEFAULT_COMPANY_ID,
  logLevel: config.LOG_LEVEL,
  auth: {
    username: config.AUTH_USERNAME,
    password: config.AUTH_PASSWORD,
    jwtSecret: config.JWT_SECRET,
    tokenExpiresIn: config.JWT_EXPIRES_IN
  }
});
