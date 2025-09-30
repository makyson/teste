// src/nlq/gemini.js
import config from '../config.js';
import { buildPrompt } from './prompts.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash'; // modelos 1.5 foram descontinuados no v1beta

function pickTextFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p?.text ?? '').join('\n').trim();
}

function stripCodeFences(s) {
  if (!s) return '';
  let out = String(s).trim();

  // remove cercas tipo ```json ... ```
  out = out.replace(/^```(?:json)?\s*/i, '');
  out = out.replace(/```$/i, '');

  // remove prefixos "cypher:" ou "consulta:" caso venham antes do conteúdo
  out = out.replace(/^(?:cypher|consulta)\s*:\s*/i, '');

  return out.trim();
}

function tryExtractJson(text) {
  if (!text) return null;

  // 1) bloco ```json ... ```
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  // 2) tenta parsear tudo
  try { JSON.parse(text); return text; } catch {}

  // 3) heurística: pega do primeiro '{' ao último '}' e tenta parsear
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    try { JSON.parse(slice); return slice; } catch {}
  }

  return null;
}

export async function generateQueries({ text, companyId, scope = 'company' }) {
  if (!config?.gemini?.apiKey) {
    throw new Error('GEMINI_API_KEY ausente no ambiente.');
  }

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/models/${model}:generateContent`;

  // buildPrompt pode ou não usar "scope"; se ignorar, não há problema
  const prompt = buildPrompt({ text, companyId, scope });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // AI Studio usa x-goog-api-key (NÃO usar Authorization com API key)
      'x-goog-api-key': config.gemini.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini respondeu com status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const textOut = pickTextFromResponse(data);

  const jsonStr = tryExtractJson(textOut);
  if (!jsonStr) {
    throw new Error('Gemini não retornou JSON válido com {cypher, sql}.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Falha ao parsear JSON retornado pelo Gemini.');
  }

  let cypher = stripCodeFences(parsed?.cypher || '');
  let sql    = stripCodeFences(parsed?.sql || '');

  if (!sql) throw new Error('SQL ausente na resposta do Gemini.');

  // Pequena higienização adicional (caso o modelo incline blocos de código)
  if (/^```/.test(cypher)) cypher = stripCodeFences(cypher);
  if (/^```/.test(sql))    sql    = stripCodeFences(sql);

  return { cypher, sql };
}
