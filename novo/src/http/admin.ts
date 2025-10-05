import express from "express";
import { upsertPolicy, listPolicyCaches } from "../vector/repo";
import { env } from "../env";
import { ensurePolicyCacheFromString } from "../llm/gemini-cache";

export const adminRouter = express.Router();

adminRouter.post("/policies/:id", async (req, res) => {
  const { id } = req.params;
  const { title, body, model = env.GEMINI_MODEL } = req.body ?? {};
  if (!title || !body) {
    return res.status(400).json({ error: "title e body são obrigatórios" });
  }
  // gravamos rules_system vazio (compatível com schema atual)
  await upsertPolicy({ id, title, body, model, rulesSystem: "" });

  const { cacheName, versionId } = await ensurePolicyCacheFromString({
    policyId: id,
    model,
    body,
    ttlSeconds: 2 * 3600,
  });
  res.json({ ok: true, id, cacheName, versionId });
});

adminRouter.get("/policies/:id/caches", async (req, res) => {
  const { id } = req.params;
  const rows = await listPolicyCaches(id);
  res.json(rows);
});
