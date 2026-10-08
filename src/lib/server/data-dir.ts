import "server-only";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { parseKey } from "./crypto";

/** Where encrypted connections and the report cache live. Override with GI_DATA_DIR. */
export function dataDir(): string {
  // Runtime location chosen by the operator; not a build-time asset, so don't trace it.
  const dir = resolve(/*turbopackIgnore: true*/ process.env.GI_DATA_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), ".data"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * GI_ENCRYPTION_KEY is required in production. For local self-hosting only, a
 * key is generated once into the data directory (0600) so first run just works.
 */
export function encryptionKey(): Buffer {
  const fromEnv = process.env.GI_ENCRYPTION_KEY;
  if (fromEnv) return parseKey(fromEnv);
  if (process.env.NODE_ENV === "production") {
    throw new Error("GI_ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32");
  }
  const file = join(dataDir(), "dev-encryption.key");
  if (!existsSync(file)) writeAtomic(file, randomBytes(32).toString("base64"));
  return parseKey(readFileSync(file, "utf8"));
}

export function writeAtomic(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, contents, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
