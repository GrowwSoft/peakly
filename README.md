<img src="public/brand/logo.svg" width="72" alt="" />

# Peakly

Growth insights for App Store apps. Connect App Store Connect to see discovery, conversion, sources and sales, plus a recommended next step that's honest about sample size.

[Website](https://getpeakly.app) · [Donate to Peakly](https://getpeakly.app/donate)

> Working title. MVP scope: App Store Connect only (Analytics Reports + Sales reports). Superwall and other sources come later through the same provider pattern.

## Build the Mac app

Peakly is free and open source. To use it on your Mac, build it from this repository. The first build takes a few minutes.

```bash
# 1. Tools: Xcode Command Line Tools and Rust (plus Node.js from https://nodejs.org)
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"   # or open a new Terminal window

# 2. Get Peakly and build the app
git clone https://github.com/GrowwSoft/peakly.git
cd peakly
npm install
npm run desktop:build -- --bundles app

# 3. Open it (drag Peakly.app into Applications to keep it)
open src-tauri/target/release/bundle/macos/Peakly.app
```

Peakly opens with sample data. Connect App Store Connect in **Settings** (see [Connecting](#connecting-2-inputs-per-apple-account)). Builds without a signing certificate ask you to click **Unlock** once per launch, so Peakly can read its key from the Keychain (see [Mac app](#mac-app-tauri)).

To update later, from the `peakly` folder:

```bash
git pull
npm install
npm run desktop:build -- --bundles app
```

Prefer a server? See [Production self-hosting](#production-self-hosting) for the web app.

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
- `GI_BASIC_AUTH` protects the web app's reports and settings. It is required for every production deployment and any instance reachable beyond this computer. The development and production start commands bind to `127.0.0.1` by default. Every private-data Server Function checks access too; `proxy.ts` adds the site-wide gate.
- The saved connection stays read-only. The Mac app can create a single ongoing Analytics Reports request only after a user previews the specific app and explicitly confirms; any separate Admin key is used in memory for that action and never saved. The web app uses the standalone local script for this one-time setup.

## Setup

### Local development

```bash
npm install
cp .env.example .env.local   # set GI_ENCRYPTION_KEY (openssl rand -base64 32); in development one is generated into .data/
npm run dev
```

Open http://localhost:3000. You'll see sample data until you connect a key in **Settings**.

### Production self-hosting

`npm run dev` starts the development server. To build and run the production web app:

```bash
npm run build
npm start
```

Before starting a production server, set a unique, strong `GI_BASIC_AUTH` value (format: `user:password`) and `GI_ENCRYPTION_KEY`; production requests fail closed if either protection is missing. Serve it over HTTPS so the Basic Auth password is protected in transit. Set `GI_DATA_DIR` to persistent storage if the default `.data` directory is not durable across restarts. To expose the app through a reverse proxy or LAN, keep Next.js bound to loopback and configure `GI_BASIC_AUTH` first.

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
# Needs Xcode Command Line Tools and Rust; see "Build the Mac app" above.
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

Install the test browser with `npx playwright install webkit`. If your browsers live outside Playwright's default cache, set `PLAYWRIGHT_BROWSERS_PATH` to that location.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and deployment boundaries, and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for publication checks and separate deployment gates.

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

Peakly's source is licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for the project copyright notice. Third-party dependencies retain their own licenses.
