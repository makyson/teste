import { DateTime } from "luxon";

export type Tz = string; // ex: "America/Fortaleza"

export type ScheduleBase = {
  id: string; // uuid
  name: string; // ex: "Relatório de pico"
  tz: Tz; // timezone, default "America/Fortaleza"
  enabled: boolean; // on/off
  excludeDates?: string[]; // ISO "2025-10-05" -> não roda nesses dias
};

export type OnceSchedule = ScheduleBase & {
  kind: "once";
  datetime: string; // ISO completo: "2025-10-10T18:00:00-03:00"
};

export type EverySchedule = ScheduleBase & {
  kind: "every";
  startAt: string; // primeira execução (ISO). Ex.: "2025-10-05T18:00:00-03:00"
  every: {
    // intervalo
    unit: "minutes" | "hours" | "days";
    value: number; // a cada X unidades
  };
};

export type WeeklySchedule = ScheduleBase & {
  kind: "weekly";
  time: string; // "18:00" (hh:mm no fuso tz)
  days: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  startDate?: string | null; // opcional
  endDate?: string | null; // opcional
};

export type AnySchedule = OnceSchedule | EverySchedule | WeeklySchedule;

export function isExcluded(d: DateTime, s: ScheduleBase) {
  if (!s.excludeDates?.length) return false;
  const iso = d.toISODate(); // string | null
  if (!iso) return false;
  return s.excludeDates.includes(iso);
}
