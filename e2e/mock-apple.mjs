// Mock App Store Connect, iTunes lookup and S3 report storage for end-to-end tests.
// Requests arrive as /__host/<original host>/<path>; the apps rewrite Apple URLs to this server in test runs only.
import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { ANALYTICS_DAYS, APPS, DAILY, ECHO_DAILY, ISSUER_ID, KEY_ID, VENDOR_NUMBER, isoDay } from "./fixtures/apple-data.ts";

const UNEXPLAINED_SALES_DAY = isoDay(-20);
const STUDIO_PURCHASE = { price: 4.99, proceeds: 3.49 };
const REFUND_DAY = isoDay(-10);
const PARTIAL_REFUND_DAY = isoDay(-12);
const PARTIAL_REFUND = 1;
const CHURN_DAY = isoDay(-7);
const BILLING_CHURN_DAY = isoDay(-15);
const RESTATED_DAY = isoDay(-5);

/** Apps whose Analytics Reports are on and published. */
const REPORTING = { "1001": { name: "Studio Level", daily: DAILY }, "1003": { name: "Echo Pad", daily: ECHO_DAILY } };

const PORT = Number(process.env.MOCK_APPLE_PORT ?? 4599);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const publicKey = createPublicKey(readFileSync(new URL("./fixtures/e2e-key.pub.txt", import.meta.url), "utf8"));
const ADMIN_KEY_ID = "E2EADMKEY1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEzwJIBxXZKwAAAABJRU5ErkJggg==", "base64");
const requests = [];
const createdAnalyticsRequests = new Set();

// Studio Level's versions: 2.2 is in review until a test ships it with POST /__release.
const STUDIO_RELEASED_AT = `${isoDay(-10)}T17:00:00Z`;
let studioShipped = null; // { releasedAt } once 2.2 has gone live
const studioVersions = () => [
  ["2.2", studioShipped ? "READY_FOR_DISTRIBUTION" : "WAITING_FOR_REVIEW", "14"],
  ["2.1", studioShipped ? "REPLACED_WITH_NEW_VERSION" : "READY_FOR_DISTRIBUTION", "12"],
  ["2.0", "REPLACED_WITH_NEW_VERSION", "9"],
];

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const error = (res, status, code, detail) => json(res, status, { errors: [{ status: String(status), code, title: code, detail }] });
const gz = (res, text) => { res.writeHead(200, { "content-type": "application/a-gzip" }); res.end(gzipSync(text)); };
const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Accept only ES256 tokens signed by the e2e test key, for the e2e issuer, not expired. */
function authorized(req, expectedKeyId = KEY_ID) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  try {
    const header = JSON.parse(b64(h).toString());
    const payload = JSON.parse(b64(p).toString());
    if (header.alg !== "ES256" || header.kid !== expectedKeyId || payload.iss !== ISSUER_ID || payload.aud !== "appstoreconnect-v1") return false;
    if (payload.exp < Date.now() / 1000) return false;
    return verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64(s));
  } catch {
    return false;
  }
}

const resource = (type, id, attributes) => ({ type, id, attributes });
const page = (data) => ({ data, links: {} });

function engagementTsv(date, id, { withTaps = true } = {}) {
  const { name, daily } = REPORTING[id];
  const rows = [
    ["Impression", "No page", "", daily.impressions, daily.uniqueImpressions],
    ["Page view", "Product page", "", daily.pageViews, 9],
    ...(withTaps ? [["Tap", "Product page", "Get", daily.getTaps, 6]] : []),
  ];
  return ["Date\tApp Name\tApp Apple Identifier\tEvent\tPage Type\tSource Type\tEngagement Type\tDevice\tTerritory\tCounts\tUnique Counts",
    ...rows.map(([event, pageType, engagement, counts, unique]) => [date, name, id, event, pageType, "App Store search", engagement, "iPhone", "US", counts, unique].join("\t"))].join("\n") + "\n";
}

