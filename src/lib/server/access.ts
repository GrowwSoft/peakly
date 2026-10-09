import "server-only";
import { headers } from "next/headers";

/** Constant-time string compare (no early exit on the first differing character). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function basicAuthOk(authorization: string | null, expected: string): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(authorization.slice(6)); } catch { return false; }
  return safeEqual(decoded, expected);
}

/**
 * Server Functions are reachable by direct POST, so each one re-checks access here
 * instead of trusting proxy.ts. A production install must set GI_BASIC_AUTH before
 * it can read private reports or manage a connection. Development remains usable
 * from a loopback host, alongside the loopback-only dev-server default.
 */
export async function assertCanAccessPrivateData(): Promise<void> {
  const h = await headers();
  const expected = process.env.GI_BASIC_AUTH;
  if (process.env.NODE_ENV === "production" && (!expected || !process.env.GI_ENCRYPTION_KEY)) {
    throw new Error("Set GI_BASIC_AUTH and GI_ENCRYPTION_KEY before accessing a production Peakly instance.");
  }
  if (expected) {
    if (!basicAuthOk(h.get("authorization"), expected)) throw new Error("Not authorized.");
    return;
  }
  let host = "";
  try { host = new URL(`http://${h.get("host") ?? ""}`).hostname.toLowerCase(); } catch { /* invalid Host header */ }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!local) throw new Error("Set GI_BASIC_AUTH before accessing Peakly from a non-local host.");
}

export const assertCanManageConnections = assertCanAccessPrivateData;
