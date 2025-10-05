type Reading = { ts: string; kwh: number };
export type Kpis = {
  total: number;
  avg: number;
  peak: number;
  loadFactor: number;
};

export function computeKpis(data: Reading[]): Kpis {
  const vals = data.map((d) => d.kwh);
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = total / Math.max(vals.length, 1);
  const peak = Math.max(...vals, 0);
  const loadFactor = peak > 0 ? avg / peak : 0;
  return { total, avg, peak, loadFactor };
}

export function detectAnomalies(data: Reading[], z = 3) {
  const vals = data.map((d) => d.kwh);
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
  const std =
    Math.sqrt(
      vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(vals.length, 1)
    ) || 1e-9;
  const anomalies = data.filter((d) => Math.abs((d.kwh - mean) / std) >= z);
  return { mean, std, anomalies };
}