function downloadsTsv(date, id) {
  const { name, daily } = REPORTING[id];
  // Apple's files and glossary disagree on capitalization; Echo Pad uses the glossary's.
  const [firstTime, noPage] = id === "1003" ? ["First-time Download", "No Page"] : ["First-time download", "No page"];
  return ["Date\tApp Name\tApp Apple Identifier\tDownload Type\tApp Version\tDevice\tSource Type\tPage Type\tTerritory\tCounts",
    [date, name, id, firstTime, "2.1", "iPhone", "App Store search", "Product page", "US", daily.pageDownloads].join("\t"),
    [date, name, id, firstTime, "2.1", "iPhone", id === "1003" ? "Web referrer" : "App Store search", noPage, "US", daily.directDownloads].join("\t")].join("\n") + "\n";
}

function salesTsv(date) {
  const header = ["Provider", "Provider Country", "SKU", "Developer", "Title", "Version", "Product Type Identifier", "Units", "Developer Proceeds", "Begin Date", "End Date", "Customer Currency", "Country Code", "Currency of Proceeds", "Apple Identifier", "Customer Price", "Promo Code", "Parent Identifier", "Subscription", "Period"];
  const row = (sku, title, id, units) => ["APPLE", "US", sku, "Example", title, "2.1", "1", units, "0", date, date, "USD", "US", "USD", id, "0", " ", " ", " ", " "];
  // Studio Level's in-app purchase ("Pro"), matching its Analytics purchases report.
  const iap = (units, proceeds, price) => ["APPLE", "US", "STUDIO1.PRO", "Example", "Studio Level Pro", " ", "IA1", units, proceeds, date, date, "USD", "US", "USD", "5001", price, " ", "STUDIO1", " ", " "];
  const rows = [header, row("STUDIO1", "Studio Level", "1001", DAILY.salesUnits), row("CALM1", "Calm Notes", "1002", 1), row("ECHO1", "Echo Pad", "1003", ECHO_DAILY.salesUnits), iap(1, STUDIO_PURCHASE.proceeds, STUDIO_PURCHASE.price)];
  if (date === REFUND_DAY) rows.push(iap(-1, STUDIO_PURCHASE.proceeds, STUDIO_PURCHASE.price));
  if (date === PARTIAL_REFUND_DAY) rows.push(iap(0, -PARTIAL_REFUND, -1.43)); // Apple: zero units, negative proceeds
  return rows.map((r) => r.join("\t")).join("\n") + "\n";
}

