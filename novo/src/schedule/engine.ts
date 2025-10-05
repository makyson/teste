import { DateTime } from "luxon";
import {
  AnySchedule,
  WeeklySchedule,
  EverySchedule,
  OnceSchedule,
  isExcluded,
} from "./types";

export function nextRuns(s: AnySchedule, count = 5, from?: Date): string[] {
  if (!s.enabled) return [];

  const zone = s.tz || "America/Fortaleza";
  const now = DateTime.fromJSDate(from ?? new Date()).setZone(zone);
  const out: string[] = [];

  // helper para empurrar ISO só se não for null
  const pushISO = (dt: DateTime) => {
    const iso = dt.toISO(); // string | null
    if (iso) out.push(iso);
  };

  if (s.kind === "once") {
    const dt = DateTime.fromISO((s as OnceSchedule).datetime).setZone(zone);
    if (dt > now && !isExcluded(dt, s)) pushISO(dt);
    return out.slice(0, count);
  }

  if (s.kind === "every") {
    const ev = s as EverySchedule;
    let cur = DateTime.fromISO(ev.startAt).setZone(zone);

    // avança até >= now
    while (cur < now) {
      cur = advanceEvery(cur, ev.every.unit, ev.every.value);
    }

    while (out.length < count) {
      if (!isExcluded(cur, s)) pushISO(cur);
      cur = advanceEvery(cur, ev.every.unit, ev.every.value);
    }
    return out;
  }

  // weekly
  const w = s as WeeklySchedule;
  let cursor = now.startOf("day");

  // respeita startDate se houver
  if (w.startDate) {
    const sd = DateTime.fromISO(w.startDate, { zone }).startOf("day");
    if (cursor < sd) cursor = sd;
  }

  while (out.length < count) {
    // para se passou do endDate (se houver)
    if (w.endDate) {
      const ed = DateTime.fromISO(w.endDate, { zone }).endOf("day");
      if (cursor > ed) break;
    }

    const dname = cursor
      .toFormat("ccc")
      .toLowerCase()
      .slice(0, 3) as WeeklySchedule["days"][number]; // "mon".."sun"

    if (w.days.includes(dname)) {
      const [hh, mm] = w.time.split(":").map(Number);
      const runAt = cursor.set({
        hour: hh,
        minute: mm,
        second: 0,
        millisecond: 0,
      });

      if (runAt > now && !isExcluded(runAt, s)) {
        pushISO(runAt);
      }
    }

    cursor = cursor.plus({ days: 1 }); // próximo dia
  }

  return out;
}

function advanceEvery(
  cur: DateTime,
  unit: "minutes" | "hours" | "days",
  value: number
) {
  if (unit === "minutes") return cur.plus({ minutes: value });
  if (unit === "hours") return cur.plus({ hours: value });
  return cur.plus({ days: value });
}
