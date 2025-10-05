import { redis } from "../cache/redis";

// chave do índice de disparo
const KEY = "sched:due";

export async function indexSchedule(id: string, nextAt: Date | null) {
  if (!redis) return;
  if (!nextAt) {
    await redis.zrem(KEY, id);
    return;
  }
  const score = Math.floor(nextAt.getTime());
  await redis.zadd(KEY, score, id);
}

export async function popDue(now = Date.now(), max = 500) {
  if (!redis) return [];
  // pega IDs com score <= now
  const ids = await redis.zrangebyscore(KEY, 0, now, "LIMIT", 0, max);
  if (ids.length) {
    await redis.zrem(KEY, ...ids);
  }
  return ids;
}