const tsvOf = (header, rows) => [header.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
const appCols = (id) => [REPORTING[id].name, id];

/** Reports shown as Apple publishes them (Table viewer). One row per app per day keeps them small. */
const RAW_REPORTS = {
  "rep-engd": (date, id) => tsvOf(["Date", "App Name", "App Apple Identifier", "Event", "Page Type", "Source Type", "Source Info", "Campaign", "Page Title", "Territory", "Counts", "Unique Counts"],
    [[date, ...appCols(id), "Impression", "No page", "Web referrer", "example.com", "launch", "Default", "US", 5, 4]]),
  "rep-dld": (date, id) => tsvOf(["Date", "App Name", "App Apple Identifier", "Download Type", "App Version", "Device", "Platform Version", "Source Type", "Source Info", "Campaign", "Page Type", "Page Title", "Territory", "Counts"],
    [[date, ...appCols(id), "First-time download", "2.1", "iPhone", "iOS 26.0", "Web referrer", "example.com", "launch", "Product page", "Default", "US", 2]]),
  "rep-sessions": (date, id) => tsvOf(["Date", "App Name", "App Apple Identifier", "App Version", "Device", "Platform Version", "Source Type", "Territory", "Sessions", "Total Session Duration", "Unique Devices"],
    [[date, ...appCols(id), "2.1", "iPhone", "iOS 26.0", "App Store search", "US", 12, 3600, 5]]),
  "rep-installs": (date, id) => tsvOf(["Date", "App Name", "App Apple Identifier", "Event", "Download Type", "App Version", "Device", "Platform Version", "Source Type", "Territory", "Counts", "Unique Devices"],
    [[date, ...appCols(id), "Install", "First-time download", "2.1", "iPhone", "iOS 26.0", "App Store search", "US", 6, 6], [date, ...appCols(id), "Delete", "", "2.1", "iPhone", "iOS 26.0", "App Store search", "US", 2, 2]]),
  "rep-crashes": (date, id) => tsvOf(["Date", "App Name", "App Apple Identifier", "App Version", "Device", "Platform Version", "Crashes", "Unique Devices"],
    [[date, ...appCols(id), "2.1", "iPhone", "iOS 26.0", 1, 1]]),
};

/** Sales and Trends report types beyond SALES (vendor number). Studio Level has a monthly subscription. */
const SALES_TYPES = {
  "SUBSCRIPTION SUMMARY 1_3": () => tsvOf(["App Name", "App Apple ID", "Subscription Name", "Subscription Apple ID", "Customer Price", "Customer Currency", "Developer Proceeds", "Proceeds Currency", "Country", "Active Standard Price Subscriptions", "Active Free Trial Introductory Offer Subscriptions"],
    [["Studio Level", "1001", "Pro Monthly", "6001", 4.99, "USD", 3.49, "USD", "US", 20, 6], ["Calm Notes", "1002", "Calm Plus", "6002", 2.99, "USD", 2.09, "USD", "US", 3, 0]]),
  "SUBSCRIBER DETAILED 1_3": (date) => tsvOf(["Event Date", "App Name", "App Apple ID", "Subscription Name", "Customer Price", "Customer Currency", "Developer Proceeds", "Proceeds Currency", "Country", "Subscriber ID", "Units"],
    [[date, "Studio Level", "1001", "Pro Monthly", 4.99, "USD", 3.49, "USD", "US", `sub-${date}`, 1]]),
};

/** Studio Level's purchase and subscription reports (Analytics Reports, no vendor number needed). Echo Pad's are empty. */
function purchasesTsv(date, id) {
  const header = ["Date", "App Name", "App Apple Identifier", "Purchase Type", "Content Name", "Content Apple Identifier", "Payment Method", "Device", "Platform Version", "Source Type", "Page Type", "App Download Date", "Pre-Order", "Territory", "Purchases", "Proceeds in USD", "Sales in USD", "Paying Users"];
  if (id !== "1001") return header.join("\t") + "\n";
  const row = (territory, purchases, proceeds, sales) => [date, "Studio Level", "1001", "In-app purchases", "Pro", "5001", "Card", "iPhone", "iOS 26", "App Store search", "Product page", "", "", territory, purchases, proceeds, sales, 1].join("\t");
  const rows = [row("US", 1, STUDIO_PURCHASE.proceeds, STUDIO_PURCHASE.price)];
  if (date === REFUND_DAY) rows.push(row("CA", -1, -STUDIO_PURCHASE.proceeds, -STUDIO_PURCHASE.price));
  if (date === PARTIAL_REFUND_DAY) rows.push(row("GB", 0, -PARTIAL_REFUND, -1.43)); // a partial refund
  return [header.join("\t"), ...rows].join("\n") + "\n";
}

function subscriptionEventTsv(date, id) {
  const header = ["Event Date", "App Name", "App Apple Identifier", "Event Sub Type", "Event Grouping", "Subscription Name", "Subscription Identifier", "Offer Duration", "App Download Source Type", "Territory", "Counts"];
  // Echo Pad's only subscription event: one subscriber lost to a failed payment.
  if (id === "1003") return [header.join("\t"), ...(date === BILLING_CHURN_DAY ? [[date, "Echo Pad", "1003", "Involuntary Churn from Full Price", "Involuntary Churn", "Echo Plus", "6003", "", "App Store search", "US", 1].join("\t")] : [])].join("\n") + "\n";
  if (id !== "1001") return header.join("\t") + "\n";
  const row = (subType, grouping, counts, duration = "") => [date, "Studio Level", "1001", subType, grouping, "Pro Monthly", "6001", duration, "App Store search", "US", counts].join("\t");
  const rows = [row("Free Trial Starts", "Offer Starts", 2, "1 Week"), row("Full Price from Free Trial", "Paid Subscriptions from Offers", 1), row("Full Price Renewals", "Renewals", 1)];
  if (date === CHURN_DAY) rows.push(row("Voluntary Churn from Full Price", "Voluntary Churn", 1));
  return [header.join("\t"), ...rows].join("\n") + "\n";
}

function subscriptionStateTsv(date, id) {
  const header = ["Date", "App Name", "App Apple Identifier", "State Metric", "State Metric Grouping", "Subscription Name", "Subscription Identifier", "Territory", "Counts"];
  if (id !== "1001") return header.join("\t") + "\n";
  const row = (metric, grouping, counts) => [date, "Studio Level", "1001", metric, grouping, "Pro Monthly", "6001", "US", counts].join("\t");
  return [header.join("\t"), row("Free trials", "Subscription offers", 6), row("Full price", "Paid plans", 20)].join("\n") + "\n";
}

async function apple(req, res, url) {
  const activating = req.method === "POST" && url.pathname === "/v1/analyticsReportRequests" && authorized(req, ADMIN_KEY_ID);
  if (req.method === "GET" ? !(authorized(req) || authorized(req, ADMIN_KEY_ID)) : !activating) return error(res, 401, "NOT_AUTHORIZED", "Authentication credentials are missing or invalid.");
  const path = url.pathname;
  let m;
  if (path === "/v1/apps") return json(res, 200, page(APPS.map((a) => resource("apps", a.id, { name: a.name, bundleId: a.bundleId, sku: a.sku }))));
  if ((m = path.match(/^\/v1\/apps\/(\d+)$/))) {
    const app = APPS.find((a) => a.id === m[1]);
    return app ? json(res, 200, { data: resource("apps", app.id, { name: app.name }) }) : error(res, 404, "NOT_FOUND", "App not found.");
  }
  if (activating) {
    let body;
    try { body = JSON.parse(await readRequestBody(req)); } catch { return error(res, 400, "PARAMETER_ERROR.INVALID", "Expected one Analytics Reports request."); }
    const appId = body?.data?.relationships?.app?.data?.id;
    if (body?.data?.type !== "analyticsReportRequests" || body?.data?.attributes?.accessType !== "ONGOING" || !APPS.some((a) => a.id === appId)) {
      return error(res, 400, "PARAMETER_ERROR.INVALID", "Only an ongoing request for a known test app is supported.");
    }
    createdAnalyticsRequests.add(appId);
    res.writeHead(201, { "content-type": "application/json" });
    return res.end(JSON.stringify(resource("analyticsReportRequests", `req-${appId}`, { accessType: "ONGOING", stoppedDueToInactivity: false })));
  }
  if ((m = path.match(/^\/v1\/apps\/(\d+)\/appStoreVersions$/))) {
    const versions = m[1] === "1001" ? studioVersions() : m[1] === "1003" ? [["1.0", "READY_FOR_DISTRIBUTION", "3"]] : [["1.0", "PREPARE_FOR_SUBMISSION", null]];
    // Calm Notes answers with only the deprecated appStoreState, like an older account.
    const stateField = m[1] === "1002" ? "appStoreState" : "appVersionState";
    const withBuilds = url.searchParams.get("include") === "build";
    return json(res, 200, {
      ...page(versions.map(([v, state, build], i) => ({
        ...resource("appStoreVersions", `${m[1]}-v${i}`, { versionString: v, [stateField]: state, platform: "IOS" }),
        ...(withBuilds ? { relationships: { build: { data: build ? { type: "builds", id: `build-${m[1]}-${build}` } : null } } } : {}),
      }))),
      ...(withBuilds ? { included: versions.filter(([, , build]) => build).map(([, , build]) => resource("builds", `build-${m[1]}-${build}`, { version: build })) } : {}),
    });
  }
  if ((m = path.match(/^\/v1\/apps\/(\d+)\/analyticsReportRequests$/))) {
    return json(res, 200, page(REPORTING[m[1]] || createdAnalyticsRequests.has(m[1]) ? [resource("analyticsReportRequests", `req-${m[1]}`, { accessType: "ONGOING", stoppedDueToInactivity: false })] : []));
  }
  if ((m = path.match(/^\/v1\/analyticsReportRequests\/req-(\d+)\/reports$/))) {
    const suffix = m[1] === "1001" ? "" : `-${m[1]}`; // Studio Level keeps the original ids
    return json(res, 200, page([
      resource("analyticsReports", `rep-eng${suffix}`, { name: "App Store Discovery and Engagement Standard", category: "APP_STORE_ENGAGEMENT" }),
      resource("analyticsReports", `rep-dl${suffix}`, { name: "App Downloads Standard", category: "COMMERCE" }),
      resource("analyticsReports", `rep-sessions${suffix}`, { name: "App Sessions Standard", category: "APP_USAGE" }),
      resource("analyticsReports", `rep-engd${suffix}`, { name: "App Store Discovery and Engagement Detailed", category: "APP_STORE_ENGAGEMENT" }),
      resource("analyticsReports", `rep-dld${suffix}`, { name: "App Downloads Detailed", category: "COMMERCE" }),
      resource("analyticsReports", `rep-installs${suffix}`, { name: "App Store Installation and Deletion Standard", category: "APP_USAGE" }),
      resource("analyticsReports", `rep-crashes${suffix}`, { name: "App Crashes", category: "APP_USAGE" }),
      resource("analyticsReports", `rep-installperf${suffix}`, { name: "App Install Performance", category: "PERFORMANCE" }),
      resource("analyticsReports", `rep-pur${suffix}`, { name: "App Store Purchases Standard", category: "COMMERCE" }),
      resource("analyticsReports", `rep-sev${suffix}`, { name: "App Store Subscription Event Report Standard", category: "COMMERCE" }),
      resource("analyticsReports", `rep-sst${suffix}`, { name: "App Store Subscription State Report Standard", category: "COMMERCE" }),
    ]));
  }
  if ((m = path.match(/^\/v1\/analyticsReports\/(rep-[a-z]+)(?:-(\d+))?\/instances$/))) {
    const id = m[2] ?? "1001";
    if (!REPORTING[id]) return json(res, 200, page([])); // Newly enabled reports are not published immediately.
    if (m[1] === "rep-installperf") return json(res, 200, page([])); // not published for these apps
    return json(res, 200, page([
      ...ANALYTICS_DAYS.map((d) => resource("analyticsReportInstances", `${m[1]}~${id}~${d}`, { granularity: "DAILY", processingDate: d })),
      resource("analyticsReportInstances", `${m[1]}~${id}~weekly`, { granularity: "WEEKLY", processingDate: ANALYTICS_DAYS.at(-1) }),
      // A later instance that restates RESTATED_DAY without its Tap row: it must replace that day, not merge.
      ...(m[1] === "rep-eng" && id === "1001" ? [resource("analyticsReportInstances", `${m[1]}~${id}~restated`, { granularity: "DAILY", processingDate: isoDay(-1) })] : []),
    ]));
  }
  if ((m = path.match(/^\/v1\/analyticsReportInstances\/([^/]+)\/segments$/))) {
    return json(res, 200, page([resource("analyticsReportSegments", `${m[1]}-s1`, { url: `https://asp-e2e.s3.us-west-2.amazonaws.com/seg/${m[1]}?X-Amz-Signature=e2e` })]));
  }
  if (path === "/v1/salesReports") {
    if (url.searchParams.get("filter[vendorNumber]") !== VENDOR_NUMBER) return error(res, 400, "PARAMETER_ERROR.INVALID", "Invalid vendor number specified. Try again.");
    const date = url.searchParams.get("filter[reportDate]");
    if (!date || date >= isoDay(-1)) return error(res, 404, "NOT_FOUND", "Report is not available yet. Daily reports for the Americas are available by 5 am Pacific Time.");
    const type = url.searchParams.get("filter[reportType]");
    if (type !== "SALES") {
      const spec = `${type} ${url.searchParams.get("filter[reportSubType]")} ${url.searchParams.get("filter[version]")}`;
      if (SALES_TYPES[spec]) return gz(res, SALES_TYPES[spec](date));
      // Apple refuses report types an account has never had, with a misleading message.
      if (type === "SUBSCRIPTION_OFFER_CODE_REDEMPTION") return error(res, 400, "PARAMETER_ERROR.INVALID", "Invalid vendor number specified. Try again.");
      if (type === "WIN_BACK_ELIGIBILITY") return error(res, 404, "NOT_FOUND", "There were no sales for the date specified.");
      return error(res, 400, "PARAMETER_ERROR.INVALID", `Unsupported report ${spec}`);
    }
    // A 404 Apple doesn't explain: Peakly must show the day as unknown, not as zero sales.
    if (date === UNEXPLAINED_SALES_DAY) return error(res, 404, "NOT_FOUND", "The requested report could not be found.");
    return gz(res, salesTsv(date));
  }
  return error(res, 404, "NOT_FOUND", `No mock for ${path}`);
}

async function readRequestBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) throw new Error("Request body too large.");
  }
  return raw;
}

createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, accept, content-type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? "/", ORIGIN);
  if (url.pathname === "/health") { res.end("ok"); return; }
  if (url.pathname === "/__requests") return json(res, 200, requests);
  // Test control: ship Studio Level 2.2 now, or put it back in review.
  if (url.pathname === "/__release" && req.method === "POST") {
    studioShipped = url.searchParams.get("reset") ? null : { releasedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
    return json(res, 200, { studioShipped });
  }
  if (url.pathname === "/icon.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }

  const hostMatch = url.pathname.match(/^\/__host\/([^/]+)(\/.*)$/);
  if (!hostMatch) return error(res, 404, "NOT_FOUND", "Unknown path");
  const [, host, rest] = hostMatch;
  const inner = new URL(`${rest}${url.search}`, `https://${host}`);
  requests.push({ method: req.method, host, path: inner.pathname });
  if (req.method !== "GET" && !(req.method === "POST" && host === "api.appstoreconnect.apple.com" && rest === "/v1/analyticsReportRequests")) {
    return error(res, 405, "METHOD_NOT_ALLOWED", "Only an explicitly approved Analytics Reports request is supported.");
  }

  if (host === "api.appstoreconnect.apple.com") return apple(req, res, inner);
  if (host === "itunes.apple.com" && inner.pathname === "/lookup") {
    const ids = (inner.searchParams.get("id") ?? "").split(",");
    return json(res, 200, { resultCount: 1, results: ids.includes("1001") ? [{ trackId: 1001, artworkUrl100: `${ORIGIN}/icon.png`, version: studioShipped ? "2.2" : "2.1", currentVersionReleaseDate: studioShipped?.releasedAt ?? STUDIO_RELEASED_AT }] : [] });
  }
  if (host.endsWith(".amazonaws.com") && inner.pathname.startsWith("/seg/")) {
    const instance = decodeURIComponent(inner.pathname.slice(5));
    const [report, id, date] = instance.split("~");
    if (date === "weekly") return gz(res, "Date\tCounts\n");
    if (date === "restated") return gz(res, engagementTsv(RESTATED_DAY, id, { withTaps: false }));
    const tsv = { "rep-eng": engagementTsv, "rep-dl": downloadsTsv, "rep-pur": purchasesTsv, "rep-sev": subscriptionEventTsv, "rep-sst": subscriptionStateTsv, ...RAW_REPORTS }[report];
    return gz(res, tsv(date, id));
  }
  return error(res, 404, "NOT_FOUND", `No mock for ${host}${inner.pathname}`);
}).listen(PORT, "127.0.0.1", () => console.log(`mock Apple listening on ${ORIGIN}`));
