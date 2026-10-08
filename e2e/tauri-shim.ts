/**
 * Runs inside the page (via page.addInitScript) to stand in for the Tauri native
 * side of the Mac app: Keychain commands, request signing, the report cache,
 * tauri-plugin-http and resource paths. It mirrors src-tauri/src/lib.rs so the
 * real desktop frontend runs unchanged in WebKit. Must stay self-contained:
 * Playwright serializes this function into the page.
 */
export interface ShimConfig {
  mockOrigin: string;
  scriptPath: string;
}

export function installTauriShim(config: ShimConfig) {
  type Creds = { issuerId: string; keyId: string; privateKey: string; vendorNumber: string; savedAt: string };
  type Pending = { method: string; url: string; headers: [string, string][]; data?: number[] | null };

  // The Keychain outlives a launch (a page reload); the in-memory copy doesn't.
  const KEYCHAIN = "__peaklyE2EKeychain";
  const keychainRead = (): Creds | null => JSON.parse(sessionStorage.getItem(KEYCHAIN) ?? "null");
  const keychainWrite = (c: Creds | null) => (c ? sessionStorage.setItem(KEYCHAIN, JSON.stringify(c)) : sessionStorage.removeItem(KEYCHAIN));
  // connection.json: the key's non-secret details, readable without the Keychain.
  // An older Peakly never wrote it; EARLIER_USE marks that case (the app's cache folder exists).
  const SUMMARY = "__peaklyE2ESummary";
  const EARLIER_USE = "__peaklyE2EEarlierUse";
  const SIGNED = "__peaklyE2ESigned";
  type Summary = Omit<Creds, "privateKey">;
  const summaryRead = (): { saved: Summary | null } | null => JSON.parse(sessionStorage.getItem(SUMMARY) ?? "null");
  const summaryWrite = (c: Creds | null) =>
    sessionStorage.setItem(SUMMARY, JSON.stringify({ saved: c ? { issuerId: c.issuerId, keyId: c.keyId, vendorNumber: c.vendorNumber, savedAt: c.savedAt } : null }));
  // Like the Vault in lib.rs: the Keychain is read only on unlock, at most once per launch.
  let cached: Creds | null | undefined;
  let keychainReads = 0;
  const LOCKED = "Peakly is locked. Click Unlock to let it read your App Store Connect key from the Keychain.";
  const unlocked = (): Creds => {
    if (cached === undefined) throw LOCKED;
    if (!cached) throw "No App Store Connect key saved.";
    return cached;
  };
  const status = () => {
    const shown = (s: Summary | null | undefined, locked: boolean) => s
      ? { configured: true, locked, issuerId: s.issuerId, keyId: s.keyId, vendorNumber: s.vendorNumber, savedAt: s.savedAt }
      : { configured: false, locked: false, issuerId: null, keyId: null, vendorNumber: null, savedAt: null };
    if (cached !== undefined) return shown(cached, false);
    // SIGNED stands in for a team-signed build, which may unlock by itself at launch.
    const autoUnlock = Boolean(sessionStorage.getItem(SIGNED));
    const summary = summaryRead();
    if (summary) return { ...shown(summary.saved, true), autoUnlock: Boolean(summary.saved) && autoUnlock };
    if (sessionStorage.getItem(EARLIER_USE)) return { configured: true, locked: true, autoUnlock, issuerId: null, keyId: null, vendorNumber: null, savedAt: null };
    return shown(null, false);
  };
  const store = (c: Creds | null) => {
    keychainWrite(c);
    summaryWrite(c);
    cached = c;
  };
  // The app's cache folder outlives a launch (a page reload), so it's kept in sessionStorage.
  const CACHE = "__peaklyE2ECache:";
  const cache = {
    get: (key: string) => sessionStorage.getItem(CACHE + key) ?? undefined,
    set: (key: string, value: string) => sessionStorage.setItem(CACHE + key, value),
  };
  const requests = new Map<number, Pending>();
  const bodies = new Map<number, { bytes: Uint8Array; sent: boolean }>();
  let nextRid = 1;
  const calls: { cmd: string; method?: string; url?: string }[] = [];

  const b64url = (bytes: Uint8Array) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  async function sign(issuerId: string, keyId: string, pem: string): Promise<string> {
    let key: CryptoKey;
    try {
      const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
      const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
      key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    } catch {
      throw "The private key couldn't be read. Use the .p8 file from App Store Connect.";
    }
    const enc = new TextEncoder();
    const iat = Math.floor(Date.now() / 1000);
    const head = `${b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })))}.${b64url(enc.encode(JSON.stringify({ iss: issuerId, iat, exp: iat + 600, aud: "appstoreconnect-v1" })))}`;
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head)));
    return `${head}.${b64url(sig)}`;
  }

  const validCacheKey = (key: string) =>
    key.length > 0 && key.split("/").every((p) => p !== "" && p !== "." && p !== ".." && /^[A-Za-z0-9._-]+$/.test(p));

  const rewrite = (url: string) => {
    const u = new URL(url);
    return `${config.mockOrigin}/__host/${u.host}${u.pathname}${u.search}`;
  };

  async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    calls.push({ cmd });
    switch (cmd) {
      case "credentials_status":
        return status();
      case "credentials_unlock":
        if (cached === undefined) {
          keychainReads++;
          cached = keychainRead();
        }
        summaryWrite(cached);
        return status();
      case "credentials_save": {
        const c = args as unknown as Creds;
        await sign(c.issuerId, c.keyId, c.privateKey);
        store({ issuerId: c.issuerId, keyId: c.keyId, privateKey: c.privateKey, vendorNumber: c.vendorNumber, savedAt: c.savedAt });
        return null;
      }
      case "credentials_set_vendor":
        store({ ...unlocked(), vendorNumber: String(args.vendorNumber) });
        return null;
      case "credentials_delete":
        store(null);
        return null;
      case "asc_token": {
        const c = unlocked();
        return sign(c.issuerId, c.keyId, c.privateKey);
      }
      case "asc_token_for":
        return sign(String(args.issuerId), String(args.keyId), String(args.privateKey));
      case "cache_get":
        if (!validCacheKey(String(args.key))) throw `Invalid cache key: ${args.key}`;
        return cache.get(String(args.key)) ?? null;
      case "cache_set":
        if (!validCacheKey(String(args.key))) throw `Invalid cache key: ${args.key}`;
        cache.set(String(args.key), String(args.value));
        return null;
      case "plugin:opener|open_url":
        calls[calls.length - 1] = { cmd, url: String(args.url) };
        return null;
      case "plugin:path|resolve_directory":
        return config.scriptPath;
      case "plugin:http|fetch": {
        const cfg = (args as { clientConfig: Pending }).clientConfig;
        calls[calls.length - 1] = { cmd, method: cfg.method, url: cfg.url };
        const url = new URL(cfg.url);
        if (cfg.method !== "GET" && !(cfg.method === "POST" && url.host === "api.appstoreconnect.apple.com" && url.pathname === "/v1/analyticsReportRequests")) {
          throw "Only the Analytics Reports setup request is supported.";
        }
        const rid = nextRid++;
        requests.set(rid, cfg);
        return rid;
      }
      case "plugin:http|fetch_send": {
        const rid = Number(args.rid);
        const cfg = requests.get(rid)!;
        const res = await fetch(rewrite(cfg.url), { method: cfg.method, headers: cfg.headers, body: cfg.data ? new Uint8Array(cfg.data) : undefined });
        const responseRid = nextRid++;
        bodies.set(responseRid, { bytes: new Uint8Array(await res.arrayBuffer()), sent: false });
        return { status: res.status, statusText: res.statusText, url: cfg.url, headers: [...res.headers.entries()], rid: responseRid };
      }
      case "plugin:http|fetch_read_body": {
        const body = bodies.get(Number(args.rid))!;
        if (body.sent) return new Uint8Array([1]).buffer;
        body.sent = true;
        const chunk = new Uint8Array(body.bytes.length + 1);
        chunk.set(body.bytes);
        chunk[body.bytes.length] = 0;
        return chunk.buffer;
      }
      case "plugin:http|fetch_cancel":
      case "plugin:http|fetch_cancel_body":
        return null;
      default:
        throw `Unhandled Tauri command in e2e shim: ${cmd}`;
    }
  }

  const w = window as unknown as Record<string, unknown>;
  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  };
  w.__peaklyE2E = { calls, keychain: keychainRead, keychainReads: () => keychainReads, cacheGet: cache.get, cacheSet: cache.set };
}
