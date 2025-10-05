// src/nlq/gemini.js
import config from "../config.js";
import {
  buildSystemInstruction,
  buildUserFooter,
  buildPrompt,
} from "./prompts.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash-001"; // seguro para v1beta

// ===== helpers =====
function pickTextFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((p) => p?.text ?? "")
    .join("\n")
    .trim();
}

function stripCodeFences(s) {
  if (!s) return "";
  let out = String(s).trim();
  out = out.replace(/^```(?:json)?\s*/i, "");
  out = out.replace(/```$/i, "");
  out = out.replace(/^(?:cypher|consulta)\s*:\s*/i, "");
  return out.trim();
}

function tryExtractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  try {
    JSON.parse(text);
    return text;
  } catch {}

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    try {
      JSON.parse(slice);
      return slice;
    } catch {}
  }
  return null;
}

// ===== Caching API (idempotente) =====
let NLQ_CACHE_NAME = null; // ex.: "cachedContents/123..."
let NLQ_CACHE_EXPIRES_AT = 0;

async function ensureNlqCache() {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }
  const now = Date.now();
  if (NLQ_CACHE_NAME && now < NLQ_CACHE_EXPIRES_AT) return NLQ_CACHE_NAME;

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/cachedContents?key=${encodeURIComponent(
    config.gemini.apiKey
  )}`;

  const systemInstruction = buildSystemInstruction();
  const ttlSeconds = 12 * 60 * 60; // 12h

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: "energia:nlq:v1",
      systemInstruction: { parts: [{ text: systemInstruction }] },
      ttl: `${ttlSeconds}s`,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha ao criar cache NLQ (${res.status}): ${t}`);
  }

  const data = await res.json();
  NLQ_CACHE_NAME = data?.name || null;
  // vale até agora + ttl - 60s (margem)
  NLQ_CACHE_EXPIRES_AT = now + (ttlSeconds - 60) * 1000;

  if (!NLQ_CACHE_NAME) {
    throw new Error("Cache NLQ criado, mas 'name' não retornou.");
  }
  return NLQ_CACHE_NAME;
}

// ===== geração principal =====
export async function generateQueries({
  text,
  companyId,
  scope = "company",
  context = null,
}) {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }

  const model = config?.gemini?.model || DEFAULT_MODEL;
  const endpoint = `${BASE_URL}/models/${model}:generateContent`;

  // 1) garante cache com system + regras + schema + few-shots
  let cachedContent = null;
  try {
    cachedContent = await ensureNlqCache();
  } catch (err) {
    // fallback: sem cache, usamos o prompt monolítico
    cachedContent = null;
  }

  // 2) prompt do usuário (somente o "rodapé"/footer quando houver cache)
  const userText = cachedContent
    ? buildUserFooter({ text, companyId, scope, context })
    : buildPrompt({ text, companyId, scope, context });

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
        temperature: 0.1,
        maxOutputTokens: 1504,
        responseMimeType: "application/json",
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
      `Gemini respondeu com status ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();
  const textOut = pickTextFromResponse(data);

  const jsonStr = tryExtractJson(textOut);
  if (!jsonStr) {
    throw new Error("Gemini não retornou JSON válido com {cypher, sql}.");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Falha ao parsear JSON retornado pelo Gemini.");
  }

  let cypher = stripCodeFences(parsed?.cypher || "");
  let sql = stripCodeFences(parsed?.sql || "");

  if (!sql) throw new Error("SQL ausente na resposta do Gemini.");
  if (/^```/.test(cypher)) cypher = stripCodeFences(cypher);
  if (/^```/.test(sql)) sql = stripCodeFences(sql);

  return { cypher, sql };
}
