import { assertCacheKey, type Platform } from "./platform";

/** Shared helpers for reading Apple data through the platform's cache. */

export async function readCache<T>(platform: Platform, key: string): Promise<T | null> {
  try {
    const text = await platform.cache.get(assertCacheKey(key));
    return text === null ? null : (JSON.parse(text) as T);
  } catch {
    return null; // a corrupt or unreadable cache entry is just a miss
  }
}

export const writeCache = (platform: Platform, key: string, value: unknown) => platform.cache.set(assertCacheKey(key), JSON.stringify(value));

/** Make an ID from Apple safe to use in a cache key, whatever characters it contains. */
export const keyPart = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);

/** Run async work with bounded concurrency (Apple rate-limits per key). */
export async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i]!); }
  }));
  return out;
}
