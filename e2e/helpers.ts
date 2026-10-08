import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { isoDay } from "./fixtures/apple-data";

export const MOCK_APPLE = "http://127.0.0.1:4599";
export const TEST_KEY = readFileSync(join(__dirname, "fixtures", "e2e-key.txt"), "utf8");
export const KEY_FILE = { name: "AuthKey_E2ETESTKEY.p8", mimeType: "text/plain", buffer: Buffer.from(TEST_KEY) };
export const WRONG_ISSUER = "99999999-8888-7777-6666-555555555555";

/** The KPI card for a label, e.g. "Impressions". */
export const kpi = (page: Page, label: string): Locator =>
  page.locator("section", { has: page.getByRole("heading", { name: label, exact: true, level: 3 }) });

/** Every request the mock Apple server received during the run. */
export async function appleRequests(): Promise<{ method: string; host: string; path: string }[]> {
  return (await fetch(`${MOCK_APPLE}/__requests`)).json();
}

/** Studio Level 2.1's public release time in the mock (see e2e/mock-apple.mjs). */
export const STUDIO_RELEASED_AT = `${isoDay(-10)}T17:00:00Z`;

/** "Sep 28, 2026": the day part of how the Table viewer shows a release time. */
export const releaseDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A row of the App Store versions table, by version number. */
export const versionRow = (panel: Locator, version: string): Locator =>
  panel.getByRole("row").filter({ has: panel.page().getByRole("cell", { name: version, exact: true }) });

/** Ship Studio Level 2.2 in the mock App Store, or put it back in review. */
export async function shipStudioVersion(reset = false) {
  const res = await fetch(`${MOCK_APPLE}/__release${reset ? "?reset=1" : ""}`, { method: "POST" });
  return ((await res.json()) as { studioShipped: { releasedAt: string } | null }).studioShipped;
}

/** The All apps chart: says it's averaged, draws one line per reporting app, and labels each with its logo. `apps` in account (alphabetical) order. */
export async function expectAppLines(page: Page, apps: string[]) {
  await expect(page.getByRole("heading", { name: /Impressions and conversion rate · all apps averaged/ })).toBeVisible();
  const chart = page.getByRole("img", { name: "Impressions and conversion rate" });
  await expect(chart.locator("path[data-app]")).toHaveCount(apps.length);
  for (const app of apps) {
    await expect(chart.locator(`path[data-app="${app}"]`)).toHaveAttribute("d", /^M/);
    await expect(chart.getByLabel(app, { exact: true })).toHaveCount(1); // logo at the line's end
  }
  await expect(page.getByRole("list", { name: "Apps" }).getByRole("listitem")).toContainText(apps);

  // Coverage notes come after the insights, so what to do is read first.
  const note = page.getByRole("status").filter({ hasText: /Store analytics cover all but/ });
  const cards = page.locator("section").filter({ has: page.getByText("Try next", { exact: true }) });
  const lastCard = (await cards.last().boundingBox())!;
  const [noteBox, chartBox] = [(await note.boundingBox())!, (await chart.boundingBox())!];
  expect(noteBox.y).toBeGreaterThan(chartBox.y + chartBox.height);
  expect(noteBox.y).toBeGreaterThan(lastCard.y + lastCard.height);
  // Each insight card has its own color, like the KPI cards.
  const colors = await cards.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(colors.length).toBeGreaterThan(1);
  expect(new Set(colors).size).toBe(colors.length);
}

/** Donate sits at the top right of the page, above its content, on every screen. */
export async function expectDonateTopRight(page: Page) {
  const bar = page.getByRole("region", { name: "Page actions" });
  const donate = bar.getByRole("link", { name: "Donate" });
  await expect(donate).toBeVisible();
  const [box, heading] = [(await donate.boundingBox())!, (await page.locator("main h1").first().boundingBox())!];
  const viewport = page.viewportSize()!;
  expect(box.y).toBeLessThan(heading.y);
  expect(viewport.width - (box.x + box.width)).toBeLessThan(80);
  await expect(page.locator("aside").getByRole("link", { name: "Donate" })).toHaveCount(0);
  // The bottom of the sidebar is just the logo, "Peakly" and "Open source".
  await expect(page.locator("aside").getByRole("contentinfo", { name: "About Peakly" })).toHaveText("PeaklyOpen source");
}

/**
 * The Revenue and subscriptions section for Studio Level's mock reports over a window of `days`
 * (a purchase a day, one refund, one partial refund, 2 trials, 1 conversion and 1 renewal a day, one cancellation).
 */
export async function expectRevenue(page: Page, expected: Record<string, string>, active = "20 active paid subscriptions · 6 in a free trial") {
  const section = page.getByRole("region", { name: "Revenue and subscriptions" });
  await expect(section).toContainText(active);
  for (const [label, value] of Object.entries(expected)) {
    await expect(section.locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd").first()).toHaveText(value);
  }
}

/** The feedback board used by the e2e builds (NEXT_PUBLIC_VOTEWANT_BOARD / VITE_VOTEWANT_BOARD). */
export const FEEDBACK_BOARD_URL = "https://votewant.com/boards/peakly-e2e-board";

/** Serve a stand-in for votewant.com, so tests never reach the real VoteWant. */
export async function stubVoteWant(page: Page) {
  await page.route("https://votewant.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Board</title><h1>Stub VoteWant board</h1>" }));
}

/** Feedback embeds Peakly's VoteWant board and offers it in the browser. */
export async function expectFeedbackBoard(page: Page) {
  await expect(page.getByRole("heading", { name: "Feedback", level: 1 })).toBeVisible();
  const frame = page.locator('iframe[title="Peakly feedback board on VoteWant"]');
  await expect(frame).toHaveAttribute("src", FEEDBACK_BOARD_URL);
  await expect(page.frameLocator('iframe[title="Peakly feedback board on VoteWant"]').getByRole("heading")).toHaveText("Stub VoteWant board");
  const open = page.getByRole("link", { name: "Open the board in your browser" });
  await expect(open).toHaveAttribute("href", FEEDBACK_BOARD_URL);
  await expect(page.getByText("never leave this")).toBeVisible();
}

export async function expectNavOrder(page: Page) {
  const nav = page.locator("aside").getByRole("navigation", { name: "Main" });
  await expect(nav.locator("a, button")).toHaveText(["Growth insights", "MCP", "Table viewer", "Feedback", "Settings"]);
}
