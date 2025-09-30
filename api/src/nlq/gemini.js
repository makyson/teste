// src/nlq/gemini.js
import config from '../config.js';
import { buildPrompt } from './prompts.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function sanitizeCypher(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```(?:cypher)?\s*/i, '');
  cleaned = cleaned.replace(/```$/i, '');
  cleaned = cleaned.replace(/^(?:cypher|consulta)\s*:\s*/i, '');
  return cleaned.trim();
}

function pickTextFromResponse(data) {
  // Concatena todas as parts de texto do primeiro candidato
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p?.text ?? '').join('\n').trim();
}

export async function generateCypher({ text, companyId }) {
  if (!config?.gemini?.apiKey) {
    throw new Error('GEMINI_API_KEY ausente no ambiente.');
  }

  const model = config?.gemini?.model || 'gemini-1.5-flash';
  const endpoint = `${BASE_URL}/models/${model}:generateContent`;

  const prompt = buildPrompt({ text, companyId });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ✅ AI Studio: use x-goog-api-key (sem Authorization)
      'x-goog-api-key': config.gemini.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
      // (opcional) relaxa bloqueios que podem cortar o Cypher
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    // Dica: 401 → header errado; 403 → chave sem permissão/restrições no console
    throw new Error(`Gemini respondeu com status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawText = pickTextFromResponse(data);
  const cypher = sanitizeCypher(rawText);

  if (!cypher) {
    throw new Error('Gemini não retornou uma consulta Cypher.');
  }
  return cypher;
}
