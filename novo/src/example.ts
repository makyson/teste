import { computeKpis, detectAnomalies } from "./energy/analyzer";
import { recommendFromEnergy } from "./energy/recommender";

const policyBody = `# Diretrizes de Energia\n- Metas e limites...`;

async function run() {
  const series = Array.from({ length: 168 }, (_, i) => {
    const ts = new Date(Date.now() - (168 - i) * 3600 * 1000).toISOString();
    const base = 120 + Math.sin(i / 12) * 10;
    const spike = i % 48 === 0 ? 90 : 0;
    return { ts, kwh: Math.max(10, base + spike) };
  });

  const kpis = computeKpis(series);
  const anoms = detectAnomalies(series);

  const text = await recommendFromEnergy({
    policyId: "empresaA/planta1",
    policyBody,
    siteName: "Planta 1",
    kpis,
    anomalies: anoms,
  });

  console.log(text);
}

run().catch(console.error);
