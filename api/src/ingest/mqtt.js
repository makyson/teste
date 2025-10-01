import mqtt from 'mqtt';
import { insertTelemetry } from '../db/timescale.js';

function extractCompanyId(topic) {
  const pattern = /^companies\/([^/]+)\/boards\/[^/]+\/telemetry$/;
  const match = topic.match(pattern);
  if (!match) {
    return null;
  }
  return match[1];
}

export function startMqttIngest({ config, logger, hub }) {
  const client = mqtt.connect(config.mqtt.url, {
    reconnectPeriod: 5_000
  });

  client.on('connect', () => {
    logger.info({ topic: config.mqtt.topic }, 'Conectado ao broker MQTT');
    client.subscribe(config.mqtt.topic, (err) => {
      if (err) {
        logger.error({ err }, 'Falha ao assinar tópico MQTT');
      } else {
        logger.info({ topic: config.mqtt.topic }, 'Assinatura MQTT concluída');
      }
    });
  });

  client.on('error', (err) => {
    logger.error({ err }, 'Erro no cliente MQTT');
  });

  client.on('message', async (topic, payloadBuffer) => {
    const companyId = extractCompanyId(topic);
    if (!companyId) {
      logger.warn({ topic }, 'Tópico desconhecido recebido');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(payloadBuffer.toString('utf8'));
    } catch (err) {
      logger.error({ err, topic }, 'Falha ao parsear mensagem MQTT');
      return;
    }

    if (!payload.logical_id || !payload.ts) {
      logger.warn({ topic, payload }, 'Mensagem MQTT incompleta, ignorando');
      return;
    }

    try {
      await insertTelemetry({
        companyId,
        logicalId: payload.logical_id,
        ts: payload.ts,
        voltage: payload.voltage ?? null,
        current: payload.current ?? null,
        frequency: payload.frequency ?? null,
        powerFactor: payload.power_factor ?? null,
        payload
      });

      if (hub) {
        hub.broadcast(companyId, {
          type: 'device.telemetry',
          companyId,
          deviceId: payload.logical_id,
          sample: {
            logical_id: payload.logical_id,
            ts: payload.ts,
            voltage: payload.voltage ?? null,
            current: payload.current ?? null,
            frequency: payload.frequency ?? null,
            power_factor: payload.power_factor ?? null
          }
        });
      }
    } catch (err) {
      logger.error({ err, topic }, 'Falha ao inserir telemetria');
    }
  });

  return () =>
    new Promise((resolve) => {
      client.end(false, {}, resolve);
    });
}
