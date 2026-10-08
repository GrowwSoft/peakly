import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AscCredentials } from "@/core/asc/jwt";
import { createAscToken } from "@/core/asc/jwt";
import { assertCacheKey, cachedToken, type AscAuth, type Platform } from "@/core/platform";
import { dataDir, writeAtomic } from "./data-dir";

/**
 * End-to-end tests only: send Apple traffic to a local mock server. Ignored in
 * production builds, so a deployment can never be pointed away from Apple.
 */
const e2eOrigin = process.env.NODE_ENV !== "production" ? process.env.GI_E2E_APPLE_ORIGIN : undefined;

function rewriteForE2E(input: RequestInfo | URL): RequestInfo | URL {
  if (!e2eOrigin) return input;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  return `${e2eOrigin}/__host/${url.host}${url.pathname}${url.search}`;
}

/** Node implementation of the core platform: global fetch plus a file cache in the data directory. */
export const nodePlatform: Platform = {
  fetch: (input, init) => fetch(rewriteForE2E(input), init),
  cache: {
    async get(key) {
      const file = join(dataDir(), "cache", assertCacheKey(key));
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    },
    async set(key, value) {
      writeAtomic(join(dataDir(), "cache", assertCacheKey(key)), value);
    },
  },
};

/** Sign requests with saved credentials. Server-only: the private key never reaches the browser. */
export function authFromCredentials(credentials: AscCredentials): AscAuth {
  return { token: cachedToken(() => createAscToken(credentials)), vendorNumber: credentials.vendorNumber };
}
