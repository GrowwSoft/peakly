import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { isoDay } from "./fixtures/apple-data";
import type { FeedbackComment } from "../src/core/votewant";

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
export const FEEDBACK_BOARD_URL = "https://votewant.com/boards/peakly-e2e-board?accent=2a78d6";

/** What Peakly sent to the stand-in VoteWant, for assertions. */
export interface VoteWantStub {
  readonly authorizations: string[];
  readonly commentSubmissions: { requestId: string; body: string; confirmPublic: boolean }[];
  readonly comments: Record<string, FeedbackComment[]>;
  registrations: number;
  readonly requests: { id: string; title: string; body: string; type: string; status: string; participationVoteCount: number; downVoteCount: number; commentCount: number }[];
  readonly votes: Record<string, "up" | "down">;
}

/**
 * A stand-in for VoteWant's public API (board, install voter, votes, feedback), so tests never
 * reach the real VoteWant. It answers with CORS headers, like the real API, because Peakly
 * calls it straight from the page.
 */
export async function stubVoteWant(page: Page): Promise<VoteWantStub> {
  const state: VoteWantStub = {
    authorizations: [],
    commentSubmissions: [],
    comments: {},
    registrations: 0,
    requests: [
      { body: "Export the table viewer as CSV.", commentCount: 0, downVoteCount: 0, id: "request_csv", participationVoteCount: 3, status: "open", title: "CSV export", type: "feature" },
      { body: "Show Android installs too.", commentCount: 0, downVoteCount: 1, id: "request_android", participationVoteCount: 1, status: "under review", title: "Google Play support", type: "feature" },
    ],
    votes: {},
  };
  const cors = { "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-origin": "*" };
  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", headers: cors, status });
  await page.route("https://votewant.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ headers: cors, status: 204 });
    const path = new URL(request.url()).pathname;
    const authorization = request.headers().authorization;
    if (authorization) state.authorizations.push(authorization);
    if (path === "/api/v1/boards/peakly-e2e-board") {
      return reply(route, { appearance: { accent: null, showHeader: false, voteMode: "up_down" }, board: { name: "Peakly", slug: "peakly-e2e-board" }, owner: { name: "Peakly" }, requests: state.requests });
    }
    if (path === "/api/v1/voters" && request.method() === "POST") {
      state.registrations += 1;
      return reply(route, { token: `vw_voter.install-${state.registrations}.secret`, voterId: `install-${state.registrations}` }, 201);
    }
    const comments = /^\/api\/v1\/requests\/([^/]+)\/comments$/u.exec(path);
    if (comments && request.method() === "GET") {
      return reply(route, { comments: state.comments[comments[1]] ?? [] });
    }
    if (!authorization?.startsWith("Bearer vw_voter.")) return reply(route, { error: "A valid voter credential is required." }, 401);
    if (path === "/api/v1/boards/peakly-e2e-board/votes/mine") return reply(route, { votes: state.votes });
    if (comments && request.method() === "POST") {
      const submitted = request.postDataJSON() as { body: string; confirmPublic: boolean };
      state.commentSubmissions.push({ ...submitted, requestId: comments[1] });
      const target = state.requests.find((item) => item.id === comments[1]);
      if (!target) return reply(route, { error: "Request not found." }, 404);
      const comment: FeedbackComment = {
        authorLabel: "Anonymous · A1B2C3D4",
        body: submitted.body,
        createdAt: new Date().toISOString(),
        id: `comment_${(state.comments[comments[1]] ?? []).length + 1}`,
        provenanceLabel: "Anonymous visitor",
      };
      state.comments[comments[1]] = [...(state.comments[comments[1]] ?? []), comment];
      target.commentCount = state.comments[comments[1]].length;
      return reply(route, { id: comment.id }, 201);
    }
    const vote = /^\/api\/v1\/requests\/([^/]+)\/votes$/u.exec(path);
    if (vote) {
      const direction = (request.postDataJSON() as { direction: "up" | "down" }).direction;
      const target = state.requests.find((item) => item.id === vote[1])!;
      const previous = state.votes[target.id];
      if (previous === "up") target.participationVoteCount -= 1;
      if (previous === "down") target.downVoteCount -= 1;
      if (direction === "up") target.participationVoteCount += 1; else target.downVoteCount += 1;
      state.votes[target.id] = direction;
      return reply(route, { direction, downVoteCount: target.downVoteCount, participationVoteCount: target.participationVoteCount });
    }
    if (path === "/api/v1/boards/peakly-e2e-board/feedback") {
      const submitted = request.postDataJSON() as { title: string; body: string; type: string };
      state.requests.push({ body: submitted.body, commentCount: 0, downVoteCount: 0, id: `request_${state.requests.length + 1}`, participationVoteCount: 0, status: "open", title: submitted.title, type: submitted.type === "issue" ? "bug" : "feature" });
      return reply(route, { href: "/boards/peakly-e2e-board/requests/new", id: `request_${state.requests.length}`, title: submitted.title }, 201);
    }
    return reply(route, { error: "Not found." }, 404);
  });
  return state;
}

