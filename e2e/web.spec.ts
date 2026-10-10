Warning: truncated output (original token count: 5377)
Total output lines: 339

import { chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ISSUER_ID, VENDOR_NUMBER, isoDay } from "./fixtures/apple-data";
import { CALENDLY_URL } from "../src/core/links";
import { KEY_FILE, STUDIO_RELEASED_AT, WRONG_ISSUER, appleRequests, expectAppLines, expectNativeFeedbackWorks, expectDonateTopRight, expectFeedbackBoard, expectNavOrder, expectRevenue, stubVoteWant, kpi, releaseDay, versionRow } from "./helpers";

// One server, one data folder: the steps build on each other (connect → use → remove).
test.describe.configure({ mode: "serial" });

test.describe("web app", () => {
  test("shows sample data and every section before a key is connected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Growth insights", level: 1 })).toBeVisible();
    await expect(page.getByText("You're looking at sample data")).toBeVisible();
    await expect(page.locator("aside")).toContainText("Peakly");
    await expectNavOrder(page);

    // Donations go through the Peakly website (its server holds the Stripe key), in a new tab.
    const donate = page.getByRole("region", { name: "Page actions" }).getByRole("link", { name: "Donate" });
    await expect(donate).toHaveAttribute("href", "https://getpeakly.app/donate");
    await expect(donate).toHaveAttribute("target", "_blank");
    await expect(donate).toHaveAttribute("rel", /noopener/);
    await expectDonateTopRight(page);

    await page.locator("aside").getByRole("link", { name: "MCP" }).click();
    await expect(page.getByRole("heading", { name: "MCP", level: 1 })).toBeVisible();
    await expectDonateTopRight(page);
    await expect(page.getByText("Coming soon")).toBeVisible();

    // Feedback is Peakly's VoteWant board, drawn natively (a stand-in VoteWant API in tests).
    const voteWant = await stubVoteWant(page);
    await page.locator("aside").getByRole("link", { name: "Feedback" }).click();
    await expectFeedbackBoard(page);
    await expect(page.getByRole("link", { name: "Open the board in your browser" })).toHaveAttribute("target", "_blank");
    const meeting = page.getByRole("link", { name: "Book a one-to-one" });
    await expect(meeting).toHaveAttribute("href", CALENDLY_URL);
    await expect(meeting).toHaveAttribute("target", "_blank");
    await expect(meeting).toHaveAttribute("rel", /noopener/);
    await expectNativeFeedbackWorks(page, voteWant, async () => {
      await page.locator("aside").getByRole("link", { name: "MCP" }).click();
      await page.locator("aside").getByRole("link", { name: "Feedback" }).click();
    });

    await page.locator("aside").getByRole("link", { name: "Table viewer" }).click();
    await expect(page.getByRole("heading", { name: "Table viewer", level: 1 })).toBeVisible();
    await expectDonateTopRight(page);
    await expect(page.getByRole("list", { name: "Color key" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("tab")).toHaveCount(16);
    // Report tabs load from Apple when opened, so sample mode asks for a key.
    await page.getByRole("tab", { name: /Sessions/ }).click();
    await expect(page.getByRole("tabpanel").getByRole("status")).toHaveText("Connect a key in Settings to load this report.");
  });

  test("keeps the key out until Apple accepts it, then connects with two inputs", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Not connected")).toBeVisible();
    const connect = page.getByRole("button", { name: "Connect" });
    await expect(connect).toBeDisabled();

    await page.locator('input[type="file"]').setInputFiles(KEY_FILE);
    await expect(page.getByText("AuthKey_E2ETESTKEY.p8")).toBeVisible();
    await expect(page.getByText("Key ID E2ETESTKEY")).toBeVisible();

    const issuer = page.getByRole("textbox", { name: "Issuer ID" });
    await issuer.fill(WRONG_ISSUER);
    await connect.click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Apple rejected the key (401)");
    await expect(page.getByText("Not connected")).toBeVisible();
    // The dropped key and issuer survive a failed attempt.
    await expect(page.getByText("AuthKey_E2ETESTKEY.p8")).toBeVisible();

    await issuer.fill(ISSUER_ID);
    await connect.click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("E2ETESTKEY")).toBeVisible();
    await expect(page.getByText("Not set · sales off")).toBeVisible();

    // Every app with its analytics readiness, plus the bootstrap command for the missing one.
    const apps = page.getByRole("heading", { name: "Your apps" }).locator("..");
    await expect(apps).toContainText("2 of 3 app(s) are ready");
    await expect(apps.getByRole("listitem").filter({ hasText: "Studio Level" })).toContainText("Reports available");
    await expect(apps.getByRole("listitem").filter({ hasText: "Calm Notes" })).toContainText("Analytics not enabled");
    await expect(apps.locator("code")).toContainText("scripts/enable-analytics-reports.mjs 1002");
  });

  test("shows the connected app's real numbers and insights", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("You're looking at sample data")).toHaveCount(0);
    // All apps together is the default: counts are added up, and conversion (App Store Connect's: total
    // downloads ÷ unique impressions) comes from the combined counts: Studio Level 6/40 = 15%, Echo Pad
    // 4/10 = 40% → 10/50 = 20% weighted, not the 27.5% average of the two rates.
    // Calm Notes has no store analytics, so it's left out of the totals, and the page says so.
    const picker = page.getByRole("combobox", { name: "Choose app" });
    await expect(picker).toHaveValue("all");
    await expect(kpi(page, "Impressions")).toContainText("2.2K");
    await expect(kpi(page, "Conversion rate")).toContainText("20%");
    await expectAppLines(page, ["Echo Pad", "Studio Level"]);
    await expect(page.getByText("Store analytics cover all but 1 app")).toBeVisible();
    await expect(page.getByText("Calm Notes (analytics not enabled)")).toBeVisible();

    await picker.selectOption({ label: "Studio Level" });
    await expect(page).toHaveURL(/app=1001/);

    await expect(kpi(page, "Impressions")).toContainText("1.4K");
    await expect(kpi(page, "Conversion rate")).toContainText("15%");
    await expect(kpi(page, "First-time downloads")).toContainText("168");
    await expect(kpi(page, "Product page views")).toContainText("280");

    await expect(page.getByRole("heading", { name: "Low impressions · High conversion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Search drives most downloads" })).toBeVisible();
    await expect(page.getByText("56 search downloads happened straight from the results list")).toBeVisible();

    // Every insight separates what the data shows from what we suspect, and says how to test it.
    const searchLed = page.getByRole("region", { name: "Search drives most downloads" });
    for (const part of ["What we see", "Possible reasons", "Try next", "It worked if:"]) await expect(searchLed).toContainText(part);
    // Each source's after-download numbers: deletions (opt-in installs), trials and purchases per download.
    await expect(searchLed).toContainText("App Store search: 168 first-time downloads (100%) · page conversion 40% · 33 deletions per 100 installs · 33 trial starts per 100 downloads · 17 purchases per 100 downloads");
    // The storefront funnel, split: page-view rate, page conversion, and direct downloads from search results.
    const storefront = page.getByRole("region", { name: "Low impressions · High conversion" });
    await expect(storefront).toContainText("280 product page views: 20% of impressions");
    await expect(storefront).toContainText("56 downloads straight from search results, without a…1377 tokens truncated…cell", { name: isoDay(-5), exact: true }) });
    await expect(restated.getByRole("cell")).toHaveText([isoDay(-5), "App Store search", "50", "40", "10", "0", "6", "4", "0"]);
    const usual = panel.getByRole("row").filter({ has: page.getByRole("cell", { name: isoDay(-6), exact: true }) });
    await expect(usual.getByRole("cell").nth(5)).toHaveText("6");
    await expect(panel.locator('th[data-provider="asc"]')).toHaveCount(9);

    await page.getByRole("tab", { name: /App Store versions/ }).click();
    await expect(panel.locator('th[data-provider="public"]')).toHaveText("Public release");
    // Each version's build, and whether activity on it comes from customers or testers.
    await expect(versionRow(panel, "2.2")).toContainText("14");
    await expect(versionRow(panel, "2.2")).toContainText("WAITING_FOR_REVIEW");
    await expect(versionRow(panel, "2.2")).toContainText("Not yet");
    await expect(versionRow(panel, "2.1")).toContainText("12");
    await expect(versionRow(panel, "2.1")).toContainText(releaseDay(STUDIO_RELEASED_AT));
    await expect(versionRow(panel, "2.1")).toContainText("READY_FOR_DISTRIBUTION");
    await expect(versionRow(panel, "2.1")).toContainText("Yes");
    // What the table works out itself is labeled as Peakly's, not Apple's.
    await expect(panel.locator('th[data-provider="derived"]')).toHaveText("Released");
    await expect(versionRow(panel, "2.0")).toContainText("Before Peakly started recording");

    await page.getByRole("tab", { name: /Sales by day/ }).click();
    await expect(panel.getByRole("status")).toContainText("Add a vendor number");
  });

  test("adds a vendor number only after Apple accepts it", async ({ page }) => {
    await page.goto("/settings");
    const vendor = page.getByRole("textbox", { name: "Add a vendor number to include sales" });
    await vendor.fill("12345678");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Invalid vendor number specified")).toBeVisible();

    await vendor.fill(VENDOR_NUMBER);
    const dataDir = join(tmpdir(), "peakly-e2e-web-data");
    const originalMode = (await stat(dataDir)).mode & 0o777;
    await chmod(dataDir, originalMode & ~0o222);
    try {
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status")).toHaveText("Could not save the vendor number. Please try again.");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(vendor).toHaveValue(VENDOR_NUMBER);
    } finally {
      await chmod(dataDir, originalMode);
    }

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("•••456")).toBeVisible();

    // With a vendor number, the exact sales reports take over the paid-sales insight: 27, because
    // day −20's report is unavailable (unknown), so its sale isn't counted.
    await page.goto("/?app=1001");
    await expect(page.getByRole("heading", { name: "27 paid sales in this period" })).toBeVisible();
    // All apps adds every app's units per day (only Studio Level sells).
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "27 paid sales in this period" })).toBeVisible();
    await expect(page.getByText("1 day(s) not published yet")).toBeVisible();

    await page.goto("/tables?app=1001");
    await page.getByRole("tab", { name: /Sales by day/ }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator('th[data-provider="vendor"]')).toHaveCount(8);
    await expect(panel.locator("tbody tr").first()).toContainText("Not published yet");
    await expect(panel.locator("tbody")).toContainText("Published");
    // A day Apple returned no report for, without saying why, is unknown, never "No sales".
    await expect(panel.locator("tbody")).toContainText("Unavailable");
    // A partial refund (zero units, −$1.00 proceeds) is subtracted: 3.49 − 1.00.
    const partial = panel.getByRole("row").filter({ has: page.getByRole("cell", { name: isoDay(-12), exact: true }) });
    await expect(partial.getByRole("cell").last()).toHaveText("2.49 USD");

    // The same day in Apple's purchases report, readable without the vendor number.
    await page.getByRole("tab", { name: /Purchases and subscriptions by day/ }).click();
    const revenueRow = panel.getByRole("row").filter({ has: page.getByRole("cell", { name: isoDay(-12), exact: true }) });
    await expect(revenueRow.getByRole("cell")).toHaveText([isoDay(-12), "1", "0", "2.49", "2", "1", "0", "1", "0", "20", "6"]);
  });

  test("table viewer loads every other report Apple offers when its tab is opened", async ({ page }) => {
    await page.goto("/tables?app=1001&range=7");
    const panel = page.getByRole("tabpanel");
    const open = async (name: RegExp) => { await page.getByRole("tab", { name }).click(); await expect(panel.getByRole("heading", { level: 2 })).toHaveText(name); };
    const column = (label: string) => panel.locator("th", { hasText: new RegExp(`^${label}$`) });

    // Analytics Reports, shown with Apple's own columns.
    await open(/^Discovery detail$/);
    await expect(column("Campaign")).toHaveAttribute("data-provider", "asc");
    await expect(panel.locator("tbody tr")).toHaveCount(6); // the last 7 days; Apple has published through 2 days ago
    await expect(panel.locator("tbody")).toContainText("example.com");
    await open(/^Download detail$/);
    await expect(column("Page Title")).toBeVisible();
    await open(/^Sessions$/);
    await expect(column("Total Session Duration")).toBeVisible();
    await expect(panel.locator("tbody tr").first()).toContainText("3600");
    await open(/^Installs and deletions$/);
    await expect(panel.locator("tbody")).toContainText("Delete");
    await open(/^Crashes$/);
    await expect(column("Crashes")).toBeVisible();
    await open(/^Install performance$/);
    await expect(panel.getByRole("status")).toHaveText("Apple hasn't published this report for these days.");

    // Sales and Trends reports (vendor number), filtered to the app.
    await open(/^Subscriptions \(sales\)$/);
    await expect(column("Developer Proceeds")).toHaveAttribute("data-provider", "vendor");
    await expect(panel.locator("tbody")).toContainText("Pro Monthly");
    await expect(panel.locator("tbody")).not.toContainText("Calm Plus");
    await open(/^Subscribers$/);
    await expect(panel.locator("tbody")).toContainText("sub-");
    await open(/^Offer code redemptions$/);
    await expect(panel.getByRole("status")).toContainText("Apple didn't return this report: Invalid vendor number specified");
    await open(/^Win-back eligibility$/);
    await expect(panel.getByRole("status")).toHaveText("No rows for the last 7 days.");

    // All apps: one table, with an App column, and a note for apps without analytics.
    await page.goto("/tables?range=7");
    await open(/^Sessions$/);
    await expect(column("App")).toBeVisible();
    await expect(panel.locator("tbody")).toContainText("Echo Pad");
    await expect(panel.locator("tbody")).toContainText("Studio Level");
    await expect(panel).toContainText("Calm Notes: Analytics Reports aren't enabled for this app.");
  });

  test("only ever reads from Apple", async () => {
    const requests = await appleRequests();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(requests.some((r) => r.path === "/v1/apps")).toBe(true);
    expect(requests.some((r) => r.path === "/v1/salesReports")).toBe(true);
  });

  test("removing the key returns to sample data", async ({ page }) => {
    await page.goto("/settings");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove key" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();
    await page.goto("/");
    await expect(page.getByText("You're looking at sample data")).toBeVisible();
  });
});
