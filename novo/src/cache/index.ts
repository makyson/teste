import { lruGet, lruSet } from "./lru";
import { redisGet, redisSet } from "./redis";

export async function cacheGet<T>(key: string): Promise<T | null> {
  const m = await lruGet<T>(key);
  if (m) return m;
  const r = await redisGet<T>(key);
  if (r) {
    await lruSet(key, r);
    return r;
  }
  return null;
}
export async function cacheSet<T>(
  key: string,
  value: T,
  opts?: { ttlSec?: number; lruTtlMs?: number }
) {
  await Promise.all([
    lruSet(key, value, opts?.lruTtlMs),
    redisSet(key, value, opts?.ttlSec ?? 3600),
  ]);
}
