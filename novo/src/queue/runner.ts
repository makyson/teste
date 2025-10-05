import Redlock from "redlock";
import { redis } from "../cache/redis";
import { popDue, indexSchedule } from "../schedule/queue";
import { loadSchedule, setNextAt } from "../schedule/repo";
import { nextRuns } from "../schedule/engine";
import { notifyQueue } from "./bus";

const redlock = redis ? new Redlock([redis as any], { retryCount: 0 }) : null;
const LOCK_KEY = "lock:schedule-runner";
const LOCK_TTL_MS = 3000;

export async function startSchedulerRunner() {
  if (!redis || !redlock) {
    console.warn("Scheduler runner desativado: Redis não configurado.");
    return;
  }
  setInterval(tick, 1000);
}

async function tick() {
  let lock: any;
  try {
    lock = await redlock!.acquire([LOCK_KEY], LOCK_TTL_MS);
  } catch {
    return; // outra instância é a líder
  }

  try {
    const now = Date.now();
    const due = await popDue(now, 500);
    for (const id of due) {
      const row = await loadSchedule(id);
      if (!row) continue;

      // Dispara job
      await notifyQueue.add(
        "fire",
        { scheduleId: id },
        { removeOnComplete: 1000, removeOnFail: 1000 }
      );

      // Calcula próxima execução
      const s = rowToSchedule(row);
      const nextIso = nextRuns(s, 1)[0]; // nossa engine retorna string ISO
      const nextAt = nextIso ? new Date(nextIso) : null;

      await setNextAt(id, nextAt);
      await indexSchedule(id, nextAt);
    }
  } finally {
    try {
      await lock.release();
    } catch {}
  }
}

function rowToSchedule(row: any) {
  const base = {
    id: row.id as string,
    name: row.name as string,
    tz: row.tz as string,
    enabled: row.enabled as boolean,
    excludeDates: (row.exclude_dates as string[] | null) ?? [],
  };
  const payload = row.payload as any;
  return { ...base, ...payload } as any; // AnySchedule
}
