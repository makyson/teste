import config from '../config.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';

function buildSchedulePrompt(text) {
  return `Você é um assistente que converte descrições em linguagem natural para expressões cron.
Retorne estritamente um JSON válido com este formato:
{"cron":"<expressão cron ou vazio se impossível>","summary":"<explicação curta>"}

Regras:
- Use cron padrão com 5 campos (minuto hora dia-mês mês dia-semana) em UTC.
- Se a descrição incluir data única (ex.: "20/09/2025 às 08:00"), gere uma expressão que rode naquela data (ex.: "0 8 20 9 *") e destaque no summary que é execução única.
- Se mencionar periodicidade em minutos/horas ("a cada 2 horas"), converta para cron aproximado (ex.: "0 */2 * * *").
- Se não conseguir interpretar, devolva cron vazio e explique o motivo no summary.

Descrição: ${text}`;
}

export async function generateScheduleCron({ text }) {
  if (!config?.gemini?.apiKey) {
    throw new Error('GEMINI_API_KEY ausente no ambiente.');
  }

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/models/${model}:generateContent`;

  const prompt = buildSchedulePrompt(text);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.gemini.apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini schedule falhou (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const combined = parts.map((p) => p?.text ?? '').join('\n').trim();

  let parsed;
  try {
    parsed = JSON.parse(combined);
  } catch (err) {
    throw new Error('Gemini não retornou JSON válido para o cron.');
  }

  const cron = typeof parsed?.cron === 'string' ? parsed.cron.trim() : '';
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';

  if (!cron) {
    const message = summary || 'Não foi possível interpretar o agendamento informado.';
    const error = new Error(message);
    error.code = 'INVALID_SCHEDULE';
    throw error;
  }

  return { cron, summary };
}
