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
 * instead of trusting proxy.ts. With GI_BASIC_AUTH set, credentials are required.
 * Without it, changes are only accepted from a local development host.
 */
export async function assertCanManageConnections(): Promise<void> {
  const h = await headers();
  const expected = process.env.GI_BASIC_AUTH;
  if (expected) {
    if (!basicAuthOk(h.get("authorization"), expected)) throw new Error("Not authorized.");
    return;
  }
  const host = (h.get("host") ?? "").split(":")[0]!.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  if (!local) throw new Error("Set GI_BASIC_AUTH before managing connections on a non-local host.");
}
