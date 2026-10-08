import { addDays, datesBetween, isoDate } from "./insights/metrics";
import type { AppSummary } from "./insights/types";
import { AscError, createAscClient, type AscClient, type AscResource } from "./asc/client";
import { gunzipText } from "./asc/gzip";
import { parseTsv, toNumber } from "./asc/tsv";
import { keyPart, pool, readCache, writeCache } from "./cache";
import type { ExplorerColumn, ExplorerTable, Provider } from "./explorer";
import type { AscAuth, Platform } from "./platform";

/**
 * Report tables shown as Apple publishes them, one per type of data not already in the
 * built-in tables. Loaded only when opened (some are large), for the selected range, and
 * cached like every other report. Duplicates of other tables are left out on purpose:
 * the Sales "Subscription Event" and "Pre-Order" reports repeat Analytics Reports data.
 */
export type ReportTableSpec =
  | { id: string; title: string; kind: "analytics"; report: string }
  | { id: string; title: string; kind: "sales"; reportType: string; reportSubType: string; version: string };

export const REPORT_TABLES: ReportTableSpec[] = [
  { id: "discovery-detail", title: "Discovery detail", kind: "analytics", report: "App Store Discovery and Engagement Detailed" },
  { id: "download-detail", title: "Download detail", kind: "analytics", report: "App Downloads Detailed" },
  { id: "sessions", title: "Sessions", kind: "analytics", report: "App Sessions Standard" },
  { id: "installs", title: "Installs and deletions", kind: "analytics", report: "App Store Installation and Deletion Standard" },
  { id: "crashes", title: "Crashes", kind: "analytics", report: "App Crashes" },
  { id: "install-performance", title: "Install performance", kind: "analytics", report: "App Install Performance" },
  { id: "subscriptions", title: "Subscriptions (sales)", kind: "sales", reportType: "SUBSCRIPTION", reportSubType: "SUMMARY", version: "1_3" },
  { id: "subscribers", title: "Subscribers", kind: "sales", reportType: "SUBSCRIBER", reportSubType: "DETAILED", version: "1_3" },
  { id: "offer-codes", title: "Offer code redemptions", kind: "sales", reportType: "SUBSCRIPTION_OFFER_CODE_REDEMPTION", reportSubType: "SUMMARY", version: "1_0" },
  { id: "win-back", title: "Win-back eligibility", kind: "sales", reportType: "WIN_BACK_ELIGIBILITY", reportSubType: "SUMMARY", version: "1_0" },
];

export const reportTableCall = (spec: ReportTableSpec) => spec.kind === "analytics"
  ? `Analytics Reports: ${spec.report} (daily)`
  : `GET /v1/salesReports ${spec.reportType} ${spec.reportSubType} ${spec.version} (daily)`;

export const reportTableProvider = (spec: ReportTableSpec): Provider => (spec.kind === "analytics" ? "asc" : "vendor");

/** The tabs for these tables, before anything is loaded. */
export const REPORT_TABS = REPORT_TABLES.map((spec) => ({ id: spec.id, title: spec.title, call: reportTableCall(spec), provider: reportTableProvider(spec) }));

/** The most rows a table shows, newest first. */
export const ROW_LIMIT = 1000;

const APP_ID_COLUMNS = ["App Apple Identifier", "Apple Identifier", "App Apple ID"];
const APP_NAME_COLUMNS = ["App Name", "Title"];
const DATE_COLUMNS = ["Date", "Event Date", "Begin Date"];
type Row = Record<string, string>;

/** Load one report table for one app, or for several apps combined (with an App column). */
export async function loadReportTable(platform: Platform, auth: AscAuth, apps: AppSummary[], spec: ReportTableSpec, days: number): Promise<ExplorerTable> {
  const client = createAscClient(auth, platform.fetch);
  const end = isoDate(Date.now() - 86_400_000);
  const since = addDays(end, -(days - 1));
  const base = { id: spec.id, title: spec.title, call: reportTableCall(spec) };
  const provider = reportTableProvider(spec);
  if (spec.kind === "sales" && !auth.vendorNumber) return { ...base, columns: [], rows: [], unavailable: "Add a vendor number in Settings to read Sales reports." };

  const perApp: { app: AppSummary; rows: Row[]; problem?: string }[] = [];
  if (spec.kind === "analytics") {
    for (const app of apps) perApp.push({ app, ...(await analyticsRows(platform, client, app, spec.report, since)) });
  } else {
    const { rows, problem } = await salesRows(platform, client, auth.vendorNumber, spec, since, end);
    for (const app of apps) perApp.push({ app, rows: rows.filter((r) => belongsTo(r, app)), ...(problem ? { problem } : {}) });
  }

  const rows = perApp.flatMap(({ app, rows: r }) => r.map((row) => (apps.length > 1 ? { App: app.name, ...row } : row)));
  const problems = [...new Set(perApp.filter((p) => p.problem).map((p) => (apps.length > 1 && spec.kind === "analytics" ? `${p.app.name}: ${p.problem}` : p.problem!)))];
  if (rows.length === 0) {
    return { ...base, columns: [], rows: [], unavailable: problems.length ? problems.join(" ") : `No rows for the last ${days} days.` };
  }

  const hidden = new Set([...APP_ID_COLUMNS, ...APP_NAME_COLUMNS]); // shown once, as the App column when combined
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((n) => !hidden.has(n));
  const dateColumn = names.find((n) => DATE_COLUMNS.includes(n));
  rows.sort((a, b) => (dateColumn ? (b[dateColumn] ?? "").localeCompare(a[dateColumn] ?? "") : 0));
  const shown = rows.slice(0, ROW_LIMIT);
  const columns: ExplorerColumn[] = names.map((name) => ({
    key: name, label: name, provider,
    numeric: name !== dateColumn && shown.every((r) => r[name] === undefined || r[name] === "" || toNumber(r[name]) !== null),
  }));
  return {
    ...base,
    columns,
    rows: shown.map((r) => Object.fromEntries(names.map((n) => [n, r[n] === undefined || r[n] === "" ? null : r[n]!]))),
    ...(rows.length > ROW_LIMIT || problems.length ? { note: [
      ...(rows.length > ROW_LIMIT ? [`Showing the newest ${ROW_LIMIT.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows.`] : []),
      ...problems,
    ].join(" ") } : {}),
  };
}

