import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM envelope for credentials at rest. The key never leaves the server process. */
export interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) throw new Error("GI_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return key;
}

export function seal(plaintext: string, key: Buffer, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function unseal(sealed: Sealed, key: Buffer, aad: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
}
