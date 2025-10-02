// C:\Users\makys\Downloads\teste\api\src\nlq\schedule.js
import config from "../config.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash";

// Campos canônicos preferidos quando o summary citar atributos
const COMMON_FIELDS = [
  "id",
  "lastTs",
  "voltage",
  "current",
  "frequency",
  "powerFactor",
];

function buildSchedulePrompt(text) {
  const common = COMMON_FIELDS.map((f) => `\`${f}\``).join(", ");

  const schemaContext = `
Esquema disponível (não invente tabelas/colunas fora disso):
- telemetry_raw(company_id, logical_id, ts, voltage, current, frequency, power_factor, payload)
- ca_device_daily_energy(company_id, logical_id, day, kwh_estimated)
- ca_device_daily_simple(company_id, logical_id, day, avg_power, min_freq, max_freq, pf_avg)
- companies(id), sites(id, company_id), logical_devices(id, site_id)
- daily_metrics(company_id, device_id, site_id, day, kwh, avg_power, min_freq, max_freq, pf_avg)
`;

  return `Você é um assistente que converte descrições em linguagem natural para expressões cron.

Retorne estritamente um JSON válido com este formato:
{"cron":"<expressão cron ou vazio se impossível>","summary":"<explicação curta>"}

Regras:
- Use cron padrão com 5 campos (minuto hora dia-mês mês dia-semana) em UTC.
- Periodicidade:
  - "a cada N minutos" → "*/N * * * *"
  - "a cada N horas"   → "0 */N * * *"
- Se a descrição incluir data única (ex.: "20/09/2025 às 08:00"), gere uma expressão que rode naquela data (ex.: "0 8 20 9 *") e destaque no summary que é execução única.
- Se não conseguir interpretar, devolva cron vazio e explique o motivo no summary.

Contexto de dados (para evitar inventar campos):
${schemaContext.trim()}

Quando o SUMMARY citar atributos, **prefira** os identificadores canônicos: ${common}.
- Mapeie sinônimos para os canônicos e **cite apenas o canônico** (ex.: device_id/logical_id → \`id\`; ts/timestamp → \`lastTs\`; power_factor → \`powerFactor\`; freq → \`frequency\`).
- O SELECT final NÃO deve expor colunas agregadas como total_kwh, max_kwh_anual, weekly_kwh, total_amps etc.
- O SELECT final deve expor SOMENTE campos canônicos.
- **Não** inclua unidades, símbolos ou prefixos (sem V/A/Hz/k etc.). Apenas o nome do campo.
- Se a consulta envolver consumo (kWh), descreva a ação no summary sem inventar identificadores novos; use texto natural (ex.: "maior consumo nas últimas 24h") e cite campos canônicos só se necessário.

Exemplos (estilo; a saída final deve ser **apenas** o JSON):
Entrada: "a cada 2 minutos me avise os top 10 por consumo nas últimas 24h"
Saída: {"cron":"*/2 * * * *","summary":"A cada 2 minutos (UTC), identificar top 10 por consumo das últimas 24h."}

Entrada: "todo dia às 08:00 checar tensão e corrente das últimas 24h"
Saída: {"cron":"0 8 * * *","summary":"Diariamente às 08:00 UTC, analisar \`voltage\` e \`current\` nas últimas 24h; usando \`lastTs\` como referência."}

Entrada: "a cada 2 horas avaliar fator de potência"
Saída: {"cron":"0 */2 * * *","summary":"A cada 2h (UTC) verificar \`powerFactor\` por \`id\`."}

Descrição: ${text}


`;
}

export async function generateScheduleCron({ text }) {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/models/${model}:generateContent`;
  const prompt = buildSchedulePrompt(text);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": config.gemini.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
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
      `Gemini schedule falhou (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const combined = parts
    .map((p) => p?.text ?? "")
    .join("\n")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(combined);
  } catch {
    throw new Error("Gemini não retornou JSON válido para o cron.");
  }

  const cron = typeof parsed?.cron === "string" ? parsed.cron.trim() : "";
  const summary =
    typeof parsed?.summary === "string" ? parsed.summary.trim() : "";

  if (!cron) {
    const message =
      summary || "Não foi possível interpretar o agendamento informado.";
    const error = new Error(message);
    error.code = "INVALID_SCHEDULE";
    throw error;
  }

  return { cron, summary };
}
