import { LRUCache } from "lru-cache";

export const lru = new LRUCache<string, any>({
  max: 500,
  ttl: 10 * 60 * 1000,
});

export const lruGet = <T = unknown>(k: string): T | null =>
  (lru.get(k) as T | undefined) ?? null;

export const lruSet = <T = unknown>(k: string, v: T, ttlMs?: number): void => {
  if (ttlMs !== undefined) lru.set(k, v, { ttl: ttlMs });
  else lru.set(k, v);
};
