import config from '../config.js';
import { buildPrompt } from './prompts.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function sanitizeCypher(text) {
  if (!text) {
    return '';
  }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```cypher\s*/i, '');
  cleaned = cleaned.replace(/^```/i, '');
  cleaned = cleaned.replace(/```$/i, '');
  cleaned = cleaned.replace(/^cypher\s*:/i, '');
  cleaned = cleaned.replace(/^consulta\s*:/i, '');
  cleaned = cleaned.trim();
  return cleaned;
}

export async function generateCypher({ text, companyId }) {
  const prompt = buildPrompt({ text, companyId });
  const endpoint = `${BASE_URL}/models/${config.gemini.model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.gemini.apiKey}`
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini respondeu com status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const cypher = sanitizeCypher(candidate);

  if (!cypher) {
    throw new Error('Gemini não retornou uma consulta Cypher.');
  }

  return cypher;
}
