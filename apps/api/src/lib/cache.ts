import { LRUCache } from 'lru-cache';

/** In-process cache for movie listing and detail (60 s). Seat maps are never cached. */
const cache = new LRUCache<string, object>({ max: 500, ttl: 60_000 });

export async function cached<T extends object>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as T | undefined;
  if (hit) return hit;
  const value = await load();
  cache.set(key, value);
  return value;
}

export function clearCache() {
  cache.clear();
}
