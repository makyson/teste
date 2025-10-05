// src/metrics/geminiMetrics.js
import config from "../config.js";
import { GoogleAI } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.0-flash-001";
const ai = new GoogleAI({ apiKey: config.gemini.apiKey });

// ===== cache só para as métricas =====
let METRICS_CACHE_NAME = null;
let METRICS_CACHE_EXPIRES_AT = 0;

async function ensureMetricsCache() {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }
  const now = Date.now();
  if (METRICS_CACHE_NAME && now < METRICS_CACHE_EXPIRES_AT)
    return METRICS_CACHE_NAME;

  const modelName = config?.gemini?.model || DEFAULT_MODEL;

  // 👇 AQUI o uso do ai.caches.create para o contexto de métricas
  const cache = await ai.caches.create({
    model: `models/${modelName}`,
    displayName: "energia:metrics:v2",
    config: {
      systemInstruction: `
Você é um serviço de métricas elétricas.

REGRAS DE SAÍDA (OBRIGATÓRIO):
- Responda **apenas** JSON com **exatamente** estas 6 chaves numéricas:
  avgConsumo, avgVoltage, avgCurrent, avgFrequency, avgPowerFactor, avgAcumulado.
- Se algum valor não puder ser determinado, retorne 0 (zero).

INTERPRETAÇÃO:
- avgConsumo = consumo médio (kWh ou estimativa) no período recebido.
- avgAcumulado = energia acumulada no período recebido (soma).
- Os demais são médias simples de voltage, current, frequency, power_factor.
      `.trim(),
      contents: [],
    },
    ttl: "43200s",
  });

  METRICS_CACHE_NAME = cache?.name || null;
  const expireMsGuess = 43200 - 60;
  METRICS_CACHE_EXPIRES_AT = cache?.expireTime
    ? Date.parse(cache.expireTime)
    : Date.now() + expireMsGuess * 1000;

  if (!METRICS_CACHE_NAME)
    throw new Error("Cache METRICS criado, mas 'name' não retornou.");
  return METRICS_CACHE_NAME;
}

function coerceMetrics(obj) {
  const keys = [
    "avgConsumo",
    "avgVoltage",
    "avgCurrent",
    "avgFrequency",
    "avgPowerFactor",
    "avgAcumulado",
  ];
  const out = {};
  for (const k of keys) {
    const v = Number(obj?.[k]);
    out[k] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

export async function computeMetricsFromReadings(leituras) {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }
  const modelName = config?.gemini?.model || DEFAULT_MODEL;

  let cachedName = null;
  try {
    cachedName = await ensureMetricsCache();
  } catch {
    cachedName = null;
  }

  const userText = `
Calcule as métricas exigidas a partir das leituras abaixo e devolva apenas o JSON com as 6 chaves obrigatórias.
Leituras (JSON): ${JSON.stringify(leituras ?? [])}
`.trim();

  const model = ai.getGenerativeModel({ model: modelName });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: userText }] }],
    ...(cachedName ? { cachedContent: cachedName } : {}),
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 256,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          avgConsumo: { type: "number" },
          avgVoltage: { type: "number" },
          avgCurrent: { type: "number" },
          avgFrequency: { type: "number" },
          avgPowerFactor: { type: "number" },
          avgAcumulado: { type: "number" },
        },
        required: [
          "avgConsumo",
          "avgVoltage",
          "avgCurrent",
          "avgFrequency",
          "avgPowerFactor",
          "avgAcumulado",
        ],
      },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  });

  const text = result?.response?.text?.() ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    parsed =
      first >= 0 && last > first ? JSON.parse(text.slice(first, last + 1)) : {};
  }
  return coerceMetrics(parsed);
}
