// C:\Users\makys\Downloads\teste\api\src\nlq\schedule.js
import config from "../config.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash";

// Vocabulário comum esperado pelo front quando o summary citar atributos
// (não é regra rígida; é preferência forte no prompt)
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

  // Resumo do seu esquema real para evitar alucinação de campos
  const schemaContext = `
Esquema disponível (não invente tabelas/colunas fora disso):

TABELA: telemetry_raw
- company_id (TEXT), logical_id (TEXT), ts (TIMESTAMPTZ), voltage (DOUBLE), current (DOUBLE), frequency (DOUBLE), power_factor (DOUBLE), payload (JSONB)

MV: ca_device_daily_energy
- company_id, logical_id, day (DATE), kwh_estimated (DOUBLE)

CA CONTÍNUO: ca_device_daily_simple
- company_id, logical_id, day (DATE), avg_power (DOUBLE), min_freq (DOUBLE), max_freq (DOUBLE), pf_avg (DOUBLE)

VIEWS:
- companies(id)
- sites(id, company_id)
- logical_devices(id, site_id)
- daily_metrics(company_id, device_id, site_id, day, kwh, avg_power, min_freq, max_freq, pf_avg)
`;

  return `Você é um assistente que converte descrições em linguagem natural para expressões cron.

Retorne estritamente um JSON válido com este formato:
{"cron":"<expressão cron ou vazio se impossível>","summary":"<explicação curta>"}

Regras:
- Use cron padrão com 5 campos (minuto hora dia-mês mês dia-semana) em UTC.
- Se a descrição incluir data única (ex.: "20/09/2025 às 08:00"), gere uma expressão que rode naquela data (ex.: "0 8 20 9 *") e destaque no summary que é execução única.
- Se mencionar periodicidade em minutos/horas ("a cada 2 horas"), converta para cron aproximado (ex.: "0 */2 * * *").
- Se não conseguir interpretar, devolva cron vazio e explique o motivo no summary.

Contexto de dados disponíveis (para evitar inventar campos):
${schemaContext.trim()}

Quando o SUMMARY citar atributos, **prefira** usar SOMENTE estes identificadores canônicos: ${common}.
- Mapeie sinônimos para os canônicos e **cite apenas o canônico**:
  - device_id, logical_id → \`id\`
  - ts, timestamp → \`lastTs\`
  - power_factor → \`powerFactor\`
  - freq → \`frequency\`
  - voltage → \`voltage\`
  - current → \`current\`
- **Não** inclua unidades, símbolos ou prefixos (não escreva V/A/Hz/k, etc.). Apenas o nome do campo.
- Se a consulta envolver métricas agregadas (ex.: consumo em kWh), descreva a ação no summary **sem introduzir novos nomes de campo**; use texto natural (ex.: "maior consumo nas últimas 24h") ao invés de citar um identificador não canônico.
- Cite campos **apenas** quando necessário para clareza; do contrário, mantenha o summary curto e direto.
- NÃO invente novos nomes de campos ou de tabelas. Baseie-se no contexto de esquema acima.

Exemplos (somente estilo; a resposta final deve ser **apenas** o JSON pedido):
Entrada: "todo dia às 08:00 checar tensão e corrente das últimas 24h"
Saída: {"cron":"0 8 * * *","summary":"Diariamente às 08:00 UTC, analisar \`voltage\` e \`current\` nas últimas 24h; usando \`lastTs\` como referência."}

Entrada: "rodar em 20/09/2025 08:00 um relatório de frequência"
Saída: {"cron":"0 8 20 9 *","summary":"Execução única em 20/09/2025 08:00 UTC para \`frequency\`."}

Entrada: "a cada 2 horas avaliar fator de potência"
Saída: {"cron":"0 */2 * * *","summary":"A cada 2h (UTC) verificar \`powerFactor\` por \`id\`."}

Descrição: ${text}`;
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
      "Content-Type": "application/json",
      "x-goog-api-key": config.gemini.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
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
