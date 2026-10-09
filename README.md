<img src="public/brand/logo.svg" width="72" alt="" />

# Peakly

Open-source growth insights for App Store apps. Connect a **read-only** App Store Connect key and get a clear picture of discovery, conversion, sources and sales, plus a recommended next step that's honest about sample size.

> Working title. MVP scope: App Store Connect only (Analytics Reports + Sales reports). Superwall and other sources come later through the same provider pattern.

## What it shows

- **KPIs**: impressions, page conversion, first-time downloads, product page views, each against the previous period.
- **Trend**: impressions and page conversion as two aligned charts (never one chart with two y-axes), daily or weekly, with release markers, hover details and a table view.
- **Insights**: the impressions × conversion quadrant ("Low impressions · High conversion → increase qualified exposure", and so on), source mix (search vs. referrers) and paid sales. Each insight lists the evidence it used.
- **Coverage**: which days Apple has published, and which are still pending.

## Principles

- **Unknown is not zero.** Days Apple hasn't published are gaps, not zeros. Missing reports are named.
- **Small samples get "too early to tell."** Conversion is judged with a 95% Wilson interval. It's "high" or "low" only when the whole interval clears the target (`INSIGHT_POLICY` in `src/lib/insights/diagnose.ts`).
- **Events, not people.** Apple's Counts are events. Direct search downloads skip the product page, so total downloads are never divided by page views.
- **No paid-traffic advice without paid evidence.** Exposure advice holds paid campaigns until purchases are verified in Apple's sales reports.

## Security model

