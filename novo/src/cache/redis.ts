import Redis from "ioredis";
import { env } from "../env";
export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL) : null;
export async function redisGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}
export async function redisSet<T>(key: string, value: T, ttlSec = 3600) {
  if (!redis) return;
  await redis.set(key, JSON.stringify(value), "EX", ttlSec);
}
