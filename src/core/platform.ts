/**
 * What the shared core needs from whatever it runs in. The web server provides
 * Node implementations; the Mac app provides Tauri implementations.
 */

/** Signs requests to App Store Connect. The private key stays wherever the provider keeps it. */
export interface AscAuth {
  /** A short-lived ES256 JWT for api.appstoreconnect.apple.com. */
  token(): Promise<string>;
  /** Optional: only Sales reports need it. Empty means sales aren't configured. */
  vendorNumber: string;
}

/**
 * Durable string storage keyed by a relative path like "sales/123/2026-10-01.json":
 * immutable published reports, finished datasets, and each app's release history.
 */
export interface ReportCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Platform {
  fetch: typeof fetch;
  cache: ReportCache;
}

/** Cache keys are relative paths of safe characters only, so no implementation can be pointed outside its folder. */
export function assertCacheKey(key: string): string {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(key) || key.split("/").some((p) => p === "." || p === "..")) {
    throw new Error(`Invalid cache key: ${key}`);
  }
  return key;
}

/** Reuse a token until shortly before it expires. */
export function cachedToken(make: () => Promise<string>, ttlMs = 9 * 60_000): () => Promise<string> {
  let current: { value: string; until: number } | null = null;
  return async () => {
    if (current && Date.now() < current.until) return current.value;
    const value = await make();
    current = { value, until: Date.now() + ttlMs };
    return value;
  };
}
