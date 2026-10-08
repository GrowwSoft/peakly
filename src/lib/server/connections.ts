import "server-only";
import { join } from "node:path";
import { seal, unseal, type Sealed } from "./crypto";
import { dataDir, encryptionKey, readJson, writeAtomic } from "./data-dir";
import type { AscCredentials } from "@/core/asc/jwt";
import { ascCredentialsSchema } from "@/core/credentials";

export { ascCredentialsSchema };

/**
 * Read-only data-source credentials. Secrets are write-only from the UI: they are
 * encrypted at rest and only a masked summary is ever sent back to the browser.
 */
interface StoredConnection {
  sealed: Sealed;
  savedAt: string;
  hint: { keyId: string; vendorTail: string };
}

interface ConnectionsFile {
  version: 1;
  appStoreConnect?: StoredConnection;
}

const file = () => join(dataDir(), "connections.json");
const AAD = "growth-insights:appStoreConnect:v1";

export interface ConnectionStatus {
  appStoreConnect: { configured: false } | { configured: true; keyId: string; vendorTail: string; savedAt: string };
}

export function connectionStatus(): ConnectionStatus {
  const stored = readJson<ConnectionsFile>(file())?.appStoreConnect;
  return stored
    ? { appStoreConnect: { configured: true, keyId: stored.hint.keyId, vendorTail: stored.hint.vendorTail, savedAt: stored.savedAt } }
    : { appStoreConnect: { configured: false } };
}

export function saveAscCredentials(credentials: AscCredentials): void {
  const current = readJson<ConnectionsFile>(file()) ?? { version: 1 };
  current.appStoreConnect = {
    sealed: seal(JSON.stringify(credentials), encryptionKey(), AAD),
    savedAt: new Date().toISOString(),
    hint: { keyId: credentials.keyId, vendorTail: credentials.vendorNumber ? credentials.vendorNumber.slice(-3) : "" },
  };
  writeAtomic(file(), JSON.stringify(current, null, 2));
}

/** Update only the vendor number on the saved connection; the key itself is untouched. */
export function setVendorNumber(vendorNumber: string): void {
  const current = loadAscCredentials();
  if (!current) throw new Error("No App Store Connect key saved.");
  saveAscCredentials({ ...current, vendorNumber });
}

/** Server-only. Never return this value from a Server Function or route. */
export function loadAscCredentials(): AscCredentials | null {
  const stored = readJson<ConnectionsFile>(file())?.appStoreConnect;
  if (!stored) return null;
  return ascCredentialsSchema.parse(JSON.parse(unseal(stored.sealed, encryptionKey(), AAD)));
}

export function removeAscCredentials(): void {
  const current = readJson<ConnectionsFile>(file());
  if (!current?.appStoreConnect) return;
  delete current.appStoreConnect;
  writeAtomic(file(), JSON.stringify(current, null, 2));
}
