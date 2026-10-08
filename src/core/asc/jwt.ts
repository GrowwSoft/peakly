/** Shape of a saved App Store Connect connection. */
export interface AscCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string;
  vendorNumber: string;
}

/** Normalize a .p8 key pasted with literal "\n" escapes or Windows line breaks. */
export function normalizePrivateKey(value: string): string {
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  return key.replace(/\\+r\\+n/g, "\n").replace(/\\+n/g, "\n").replace(/\r\n?/g, "\n");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = normalizePrivateKey(pem).replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

/**
 * Short-lived App Store Connect ES256 token, signed with WebCrypto (available in
 * Node and in the Mac app's web view). WebCrypto's ECDSA output is already the
 * raw r||s form JWTs need.
 */
export async function createAscToken(
  credentials: Pick<AscCredentials, "issuerId" | "keyId" | "privateKey">,
  now = new Date(),
  ttlSeconds = 600,
): Promise<string> {
  if (ttlSeconds <= 0 || ttlSeconds > 1200) throw new Error("App Store Connect token TTL must be 1–1200 seconds.");
  const iat = Math.floor(now.getTime() / 1000);
  const enc = new TextEncoder();
  const header = base64Url(enc.encode(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" })));
  const payload = base64Url(enc.encode(JSON.stringify({ aud: "appstoreconnect-v1", iat, exp: iat + ttlSeconds, iss: credentials.issuerId })));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(credentials.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}
