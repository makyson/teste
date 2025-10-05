import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export async function doubleCheck({
  rulesSystem,
  planJson,
}: {
  rulesSystem: string;
  planJson: unknown;
}) {
  const resp = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: "",
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          approve: { type: "boolean" },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["approve", "reasons"],
      },
    },
  });
  try {
    return resp.data as unknown as { approve: boolean; reasons: string[] };
  } catch {
    return { approve: false, reasons: ["invalid_json"] };
  }
}
