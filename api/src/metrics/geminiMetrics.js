// src/metrics/geminiMetrics.js
import config from "../config.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash-001";

// ===== Caching API (idempotente) =====
let METRICS_CACHE_NAME = null;
let METRICS_CACHE_EXPIRES_AT = 0;

async function ensureMetricsCache() {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }
  const now = Date.now();
  if (METRICS_CACHE_NAME && now < METRICS_CACHE_EXPIRES_AT)
    return METRICS_CACHE_NAME;

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/cachedContents?key=${encodeURIComponent(
    config.gemini.apiKey
  )}`;

  const systemInstruction = `
Você é um serviço de métricas elétricas.

REGRAS DE SAÍDA (OBRIGATÓRIO):
- Responda **apenas** JSON com **exatamente** estas 6 chaves numéricas:
  avgConsumo, avgVoltage, avgCurrent, avgFrequency, avgPowerFactor, avgAcumulado.
- Proibido qualquer outra chave (ex.: total_kwh, TOTAL_KWH, texto, comentários).
- Se algum valor não puder ser determinado, retorne 0 (zero).

INTERPRETAÇÃO:
- avgConsumo = consumo médio (kWh ou estimativa) no período recebido.
- avgAcumulado = energia acumulada no período recebido (soma).
- Os demais são médias simples das colunas: voltage, current, frequency, power_factor.

NÃO invente dados. Baseie-se **somente** nas leituras fornecidas no prompt do usuário.
  `.trim();

  const ttlSeconds = 12 * 60 * 60; // 12h

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: "energia:metrics:v1",
      systemInstruction: { parts: [{ text: systemInstruction }] },
      ttl: `${ttlSeconds}s`,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha ao criar cache METRICS (${res.status}): ${t}`);
  }

  const data = await res.json();
  METRICS_CACHE_NAME = data?.name || null;
  METRICS_CACHE_EXPIRES_AT = now + (ttlSeconds - 60) * 1000;

  if (!METRICS_CACHE_NAME) {
    throw new Error("Cache METRICS criado, mas 'name' não retornou.");
  }
  return METRICS_CACHE_NAME;
}

function coerceMetrics(obj) {
  const allowed = [
    "avgConsumo",
    "avgVoltage",
    "avgCurrent",
    "avgFrequency",
    "avgPowerFactor",
    "avgAcumulado",
  ];
  const out = {};
  for (const k of allowed) {
    const v = Number(obj?.[k]);
    out[k] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

export async function computeMetricsFromReadings(leituras) {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/models/${model}:generateContent`;

  let cachedContent = null;
  try {
    cachedContent = await ensureMetricsCache();
  } catch (err) {
    cachedContent = null; // se der erro no cache, segue sem ele
  }

  const userText = `
Calcule métricas a partir das leituras abaixo e devolva apenas o JSON com as 6 chaves obrigatórias.
Leituras (JSON): ${JSON.stringify(leituras ?? [])}
`.trim();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.gemini.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      cachedContent: cachedContent || undefined,
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 256,
        responseMimeType: "application/json",
        // Structured Output (schema)
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
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini(metrics) falhou (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p) => p?.text ?? "")
    .join("\n")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fallback defensivo: tenta extrair do primeiro/último { }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    parsed =
      first >= 0 && last > first ? JSON.parse(text.slice(first, last + 1)) : {};
  }

  return coerceMetrics(parsed);
}
