import { generateWithPolicy } from "../llm/gemini-generate";
import type { Kpis } from "./analyzer";

export async function recommendFromEnergy({
  policyId,
  policyBody,
  model,
  siteName,
  kpis,
  anomalies,
}: {
  policyId: string;
  policyBody: string;
  model?: string;
  siteName: string;
  kpis: Kpis;
  anomalies: {
    mean: number;
    std: number;
    anomalies: { ts: string; kwh: number }[];
  };
}) {
  const userMessage = [
    `Contexto do site: ${siteName}.`,
    `KPIs: total=${kpis.total.toFixed(2)} kWh, média=${kpis.avg.toFixed(
      2
    )} kWh, pico=${kpis.peak.toFixed(
      2
    )} kWh, fator_carga=${kpis.loadFactor.toFixed(3)}.`,
    `Anomalias (z>=3): ${
      anomalies.anomalies
        .slice(0, 20)
        .map((a) => `${a.ts}:${a.kwh}`)
        .join(", ") || "nenhuma"
    }.`,
    `Responda em 3 seções: (1) Diagnóstico, (2) Recomendações priorizadas por payback, (3) Riscos/monitoramento.`,
  ].join("\n");

  return await generateWithPolicy({
    policyId,
    policyBody, // CONTEXTO
    userMessage, // pergunta/payload do usuário
    model,
  });
}
