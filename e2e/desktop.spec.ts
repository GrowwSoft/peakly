import { expect, test, type Page } from "@playwright/test";
import { ISSUER_ID, VENDOR_NUMBER } from "./fixtures/apple-data";
import { KEY_FILE, MOCK_APPLE, STUDIO_RELEASED_AT, WRONG_ISSUER, appleRequests, expectAppLines, expectDonateTopRight, expectFeedbackBoard, expectRevenue, FEEDBACK_BOARD_URL, stubVoteWant, releaseDay, shipStudioVersion, versionRow, expectNavOrder, kpi } from "./helpers";
import { installTauriShim } from "./tauri-shim";

const SCRIPT_PATH = "/Applications/Peakly.app/Contents/Resources/scripts/enable-analytics-reports.mjs";

// The Mac app keeps its state in one window, so the steps share one page.
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(installTauriShim, { mockOrigin: MOCK_APPLE, scriptPath: SCRIPT_PATH });
  await stubVoteWant(page);
  await page.goto("/");
});

test.afterAll(async () => {
  await page.close();
});

const nav = (name: string) => page.locator("aside").getByRole("navigation", { name: "Main" }).getByRole("button", { name });
const keychainReads = () => page.evaluate(() => (window as unknown as { __peaklyE2E: { keychainReads: () => number } }).__peaklyE2E.keychainReads());
const shimCalls = () => page.evaluate(() => (window as unknown as { __peaklyE2E: { calls: { cmd: string; method?: string }[] } }).__peaklyE2E.calls);

