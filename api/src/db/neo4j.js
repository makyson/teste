import neo4j from 'neo4j-driver';
import config from '../config.js';

const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
  {
    encrypted: 'ENCRYPTION_OFF'
  }
);

export async function verifyConnectivity() {
  await driver.verifyConnectivity();
}

export async function runCypher(query, params = {}) {
  const session = driver.session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

export async function closeDriver() {
  await driver.close();
}

export default driver;