/** A sales report row belongs to an app when it names the app's Apple ID, or the app's SKU as its parent. */
function belongsTo(row: Row, app: AppSummary): boolean {
  const ids = APP_ID_COLUMNS.filter((c) => row[c] !== undefined);
  if (ids.some((c) => row[c] === app.id)) return true;
  if (app.sku && row["Parent Identifier"] === app.sku) return true;
  return ids.length === 0 && row["Parent Identifier"] === undefined; // account-wide report with no app column
}

interface InstanceAttributes { granularity: string; processingDate?: string }

async function analyticsRows(platform: Platform, client: AscClient, app: AppSummary, reportName: string, since: string): Promise<{ rows: Row[]; problem?: string }> {
  const requests = await client.all<AscResource<{ accessType: string; stoppedDueToInactivity?: boolean }>>(`/v1/apps/${app.id}/analyticsReportRequests`);
  const ongoing = requests.find((r) => r.attributes.accessType === "ONGOING" && !r.attributes.stoppedDueToInactivity);
  if (!ongoing) return { rows: [], problem: "Analytics Reports aren't enabled for this app." };
  const reports = await client.all<AscResource<{ name: string }>>(`/v1/analyticsReportRequests/${ongoing.id}/reports`, 20);
  const report = reports.find((r) => r.attributes.name === reportName);
  if (!report) return { rows: [], problem: "Apple doesn't offer this report for this app." };
  const instances = (await client.all<AscResource<InstanceAttributes>>(`/v1/analyticsReports/${report.id}/instances?limit=200`, 20))
    .filter((i) => i.attributes.granularity === "DAILY")
    .map((i) => ({ id: i.id, date: (i.attributes.processingDate ?? "").slice(0, 10) }))
    .filter((i) => i.date >= since);
  if (instances.length === 0) return { rows: [], problem: "Apple hasn't published this report for these days." };
  const loaded = await pool(instances, 4, async (i) => ({ processingDate: i.date, rows: await rawInstanceRows(platform, client, i.id) }));
  return { rows: newestPerDay(loaded) };
}

/** Every row of one report instance, all columns kept. Published instances don't change, so they're cached. */
async function rawInstanceRows(platform: Platform, client: AscClient, instanceId: string): Promise<Row[]> {
  const key = `report-rows/${keyPart(instanceId)}.json`;
  const cached = await readCache<Row[]>(platform, key);
  if (cached) return cached;
  const segments = await client.all<AscResource<{ url: string }>>(`/v1/analyticsReportInstances/${instanceId}/segments`);
  const rows: Row[] = [];
  for (const segment of segments) rows.push(...parseTsv(await gunzipText(await client.download(segment.attributes.url))).rows);
  await writeCache(platform, key, rows);
  return rows;
}

/** Apple restates days in later instances: for each day, the newest instance's rows replace older ones. */
function newestPerDay(instances: { processingDate: string; rows: Row[] }[]): Row[] {
  const dateOf = (r: Row) => DATE_COLUMNS.map((c) => r[c]).find(Boolean) ?? "";
  const newest = new Map<string, string>();
  for (const i of instances) for (const r of i.rows) if ((newest.get(dateOf(r)) ?? "") < i.processingDate) newest.set(dateOf(r), i.processingDate);
  return instances.flatMap((i) => i.rows.filter((r) => newest.get(dateOf(r)) === i.processingDate));
}

type SalesFile = { status: "available"; tsv: string } | { status: "no_sales" };

async function salesRows(platform: Platform, client: AscClient, vendor: string, spec: Extract<ReportTableSpec, { kind: "sales" }>, since: string, end: string): Promise<{ rows: Row[]; problem?: string }> {
  let refused: string | null = null;
  const files = await pool(datesBetween(since, end), 4, async (date) => {
    const key = `sales-report/${spec.reportType}/${keyPart(vendor)}/${date}.json`;
    const cached = await readCache<SalesFile>(platform, key);
    if (cached) return cached;
    let result;
    try {
      result = await client.salesReportFile(spec, date);
    } catch (e) {
      // Apple refuses report types the account has never had (e.g. "Invalid vendor number" for subscriptions).
      if (e instanceof AscError && e.status < 500) { refused = e.message; return null; }
      throw e;
    }
    if (result.status === "pending" || result.status === "unavailable") return null;
    const file: SalesFile = result.status === "available" ? { status: "available", tsv: await gunzipText(result.gz) } : { status: "no_sales" };
    await writeCache(platform, key, file);
    return file;
  });
  const rows = files.flatMap((f) => (f?.status === "available" ? parseTsv(f.tsv).rows : []));
  return { rows, ...(refused && rows.length === 0 ? { problem: `Apple didn't return this report: ${refused}` } : {}) };
}
