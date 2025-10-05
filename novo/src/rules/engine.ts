import { DateTime } from "luxon";

export type Rule = {
  id: string;
  when?: "always" | "between";
  window?: { tz: string; start: string; end: string };
  metric: "P" | "I" | "FP" | "kWh";
  op: ">" | ">=" | "<" | "<=";
  threshold: number;
  hysteresis?: number;
  forSeconds?: number; // tempo mínimo acima/abaixo p/ acionar
  actions: Array<
    { type: "notify"; message: string } | { type: "trip"; relay: string }
  >;
};

export type EngineState = Record<
  string,
  { enteredAt?: number; active?: boolean }
>;

export function matchWindow(when: Rule["when"], win?: Rule["window"]) {
  if (when !== "between" || !win) return true;
  const now = DateTime.now().setZone(win.tz);
  const start = DateTime.fromISO(now.toISODate() + "T" + win.start, {
    zone: win.tz,
  });
  const end = DateTime.fromISO(now.toISODate() + "T" + win.end, {
    zone: win.tz,
  });
  return now >= start && now <= end;
}

export function evalRule(
  rule: Rule,
  value: number,
  st: EngineState,
  nowMs: number
) {
  const key = rule.id;
  const entry = st[key] || (st[key] = {});
  const pass =
    (rule.op === ">" && value > rule.threshold) ||
    (rule.op === ">=" && value >= rule.threshold) ||
    (rule.op === "<" && value < rule.threshold) ||
    (rule.op === "<=" && value <= rule.threshold);

  const inWindow = matchWindow(rule.when, rule.window);
  if (!inWindow) {
    entry.active = false;
    entry.enteredAt = undefined;
    return { fire: false, actions: [] as Rule["actions"] };
  }

  if (pass) {
    if (!entry.enteredAt) entry.enteredAt = nowMs;
    const dwell = (nowMs - entry.enteredAt) / 1000;
    if ((rule.forSeconds ?? 0) <= dwell) {
      entry.active = true;
      return { fire: true, actions: rule.actions };
    }
  } else {
    // histerese para sair
    const h = rule.hysteresis ?? 0;
    const leave =
      (rule.op.startsWith(">") && value <= rule.threshold - h) ||
      (rule.op.startsWith("<") && value >= rule.threshold + h);
    if (leave) {
      entry.active = false;
      entry.enteredAt = undefined;
    }
  }
  return { fire: false, actions: [] as Rule["actions"] };
}
