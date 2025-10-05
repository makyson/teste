// src/nlq/gemini.js
import config from "../config.js";
import {
  buildSystemInstruction,
  buildUserFooter,
  buildPrompt,
} from "./prompts.js";
import { GoogleAI } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.0-flash-001";

const ai = new GoogleAI({ apiKey: config.gemini.apiKey });

// ===== helpers =====
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

// ===== Caching API (SDK oficial) =====
let NLQ_CACHE_NAME = null;
let NLQ_CACHE_EXPIRES_AT = 0;

async function ensureNlqCache() {
  if (!config?.gemini?.apiKey) {
    throw new Error("GEMINI_API_KEY ausente no ambiente.");
  }
  const now = Date.now();
  if (NLQ_CACHE_NAME && now < NLQ_CACHE_EXPIRES_AT) return NLQ_CACHE_NAME;

  const modelName = config?.gemini?.model || DEFAULT_MODEL;

  // 👇 AQUI está o trecho que você pediu
  const cache = await ai.caches.create({
    model: `models/${modelName}`,
    displayName: "energia:nlq:v1",
    config: {
      systemInstruction: buildSystemInstruction(),
      // opcional: você pode pré-injetar exemplos também em contents; aqui deixo vazio.
      contents: [],
    },
    ttl: "43200s", // 12h
  });

  NLQ_CACHE_NAME = cache?.name || null;

  // tenta ler validade; se não vier, usa 12h – 60s
  const expireMsGuess = 43200 - 60;
  NLQ_CACHE_EXPIRES_AT = cache?.expireTime
    ? Date.parse(cache.expireTime)
    : Date.now() + expireMsGuess * 1000;

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
  const modelName = config?.gemini?.model || DEFAULT_MODEL;

  // 1) garante cache com system + regras + schema + few-shots
  let cachedName = null;
  try {
    cachedName = await ensureNlqCache();
  } catch {
    cachedName = null; // se falhar cache, seguimos sem
  }

  // 2) prompt do usuário (apenas o “rodapé” quando houver cache)
  const userText = cachedName
    ? buildUserFooter({ text, companyId, scope, context })
    : buildPrompt({ text, companyId, scope, context });

  const model = ai.getGenerativeModel({ model: modelName });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: userText }] }],
    ...(cachedName ? { cachedContent: cachedName } : {}),
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1504,
      responseMimeType: "application/json",
    },
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  });

  const textOut = result?.response?.text?.() ?? "";
  const jsonStr = tryExtractJson(textOut);
  if (!jsonStr)
    throw new Error("Gemini não retornou JSON válido com {cypher, sql}.");

  const parsed = JSON.parse(jsonStr);
  let cypher = stripCodeFences(parsed?.cypher || "");
  let sql = stripCodeFences(parsed?.sql || "");
  if (!sql) throw new Error("SQL ausente na resposta do Gemini.");
  if (/^```/.test(cypher)) cypher = stripCodeFences(cypher);
  if (/^```/.test(sql)) sql = stripCodeFences(sql);

  return { cypher, sql };
}