- The saved App Store Connect key is **read-only** and its private key is **write-only from the UI**. After saving, only the key ID and the last digits of the vendor number are ever shown.
- Credentials are encrypted at rest with AES-256-GCM (`GI_ENCRYPTION_KEY`) in `GI_DATA_DIR/connections.json` (0600).
- The App Store Connect token is created in memory per request (10-minute ES256 JWT) and sent only to `api.appstoreconnect.apple.com`. Report downloads use Apple's pre-signed URLs without credentials.
- A key is verified against Apple before it's stored.
- **Feedback** talks to [VoteWant](https://votewant.com)'s public API: it reads Peakly's board and, when you vote or send feedback, registers this install once for an anonymous voter ID (kept in local storage). There's no sign-in, and nothing about your apps, keys or reports is sent. The Mac app allows only `https://votewant.com` beyond Apple, and loads no frames.
- Managing keys requires `GI_BASIC_AUTH` on any non-local host. Every Server Function re-checks access; `proxy.ts` is a convenience gate, not the security boundary.
- The saved connection stays read-only. The Mac app can create a single ongoing Analytics Reports request only after a user previews the specific app and explicitly confirms; any separate Admin key is used in memory for that action and never saved. The web app uses the standalone local script for this one-time setup.

## Setup

```bash
npm install
cp .env.example .env.local   # set GI_ENCRYPTION_KEY (openssl rand -base64 32); in development one is generated into .data/
npm run dev
```

Open http://localhost:3000. You'll see sample data until you connect a key in **Settings**.

### Connecting (2 inputs per Apple account)

1. **Users and Access → Integrations → App Store Connect API → Team Keys**: create a key with the **Sales and Reports** role and download `AuthKey_<KEYID>.p8`.
2. In **Settings**, drop the `.p8` and paste the **Issuer ID**. The Key ID is read from the file name (editable). Apple verifies the key before it's saved.
3. Settings then lists **every app** on the account with its analytics status. One key covers all of them.
4. Optional: add your **Vendor number** to include sales. Without it, sales show as "not configured", never as zero.
5. Apps without Analytics Reports need a one-time request created with an **Admin** key. In the Mac app, Settings offers an app-specific preview and asks before sending the request. The Admin key is used in memory and discarded after setup. For the web app, run the standalone helper locally (the Admin key never reaches the server):

   ```bash
   ASC_ISSUER_ID=<issuer-id> ASC_KEY_PATH=./AuthKey_<ADMINKEY>.p8 node scripts/enable-analytics-reports.mjs <appId> ...
   ```

   It previews each app, creates nothing until you type `yes`, and skips apps that are already enabled. Reports arrive 24–48 hours later.

Each additional Apple account currently needs its own instance; multi-account workspaces are on the roadmap.

## Mac app (Tauri)

The same screens ship as a Mac desktop app, built like AppLustre: a Vite frontend (`desktop/`) plus a small Rust side (`src-tauri/`).

- Peakly talks to Apple directly from the Mac, through Tauri's HTTP plugin (allowed hosts are listed in `src-tauri/capabilities/default.json`).
- The key lives in the **macOS Keychain**. Requests are signed in Rust, so the private key never goes back to the page after it's saved.
- Published reports are saved in the app's cache folder and never downloaded twice.
- **Apple publishes new data about once a day**, so Peakly keeps each finished dashboard and opens it instantly. It asks Apple again only after the next daily publish (Apple says the previous day's sales reports are generally out by 8 am Pacific), every 3 hours while Apple is behind, or when you click **Refresh now**. The dashboard shows when it was updated and when new data is expected.
- **Keychain access:** a build signed by a developer team reads its own Keychain item silently, so it unlocks at launch. Unsigned builds look like a new app to macOS after every rebuild, so they never read the Keychain until you click **Unlock**; that one unlock covers every screen until you quit. The key's non-secret details (Key ID, vendor number, saved date) are kept in `connection.json` in the app's data folder, so the lock screen can show them without the Keychain.
- The Mac app provides the one-time activation flow in Settings, so users don't need Node.js or Terminal.

```bash
# Rust toolchain (stable); on this machine it lives on the SSD:
export RUSTUP_HOME=/Volumes/PortableSSD/Tools/rust/rustup CARGO_HOME=/Volumes/PortableSSD/Tools/rust/cargo PATH=$CARGO_HOME/bin:$PATH
npm run desktop:dev        # run the app with hot reload
npm run desktop:build      # build Peakly.app and a .dmg (unsigned until a signing identity is configured)
npm run desktop:build:dev-signed   # debug build signed with your "Apple Development" certificate
```

Signing a development build with your Apple Development certificate keeps the app's identity stable across rebuilds, so macOS remembers **Always Allow** and Peakly unlocks by itself.

To release, sign with a **Developer ID Application** certificate and notarize. Tauri reads these from the environment:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER=… APPLE_API_KEY=… APPLE_API_KEY_PATH=…   # an App Store Connect API key with the Developer role, for notarization
npm run desktop:release
```

## Testing

End-to-end tests (Playwright, WebKit, like AppLustre) are the main safety net:

```bash
npm run e2e            # both suites
npm run e2e:web        # web app
npm run e2e:desktop    # Mac app frontend
npm run check          # types + lint + unit tests + e2e
```

- `e2e/mock-apple.mjs` stands in for App Store Connect, the App Store lookup and Apple's report storage, with fixed data (`e2e/fixtures/apple-data.ts`). It verifies ES256 signatures against a throwaway test key and permits only the narrowly shaped Analytics Reports setup request from the test Admin key.
- The **web** suite runs the real Next.js app with Apple traffic sent to the mock (`GI_E2E_APPLE_ORIGIN`, ignored in production builds).
- The **desktop** suite runs the real Mac app frontend in WebKit. `e2e/tauri-shim.ts` stands in for the native side: Keychain, signing, cache and the HTTP plugin protocol.
- Both cover sample mode and every section, connecting a key (including a rejected one), live numbers and insights, switching apps, day/week/month and ranges, the Table viewer, adding a vendor number, and removing the key. The Mac mock accepts only the explicitly shaped ongoing Analytics Reports request when signed by its test Admin key; other writes remain rejected.

Playwright browsers on this machine live on the SSD: `PLAYWRIGHT_BROWSERS_PATH=/Volumes/PortableSSD/Tools/playwright-browsers`.

| Path | What |
|---|---|
| `src/core/` | Shared logic for web and Mac: metrics, insights, Apple client and parsing, dataset, readiness, connection checks, Table viewer data |
| `src/components/` | Shared screens (dashboard, Table viewer, settings, sidebar, MCP, Feedback) |
| `src/app/`, `src/lib/server/` | Web app: Next.js pages and server actions; encrypted credential file; file cache |
| `desktop/` | Mac app frontend (Vite + React) using the shared core and screens |
| `src-tauri/` | Mac app native side (Rust): Keychain, signing, cache, HTTP plugin |
| `e2e/` | End-to-end suites, mock Apple server, Tauri stand-in |

## Roadmap

- Superwall (Query API with a `data:read` key): paywall and checkout funnel, with tester filtering by build release time
- Multi-tenant hosted mode: several Apple accounts per workspace, per-workspace keys, KMS-backed encryption, background refresh
- Warn when a saved key has a broader role than Sales and Reports
- More sources (Google Play, RevenueCat, GA4) behind the same provider interface

## License

To be decided before publishing (AGPL-3.0 is common for open-source SaaS; MIT is simplest).
