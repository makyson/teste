import { GoogleGenAI } from "@google/genai";
import { env } from "../env";
import { ensurePolicyCacheFromString } from "./gemini-cache";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export async function generateWithPolicy({
  model = env.GEMINI_MODEL,
  policyId,
  policyBody, // conhecimento (cache)
  userMessage, // mensagem do usuário -> contents
}: {
  model?: string;
  policyId: string;
  policyBody: string;
  userMessage: string;
}) {
  const { cacheName } = await ensurePolicyCacheFromString({
    policyId,
    model,
    body: policyBody,
    ttlSeconds: 2 * 3600,
  });

  const resp = await ai.models.generateContent({
    model,
    contents: userMessage,
    config: { cachedContent: cacheName, temperature: 0.2 },
  });

  return resp.text;
}