test.describe("Mac app (Tauri frontend in WebKit)", () => {
  test("starts in sample mode with every section", async () => {
    await expect(page.getByRole("heading", { name: "Growth insights", level: 1 })).toBeVisible();
    await expect(page.getByText("You're looking at sample data")).toBeVisible();
    await expectDonateTopRight(page);
    await expectNavOrder(page);

    // Donate opens the Peakly website in the default browser; the app window stays put.
    const url = page.url();
    await page.getByRole("region", { name: "Page actions" }).getByRole("link", { name: "Donate" }).click();
    await expect.poll(async () => (await shimCalls()).filter((c) => c.cmd === "plugin:opener|open_url").map((c) => (c as { url?: string }).url))
      .toEqual(["https://getpeakly.app/donate"]);
    expect(page.url()).toBe(url);

    await nav("Feedback").click();
    await expectFeedbackBoard(page);
    // In the Mac app, "Open the board" goes to the browser through the native side.
    await page.getByRole("link", { name: "Open the board in your browser" }).click();
    await expect.poll(async () => (await shimCalls()).filter((c) => c.cmd === "plugin:opener|open_url").map((c) => (c as { url?: string }).url))
      .toContain(FEEDBACK_BOARD_URL);
    await expectDonateTopRight(page);
    await nav("MCP").click();
    await expect(page.getByText("Coming soon")).toBeVisible();
    await nav("Table viewer").click();
    await expect(page.getByRole("tab")).toHaveCount(16);
  });

  test("verifies the key with Apple before saving it to the Keychain", async () => {
    await nav("Settings").click();
    await expect(page.getByText("Not connected")).toBeVisible();
    await expectDonateTopRight(page);
    await page.locator('input[type="file"]').setInputFiles(KEY_FILE);
    await expect(page.getByText("Key ID E2ETESTKEY")).toBeVisible();

    const issuer = page.getByRole("textbox", { name: "Issuer ID" });
    await issuer.fill(WRONG_ISSUER);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Apple rejected the key (401)");
    expect(await page.evaluate(() => (window as unknown as { __peaklyE2E: { keychain: () => unknown } }).__peaklyE2E.keychain())).toBeNull();

    await issuer.fill(ISSUER_ID);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    const apps = page.getByRole("heading", { name: "Your apps" }).locator("..");
    await expect(apps).toContainText("2 of 3 app(s) are ready");
    await expect(apps.getByRole("listitem").filter({ hasText: "Calm Notes" })).toContainText("Analytics not enabled");
    await expect(apps.getByRole("button", { name: "Enable analytics for Calm Notes" })).toBeVisible();
  });

  test("shows the connected app's real numbers and insights", async () => {
    await nav("Growth insights").click();
    // All apps together is the default. Calm Notes has no store analytics, so the totals are Studio Level's.
    const picker = page.getByRole("combobox", { name: "Choose app" });
    await expect(picker).toHaveValue("all");
    await expect(page.locator("aside")).toContainText("3 apps combined");
    // All apps shows the Peakly logo, so the brand is what people see by default.
    await expect(page.locator('aside label img[src="/brand/logo.svg"]')).toBeVisible();
    await expect(kpi(page, "Impressions")).toContainText("2.2K");
    await expect(kpi(page, "Conversion rate")).toContainText("20%");
    await expectAppLines(page, ["Echo Pad", "Studio Level"]);
    await expect(page.getByText("Store analytics cover all but 1 app")).toBeVisible();
    await expect(page.getByText("Calm Notes (analytics not enabled)")).toBeVisible();

    await picker.selectOption({ label: "Studio Level" });
    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await expect(kpi(page, "Conversion rate")).toContainText("15%");
    await expect(kpi(page, "First-time downloads")).toContainText("168");
    await expect(page.getByRole("heading", { name: "Low impressions · High conversion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Search drives most downloads" })).toBeVisible();

    await page.getByRole("button", { name: "week" }).click();
    await expect(page.getByRole("button", { name: "week" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("combobox", { name: "Date range" }).selectOption("7");
    await expect(kpi(page, "Impressions")).toContainText("350");
  });

  test("switching apps keeps the chosen range", async () => {
    await page.getByRole("combobox", { name: "Choose app" }).selectOption({ label: "Calm Notes" });
    await expect(page.getByText("Store analytics unavailable")).toBeVisible();
    await page.getByRole("combobox", { name: "Choose app" }).selectOption({ label: "Studio Level" });
    await expect(kpi(page, "Impressions")).toContainText("350");
  });

  test("table viewer colors each column by its key", async () => {
    await nav("Table viewer").click();
    await expect(page.getByText("All the data Peakly can read for Studio Level")).toBeVisible();
    await page.getByRole("tab", { name: /Analytics readiness/ }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator("tbody")).toContainText("Calm Notes");
    await page.getByRole("tab", { name: /Store analytics by day and source/ }).click();
    await expect(panel.locator('th[data-provider="asc"]')).toHaveCount(9);
  });

  test("keeps Settings usable after a vendor save error and then adds the number", async () => {
    await nav("Settings").click();
    const vendor = page.getByRole("textbox", { name: "Add a vendor number to include sales" });
    await vendor.fill("12345678");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Invalid vendor number specified")).toBeVisible();

    const pageErrors: string[] = [];
    const recordPageError = (error: Error) => pageErrors.push(error.message);
    page.on("pageerror", recordPageError);
    await vendor.fill(VENDOR_NUMBER);
    await page.evaluate(() => {
      (window as unknown as { __peaklyE2E: { failNextVendorWrite: (message: string) => void } })
        .__peaklyE2E.failNextVendorWrite("Simulated Keychain write failure.");
    });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Simulated Keychain write failure.");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test connection" })).toBeVisible();
    await expect(vendor).toBeVisible();
    await expect(vendor).toHaveValue(VENDOR_NUMBER);
    expect(pageErrors).toEqual([]);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("•••456")).toBeVisible();
    page.off("pageerror", recordPageError);

    await nav("Growth insights").click();
    // Studio Level, last 7 days: a purchase a day, and the cancellation on day −7.
    await expect(page.getByRole("heading", { name: "7 paid sales in this period" })).toBeVisible();
    await expectRevenue(page, { "Estimated proceeds": "$24.43", Purchases: "7", Refunds: "0", "Free-trial starts": "14", Churned: "1" });
    await nav("Table viewer").click();
    await page.getByRole("tab", { name: /Sales by day/ }).click();
    await expect(page.getByRole("tabpanel").locator('th[data-provider="vendor"]')).toHaveCount(8);
    // Report tabs load from Apple through the native side when opened.
    await page.getByRole("tab", { name: /^Sessions/ }).click();
    await expect(page.getByRole("tabpanel").locator("th", { hasText: /^Total Session Duration$/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Subscribers/ }).click();
    await expect(page.getByRole("tabpanel").locator("tbody")).toContainText("Pro Monthly");
  });

  test("only reads from Apple, through the native HTTP plugin", async () => {
    const httpCalls = (await shimCalls()).filter((c) => c.cmd === "plugin:http|fetch");
    expect(httpCalls.length).toBeGreaterThan(0);
    expect(httpCalls.filter((c) => c.method !== "GET")).toEqual([]);
    expect((await appleRequests()).filter((r) => r.method !== "GET")).toEqual([]);
  });

  test("revisiting an app reuses what it already loaded instead of asking Apple again", async () => {
    // The calls that build a dashboard (the version list and sales reports; the readiness list is separate and reloads with the Table viewer).
    const studioCalls = async () => (await appleRequests()).filter((r) => /appStoreVersions|salesReports/.test(r.path) && !r.path.includes("/apps/1002/")).length;
    const picker = page.getByRole("combobox", { name: "Choose app" });
    await nav("Growth insights").click();
    await expect(kpi(page, "Impressions")).toContainText("350");
    const before = await studioCalls();

    // Switching away and back, changing screens and coming back: all served from the cache.
    await picker.selectOption({ label: "Calm Notes" });
    await expect(page.getByText("Store analytics unavailable")).toBeVisible();
    const afterCalm = await studioCalls();
    await picker.selectOption({ label: "Studio Level" });
    await expect(kpi(page, "Impressions")).toContainText("350");
    await nav("Table viewer").click();
    await nav("Growth insights").click();
    await expect(kpi(page, "Impressions")).toContainText("350");
    expect(await studioCalls()).toBe(afterCalm);
    expect(afterCalm).toBeGreaterThanOrEqual(before);

    // Retry is the way to ask Apple again.
    const beforeRefresh = await studioCalls();
    await page.getByRole("combobox", { name: "Date range" }).selectOption("28");
    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await page.getByRole("combobox", { name: "Date range" }).selectOption("7");
    await expect(kpi(page, "Impressions")).toContainText("350");
    const afterRanges = await studioCalls();
    await page.getByRole("combobox", { name: "Date range" }).selectOption("28");
    await page.getByRole("combobox", { name: "Date range" }).selectOption("7");
    await expect(kpi(page, "Impressions")).toContainText("350");
    // Each range loads once; going back to one already seen costs nothing.
    expect(await studioCalls()).toBe(afterRanges);
    expect(afterRanges).toBeGreaterThan(beforeRefresh);
  });

  test("remembers when each version went public after a newer one ships", async () => {
    const shipped = await shipStudioVersion();
    try {
      // A range not loaded yet, so the dataset is fetched fresh and sees 2.2 live.
      await nav("Growth insights").click();
      await page.getByRole("combobox", { name: "Date range" }).selectOption("90");
      await nav("Table viewer").click();
      await page.getByRole("tab", { name: /App Store versions/ }).click();
      const panel = page.getByRole("tabpanel");
      await expect(versionRow(panel, "2.2")).toContainText("READY_FOR_DISTRIBUTION");
      await expect(versionRow(panel, "2.2")).toContainText(releaseDay(shipped!.releasedAt));
      await expect(versionRow(panel, "2.2")).toContainText("Yes");
      // Apple's lookup now only knows 2.2; 2.1's release time comes from Peakly's history.
      await expect(versionRow(panel, "2.1")).toContainText("REPLACED_WITH_NEW_VERSION");
      await expect(versionRow(panel, "2.1")).toContainText(releaseDay(STUDIO_RELEASED_AT));
      // So the chart still marks the 2.1 release.
      await nav("Growth insights").click();
      await page.getByRole("button", { name: "day" }).click();
      await expect(page.getByRole("img", { name: "Impressions and conversion rate" }).getByText("v2.1")).toBeVisible();
    } finally {
      await shipStudioVersion(true);
      await page.getByRole("combobox", { name: "Date range" }).selectOption("7");
    }
  });

  test("never asks the Keychain at launch; one Unlock unlocks every screen", async () => {
    // The key was saved in this launch, so signing every request so far needed no Keychain read.
    expect((await shimCalls()).filter((c) => c.cmd === "asc_token").length).toBeGreaterThan(5);
    expect(await keychainReads()).toBe(0);

    // Relaunch with the key saved: everything that needs it is locked, and nothing asked the Keychain.
    await page.reload();
    const unlockPanel = page.getByRole("region", { name: "Your App Store Connect key is locked" });
    await expect(unlockPanel).toContainText("E2ETESTKEY");
    await expect(page.locator("aside")).toContainText("Key locked");
    await nav("Table viewer").click();
    await expect(unlockPanel).toBeVisible();
    await nav("Settings").click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(unlockPanel).toBeVisible();
    expect(await keychainReads()).toBe(0);
    expect((await shimCalls()).filter((c) => c.cmd === "asc_token")).toEqual([]);

    // Unlock from the Table viewer: one Keychain read, and every screen is unlocked.
    await nav("Table viewer").click();
    await unlockPanel.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("tab")).toHaveCount(16);
    await nav("Growth insights").click();
    await page.getByRole("combobox", { name: "Choose app" }).selectOption({ label: "Studio Level" });
    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await nav("Settings").click();
    await expect(page.getByRole("button", { name: "Test connection" })).toBeVisible();
    await expect(unlockPanel).toHaveCount(0);
    expect((await shimCalls()).filter((c) => c.cmd === "asc_token").length).toBeGreaterThan(1);
    expect(await keychainReads()).toBe(1);
  });

  test("a key saved by an older Peakly is unlocked once, then shows its details while locked", async () => {
    // Older versions kept nothing outside the Keychain, so only an unlock can tell what's saved.
    await page.evaluate(() => { sessionStorage.removeItem("__peaklyE2ESummary"); sessionStorage.setItem("__peaklyE2EEarlierUse", "1"); });
    await page.reload();
    const unlockPanel = page.getByRole("region", { name: "Your App Store Connect key is locked" });
    await expect(unlockPanel).toContainText("A key is saved in this Mac's Keychain.");
    await unlockPanel.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("combobox", { name: "Choose app" })).toBeVisible();
    expect(await keychainReads()).toBe(1);

    await page.reload();
    await expect(unlockPanel).toContainText("E2ETESTKEY");
    expect(await keychainReads()).toBe(0);
  });

  test("a signed Peakly unlocks by itself at launch", async () => {
    await page.evaluate(() => sessionStorage.setItem("__peaklyE2ESigned", "1"));
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Choose app" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your App Store Connect key is locked" })).toHaveCount(0);
    expect(await keychainReads()).toBe(1);
  });

  test("opens with the saved dashboard and asks Apple only when new data could exist", async () => {
    const studioChecks = async () => (await appleRequests()).filter((r) => r.path === "/v1/apps/1001/appStoreVersions").length;
    const freshness = page.getByRole("status", { name: "Data freshness" });
    const picker = page.getByRole("combobox", { name: "Choose app" });
    const before = await studioChecks();

    // Relaunch: the dashboard comes from this Mac, and Apple isn't asked before its next publish.
    await page.reload();
    await picker.selectOption({ label: "Studio Level" });
    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await expect(freshness).toContainText("Updated");
    await expect(freshness).toContainText("Apple's next data expected after");
    expect(await studioChecks()).toBe(before);

    // Once Apple could have published, opening the app shows the saved data and checks in the background.
    await page.evaluate(() => {
      const e2e = (window as unknown as { __peaklyE2E: { cacheGet: (k: string) => string | undefined; cacheSet: (k: string, v: string) => void } }).__peaklyE2E;
      const key = "dataset-v3/88123456/1001-28.json";
      e2e.cacheSet(key, JSON.stringify({ ...JSON.parse(e2e.cacheGet(key)!), nextCheckAt: 0 }));
    });
    await picker.selectOption({ label: "Calm Notes" });
    await picker.selectOption({ label: "Studio Level" });
    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await expect(freshness).toContainText("Apple's next data expected after");
    expect(await studioChecks()).toBe(before + 1);

    // Refresh now asks Apple straight away, keeping the numbers on screen.
    await freshness.getByRole("button", { name: "Refresh now" }).click();
    await expect(freshness).toContainText("Apple's next data expected after");
    await expect.poll(studioChecks).toBe(before + 2);
    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await page.evaluate(() => sessionStorage.removeItem("__peaklyE2ESigned"));
  });

  test("removing the key clears the Keychain and returns to sample data", async () => {
    await nav("Settings").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove key" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __peaklyE2E: { keychain: () => unknown } }).__peaklyE2E.keychain())).toBeNull();
    await nav("Growth insights").click();
    await expect(page.getByText("You're looking at sample data")).toBeVisible();
  });
});
