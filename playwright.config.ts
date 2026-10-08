import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOCK_APPLE = "http://127.0.0.1:4599";
const WEB = "http://127.0.0.1:3310";
const DESKTOP = "http://127.0.0.1:4175";

/**
 * End-to-end suites, in the style of AppLustre:
 * - web: the Next.js app against a mock App Store Connect.
 * - desktop: the Mac app's built frontend in WebKit (the engine of the Tauri window),
 *   with the native side stood in for by e2e/tauri-shim.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "web", testMatch: /web\.spec\.ts/, use: { browserName: "webkit", baseURL: WEB } },
    { name: "desktop", testMatch: /desktop\.spec\.ts/, use: { browserName: "webkit", baseURL: DESKTOP } },
  ],
  webServer: [
    { command: "node e2e/mock-apple.mjs", url: `${MOCK_APPLE}/health`, reuseExistingServer: false },
    {
      command: "node e2e/serve-web.mjs",
      url: WEB,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        GI_DATA_DIR: join(tmpdir(), "peakly-e2e-web-data"),
        GI_E2E_APPLE_ORIGIN: MOCK_APPLE,
        GI_NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_VOTEWANT_BOARD: "peakly-e2e-board",
        E2E_WEB_PORT: "3310",
      },
    },
    {
      command: "VITE_VOTEWANT_BOARD=peakly-e2e-board npx vite build --config desktop/vite.config.ts && npx vite preview --config desktop/vite.config.ts --port 4175 --strictPort",
      url: DESKTOP,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