/** Feedback draws Peakly's VoteWant board natively (no frame), and offers the full board in the browser. */
export async function expectFeedbackBoard(page: Page) {
  await expect(page.getByRole("heading", { name: "Feedback", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Requests" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Upvote CSV export" })).toContainText("3");
  await expect(page.locator("iframe")).toHaveCount(0);
  const open = page.getByRole("link", { name: "Open the board in your browser" });
  await expect(open).toHaveAttribute("href", FEEDBACK_BOARD_URL);
  await expect(page.getByText(/Comments are public and show this install's stable anonymous ID/u)).toBeVisible();
}

/** Votes and feedback go to VoteWant with this install's anonymous token, registered once. */
export async function expectNativeFeedbackWorks(page: Page, stub: VoteWantStub, openFeedback: () => Promise<void>) {
  await openFeedback();
  const upvote = page.getByRole("button", { name: "Upvote CSV export" });
  await upvote.click();
  await expect(upvote).toContainText("4");
  await expect(upvote).toHaveAttribute("aria-pressed", "true");
  const downvote = page.getByRole("button", { name: "Downvote CSV export" });
  await downvote.click();
  await expect(downvote).toContainText("1");
  await expect(upvote).toContainText("3");

  await page.getByRole("button", { name: "Send feedback" }).click();
  const form = page.getByRole("form", { name: "Send feedback" });
  await form.getByText("Issue", { exact: true }).click();
  await form.getByLabel("Title").fill("Crash on export");
  await form.getByLabel("Details").fill("Exporting a long range crashes.");
  await form.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thanks, your feedback is on the board.");
  await expect(page.getByRole("list", { name: "Requests" })).toContainText("Crash on export");

  // The request card itself opens its discussion, so people can reach comments
  // without guessing that the small comment count is a control.
  const requestCard = page.getByRole("button", { name: "Open discussion for CSV export" });
  await expect(requestCard).toContainText("Read or add a comment");
  await requestCard.click();
  const discussion = page.getByRole("region", { name: "Comments on CSV export" });
  await discussion.getByLabel("Add a comment").fill("Please include the selected date range in the export.");
  const publicDisclosure = discussion.getByLabel("I understand this comment will be public and won't include personal or account data.");
  const postComment = discussion.getByRole("button", { name: "Post comment" });
  await expect(postComment).toBeDisabled();
  await publicDisclosure.check();
  await postComment.click();
  await expect(discussion).toContainText("Please include the selected date range in the export.");
  await expect(discussion).toContainText("Anonymous · A1B2C3D4");
  await expect(discussion).toContainText("Anonymous visitor");
  await expect(page.getByRole("button", { name: "Hide discussion for CSV export" })).toContainText("Hide discussion");
  expect(stub.commentSubmissions).toEqual([{
    body: "Please include the selected date range in the export.",
    confirmPublic: true,
    requestId: "request_csv",
  }]);

  // Coming back reuses the same install token: one registration, every call authorized.
  await openFeedback();
  await expect(page.getByRole("button", { name: "Downvote CSV export" })).toHaveAttribute("aria-pressed", "true");
  expect(stub.registrations).toBe(1);
  expect(new Set(stub.authorizations)).toEqual(new Set(["Bearer vw_voter.install-1.secret"]));
}

export async function expectNavOrder(page: Page) {
  const nav = page.locator("aside").getByRole("navigation", { name: "Main" });
  await expect(nav.locator("a, button")).toHaveText(["Growth insights", "MCP", "Table viewer", "Feedback", "Settings"]);
}
