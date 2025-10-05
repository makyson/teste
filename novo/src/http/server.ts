import express from "express";
import { env } from "../env";
import { recommendFromEnergy } from "../energy/recommender";
import { computeKpis, detectAnomalies } from "../energy/analyzer";
import { adminRouter } from "./admin";
import { scheduleRouter } from "./schedule";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/admin", adminRouter);

app.use("/schedule", scheduleRouter);

app.post("/ask", async (req, res) => {
  try {
    const { policyId, policyBody, siteName, readings } = req.body ?? {};
    if (!policyId || !policyBody || !Array.isArray(readings)) {
      return res.status(400).json({
        error: "policyId, policyBody e readings são obrigatórios",
      });
    }

    const kpis = computeKpis(readings);
    const anomalies = detectAnomalies(readings, 3);

    const text = await recommendFromEnergy({
      policyId,
      policyBody,
      siteName: siteName ?? "Site",
      kpis,
      anomalies,
      model: env.GEMINI_MODEL,
    });

    res.json({ text, kpis, anomalies: anomalies.anomalies.length });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message ?? "erro interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP on http://localhost:${PORT}`));
