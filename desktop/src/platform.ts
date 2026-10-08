import { invoke, isTauri } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AscCredentials } from "@/core/asc/jwt";
import { cachedToken, type AscAuth, type Platform } from "@/core/platform";

/** False when the desktop frontend is opened in a normal browser (preview); then only sample data is shown. */
export const inDesktopApp = isTauri();

/**
 * Mac implementation of the core platform. Network calls go through Tauri's HTTP
 * plugin (Apple's API doesn't allow browser-origin requests), restricted to Apple
 * hosts by the app's capability file. Reports are cached in the app's cache folder.
 */
export const desktopPlatform: Platform = {
  fetch: ((input: RequestInfo | URL, init?: RequestInit) => tauriFetch(input as URL | Request | string, init)) as typeof fetch,
  cache: {
    get: (key) => invoke<string | null>("cache_get", { key }),
    set: (key, value) => invoke<void>("cache_set", { key, value }),
  },
};

/**
 * `locked`: a key is saved but Peakly hasn't read it from the Keychain in this launch.
 * `autoUnlock`: this build is signed by a developer team, so macOS lets it read its own
 * Keychain item without a prompt and Peakly unlocks by itself at launch. Unsigned
 * builds never read the Keychain until the person clicks Unlock.
 * Key details can be empty while locked if the key was saved by an older Peakly.
 */
export type DesktopStatus =
  | { configured: false }
  | { configured: true; locked: boolean; autoUnlock: boolean; issuerId: string; keyId: string; vendorNumber: string; savedAt: string };

interface RawStatus { configured: boolean; locked?: boolean; autoUnlock?: boolean; issuerId?: string | null; keyId?: string | null; vendorNumber?: string | null; savedAt?: string | null }

const toStatus = (s: RawStatus): DesktopStatus =>
  s.configured && (s.locked || (s.issuerId && s.keyId))
    ? { configured: true, locked: Boolean(s.locked), autoUnlock: Boolean(s.autoUnlock), issuerId: s.issuerId ?? "", keyId: s.keyId ?? "", vendorNumber: s.vendorNumber ?? "", savedAt: s.savedAt ?? "" }
    : { configured: false };

/** Never touches the Keychain. */
export async function connectionStatus(): Promise<DesktopStatus> {
  if (!inDesktopApp) return { configured: false };
  return toStatus(await invoke<RawStatus>("credentials_status"));
}

/** Reads the key from the Keychain (macOS may ask for the password) and keeps it for this launch. */
export async function unlockCredentials(): Promise<DesktopStatus> {
  return toStatus(await invoke<RawStatus>("credentials_unlock"));
}

/** Requests are signed by the Rust side with the key from the macOS Keychain; the key never returns to this page. */
export function keychainAuth(vendorNumber: string): AscAuth {
  return { token: cachedToken(() => invoke<string>("asc_token")), vendorNumber };
}

/** Sign with a key that hasn't been saved yet, so it can be verified with Apple first. */
export function candidateAuth(credentials: AscCredentials): AscAuth {
  const token = invoke<string>("asc_token_for", { issuerId: credentials.issuerId, keyId: credentials.keyId, privateKey: credentials.privateKey });
  return { token: () => token, vendorNumber: credentials.vendorNumber };
}

export const saveCredentials = (c: AscCredentials) =>
  invoke<void>("credentials_save", { issuerId: c.issuerId, keyId: c.keyId, privateKey: c.privateKey, vendorNumber: c.vendorNumber, savedAt: new Date().toISOString() });
export const setVendorNumber = (vendorNumber: string) => invoke<void>("credentials_set_vendor", { vendorNumber });
export const removeCredentials = () => invoke<void>("credentials_delete");

/** Opens a web page in the default browser (allowed sites are listed in the app's capability file). */
export function openInBrowser(url: string): void {
  if (inDesktopApp) void openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Absolute path of the bundled enable-analytics script, for the copyable command. */
export async function bundledScriptPath(): Promise<string> {
  try { return await resolveResource("scripts/enable-analytics-reports.mjs"); } catch { return "scripts/enable-analytics-reports.mjs"; }
}
