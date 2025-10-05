import express from "express";
import { randomUUID } from "crypto";
import {
  AnySchedule,
  OnceSchedule,
  EverySchedule,
  WeeklySchedule,
} from "../schedule/types";
import { nextRuns } from "../schedule/engine";

export const scheduleRouter = express.Router();

// storage em memória por enquanto
const store = new Map<string, AnySchedule>();

// Criar
scheduleRouter.post("/", (req, res) => {
  const body = req.body as Partial<AnySchedule>;
  const id = body.id || randomUUID();
  if (!body?.kind)
    return res
      .status(400)
      .json({ error: "kind obrigatório (once|every|weekly)" });

  let sched: AnySchedule;
  const base = {
    id,
    name: body.name || "Sem nome",
    tz: body.tz || "America/Fortaleza",
    enabled: body.enabled ?? true,
    excludeDates: body.excludeDates || [],
  };

  if (body.kind === "once") {
    if (!("datetime" in body) || !body.datetime)
      return res.status(400).json({ error: "datetime obrigatório" });
    sched = { ...base, kind: "once", datetime: body.datetime } as OnceSchedule;
  } else if (body.kind === "every") {
    const every = (body as EverySchedule).every;
    const startAt = (body as EverySchedule).startAt;
    if (!every?.unit || !every?.value || !startAt) {
      return res
        .status(400)
        .json({ error: "every.unit/value e startAt obrigatórios" });
    }
    sched = { ...base, kind: "every", every, startAt } as EverySchedule;
  } else {
    // weekly
    const w = body as WeeklySchedule;
    if (!w.time || !w.days || !w.days.length) {
      return res
        .status(400)
        .json({ error: "weekly exige time ('HH:mm') e days ['mon'...'sun']" });
    }
    sched = {
      ...base,
      kind: "weekly",
      time: w.time,
      days: w.days,
      startDate: w.startDate,
      endDate: w.endDate,
    } as WeeklySchedule;
  }

  store.set(id, sched);
  res.json({ ok: true, schedule: sched, next: nextRuns(sched, 5) });
});

// Listar
scheduleRouter.get("/", (_req, res) => {
  const items = Array.from(store.values()).map((s) => ({
    ...s,
    next: nextRuns(s, 3),
  }));
  res.json(items);
});

// Ler
scheduleRouter.get("/:id", (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ ...s, next: nextRuns(s, 5) });
});

// Atualizar (enable/disable ou campos simples)
scheduleRouter.patch("/:id", (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  const merged = { ...s, ...req.body, id: s.id }; // não troca id
  store.set(s.id, merged);
  res.json({ ok: true, schedule: merged, next: nextRuns(merged, 5) });
});

// Deletar
scheduleRouter.delete("/:id", (req, res) => {
  store.delete(req.params.id);
  res.json({ ok: true });
});
