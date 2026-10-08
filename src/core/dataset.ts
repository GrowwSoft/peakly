import type { AppDataset, AppRelease, AppSummary, DailyRevenue, DailySales, DailySourceOutcome, ReportCoverage } from "@/core/insights/types";
import { addDays, datesBetween, isoDate } from "@/core/insights/metrics";
import { AscError, createAscClient, type AscClient, type AscResource } from "./asc/client";
import { compactRows, dedupeNewest, DOWNLOADS_REPORT, ENGAGEMENT_REPORT, INSTALLS_REPORT, REVENUE_REPORTS, SUBSCRIPTION_EVENT_REPORT, toDailyMetrics, toDailyOutcomes, toDailyRevenue, type CompactRow } from "./asc/normalize";
import { salesForApp } from "./asc/sales";
import { parseTsv } from "./asc/tsv";
import { gunzipText } from "./asc/gzip";
import { type AscAuth, type Platform } from "./platform";
import { keyPart, pool, readCache, writeCache } from "./cache";
import { recordRelease, releaseTable, type ObservedVersion, type ReleaseRecord } from "./releases";

// ---------- Apps ----------

interface AppAttributes { name: string; bundleId: string; sku: string }
interface LookupResult { trackId: number; artworkUrl100?: string; version?: string; currentVersionReleaseDate?: string }

/** Public App Store lookup (no credentials): icons and the current version's exact release time. */
async function lookup(platform: Platform, ids: string[]): Promise<Map<string, LookupResult>> {
  if (ids.length === 0) return new Map();
  try {
    const res = await platform.fetch(`https://itunes.apple.com/lookup?id=${ids.join(",")}&country=us`, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { results?: LookupResult[] };
    return new Map((body.results ?? []).map((r) => [String(r.trackId), r]));
  } catch {
    return new Map();
  }
}

export async function listApps(platform: Platform, auth: AscAuth): Promise<AppSummary[]> {
  const client = createAscClient(auth, platform.fetch);
  const apps = await client.all<AscResource<AppAttributes>>("/v1/apps?fields[apps]=name,bundleId,sku&limit=200");
  const icons = await lookup(platform, apps.map((a) => a.id));
  return apps
    .map((a) => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId, sku: a.attributes.sku ?? "", iconUrl: icons.get(a.id)?.artworkUrl100 ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type VersionResource = AscResource<{ versionString: string; appVersionState?: string; appStoreState?: string; platform: string }> & { relationships?: { build?: { data?: { id: string } | null } } };

/** App Store versions with the build each one carries. Builds need a role that can read them; without it they're left unknown. */
async function appStoreVersions(client: AscClient, appId: string): Promise<ObservedVersion[]> {
  // appVersionState replaces the deprecated appStoreState; both are requested so older accounts still work.
  const base = `/v1/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString,appVersionState,appStoreState,platform,build&limit=50`;
  let versions: VersionResource[];
  let builds = new Map<string, string>();
  try {
    const page = await client.json<{ data: VersionResource[]; included?: AscResource<{ version: string }>[] }>(`${base}&include=build&fields[builds]=version`);
    versions = page.data;
    builds = new Map((page.included ?? []).map((b) => [b.id, b.attributes.version]));
  } catch (error) {
    if (!(error instanceof AscError) || error.status !== 403) throw error;
    versions = await client.all<VersionResource>(base.replace(",build", ""), 2);
  }
  return versions
    .filter((v) => v.attributes.platform === "IOS")
    .map((v) => ({ version: v.attributes.versionString, state: v.attributes.appVersionState ?? v.attributes.appStoreState ?? "", build: builds.get(v.relationships?.build?.data?.id ?? "") ?? null }));
}

/** Versions with their release times, keeping the history Apple's lookup forgets once a newer version ships. */
async function releases(platform: Platform, client: AscClient, appId: string): Promise<AppRelease[]> {
  const [versions, current] = await Promise.all([appStoreVersions(client, appId), lookup(platform, [appId]).then((m) => m.get(appId))]);
  const key = `releases/${keyPart(appId)}.json`;
  const history = (await readCache<ReleaseRecord[]>(platform, key)) ?? [];
  const next = recordRelease(history, current?.version ? { version: current.version, releasedAt: current.currentVersionReleaseDate ?? null } : null, versions);
  if (JSON.stringify(next) !== JSON.stringify(history)) await writeCache(platform, key, next);
  return releaseTable(next, versions);
}

// ---------- Sales ----------

type SalesFile = { status: "available"; tsv: string } | { status: "no_sales" };

async function salesDay(platform: Platform, client: AscClient, vendor: string, date: string): Promise<SalesFile | { status: "pending" | "unavailable" }> {
  const key = `sales/${keyPart(vendor)}/${date}.json`;
  const cached = await readCache<SalesFile>(platform, key);
  if (cached) return cached;
  const result = await client.salesReport(date);
  if (result.status === "pending" || result.status === "unavailable") return result; // not cached: may change
  const value: SalesFile = result.status === "available"
    ? { status: "available", tsv: await gunzipText(result.gz) }
    : { status: "no_sales" };
  await writeCache(platform, key, value); // published reports are immutable
  return value;
}

async function sales(platform: Platform, client: AscClient, vendorNumber: string, app: AppSummary, start: string, end: string) {
  const days = datesBetween(start, end);
  const files = await pool(days, 4, (date) => salesDay(platform, client, vendorNumber, date));
  return days.map((date, i): DailySales => {
    const file = files[i]!;
    if (file.status === "available") return salesForApp(date, file.tsv, app);
    return { date, status: file.status, appUnits: 0, updateUnits: 0, redownloadUnits: 0, paidUnits: 0, proceeds: {}, refunds: 0 };
  });
}

// ---------- Analytics Reports ----------

interface InstanceAttributes { granularity: string; processingDate?: string; reportingDate?: string }

async function instanceRows(platform: Platform, client: AscClient, report: string, instanceId: string): Promise<CompactRow[]> {
  // v2: rows keep unique counts. v3: subscription events keep the offer duration and download source.
  const version = report === SUBSCRIPTION_EVENT_REPORT || report === INSTALLS_REPORT ? "v3" : "v2";
  const key = `analytics-${version}/${keyPart(instanceId)}.json`;
  const cached = await readCache<CompactRow[]>(platform, key);
  if (cached) return cached;
  const segments = await client.all<AscResource<{ url: string }>>(`/v1/analyticsReportInstances/${instanceId}/segments`);
  const rows: CompactRow[] = [];
  for (const segment of segments) {
    const text = await gunzipText(await client.download(segment.attributes.url));
    rows.push(...compactRows(report, parseTsv(text).rows));
  }
  await writeCache(platform, key, rows);
  return rows;
}

async function analytics(platform: Platform, client: AscClient, appId: string, since: string) {
  const requests = await client.all<AscResource<{ accessType: string; stoppedDueToInactivity?: boolean }>>(`/v1/apps/${appId}/analyticsReportRequests`);
  const ongoing = requests.find((r) => r.attributes.accessType === "ONGOING" && !r.attributes.stoppedDueToInactivity);
  if (!ongoing) return { status: "not_enabled" as const };

  const reports = await client.all<AscResource<{ name: string }>>(`/v1/analyticsReportRequests/${ongoing.id}/reports`, 20);
  const wanted = [ENGAGEMENT_REPORT, DOWNLOADS_REPORT];
  const covered: Record<string, Set<string>> = {};
  const instances: { processingDate: string; rows: CompactRow[] }[] = [];
  let reportsPublished = true;

  for (const name of wanted) {
    covered[name] = new Set();
    const report = reports.find((r) => r.attributes.name === name);
    if (!report) { reportsPublished = false; continue; }
    const all = await client.all<AscResource<InstanceAttributes>>(`/v1/analyticsReports/${report.id}/instances?limit=200`, 20);
    const daily = all
      .filter((i) => i.attributes.granularity === "DAILY")
      .map((i) => ({ id: i.id, date: (i.attributes.processingDate ?? i.attributes.reportingDate ?? "").slice(0, 10) }))
      .filter((i) => i.date >= since);
    if (!all.some((i) => i.attributes.granularity === "DAILY")) reportsPublished = false;
    const loaded = await pool(daily, 4, async (i) => ({ processingDate: i.date, rows: await instanceRows(platform, client, name, i.id) }));
    const rowDates: string[] = [];
    for (const instance of loaded) {
      instances.push(instance);
      for (const row of instance.rows) rowDates.push(row.date);
    }
    // Apple omits empty days, so a quiet day inside the observed range is a real zero.
    // Days before the first or after the last observed row stay unknown.
    rowDates.sort();
    if (rowDates.length) for (const d of datesBetween(rowDates[0]!, rowDates.at(-1)!)) covered[name]!.add(d);
  }
  if (!reportsPublished) return { status: "waiting" as const };
  const both = new Set([...covered[ENGAGEMENT_REPORT]!].filter((d) => covered[DOWNLOADS_REPORT]!.has(d) && d >= since));
  const metrics = toDailyMetrics(dedupeNewest(instances), both);
  const sorted = [...both].sort();
  const revenue = await revenueReports(platform, client, reports, since);
  const usage = await dailyReport(platform, client, reports, INSTALLS_REPORT, since);
  const outcomes = revenue || usage
    ? toDailyOutcomes([...(revenue?.rows ?? []), ...(usage?.rows ?? [])], usage?.dates ?? new Set(), revenue?.dates ?? new Set())
    : null;
  return { status: "observed" as const, metrics, from: sorted[0] ?? null, through: sorted.at(-1) ?? null, revenue: revenue?.days ?? null, outcomes };
}

/**
 * Purchases and subscriptions from the same Analytics Reports request. Purchases often have
 * no rows at all, so a day counts as known when every revenue report published an instance for it.
 */
async function revenueReports(platform: Platform, client: AscClient, reports: AscResource<{ name: string }>[], since: string): Promise<{ days: DailyRevenue[]; rows: CompactRow[]; dates: Set<string> } | null> {
  const loaded: { rows: CompactRow[]; dates: Set<string> }[] = [];
  for (const name of REVENUE_REPORTS) {
    const report = await dailyReport(platform, client, reports, name, since);
    if (report) loaded.push(report);
  }
  if (loaded.length === 0) return null;
  const dates = loaded.map((r) => r.dates).reduce((a, b) => new Set([...a].filter((d) => b.has(d))));
  const rows = loaded.flatMap((r) => r.rows);
  return { days: toDailyRevenue(rows, dates), rows, dates };
}

/** One report's daily instances since `since`: the newest rows per day, and the days it was published for. */
async function dailyReport(platform: Platform, client: AscClient, reports: AscResource<{ name: string }>[], name: string, since: string): Promise<{ rows: CompactRow[]; dates: Set<string> } | null> {
  const report = reports.find((r) => r.attributes.name === name);
  if (!report) return null;
  const all = await client.all<AscResource<InstanceAttributes>>(`/v1/analyticsReports/${report.id}/instances?limit=200`, 20);
  const daily = all
    .filter((i) => i.attributes.granularity === "DAILY")
    .map((i) => ({ id: i.id, date: (i.attributes.processingDate ?? i.attributes.reportingDate ?? "").slice(0, 10) }))
    .filter((i) => i.date >= since);
  const loaded = await pool(daily, 4, async (i) => ({ processingDate: i.date, rows: await instanceRows(platform, client, name, i.id) }));
  return { rows: dedupeNewest(loaded), dates: new Set<string>(loaded.map((i) => i.processingDate)) };
}

// ---------- Dataset ----------

// ---------- When to ask Apple again ----------

/** Apple says the previous day's sales reports are generally available by 8 am Pacific: 15:00 UTC in summer, 16:00 in winter. */
const PUBLISH_HOUR_UTC = 16;
/** How often to look again while Apple is late with a day it should have published. */
const LATE_RECHECK_MS = 3 * 3_600_000;

/**
 * Apple publishes new data about once a day, so a finished dataset is kept until Apple
 * could have something new: the next daily publish, or a few hours if Apple is behind
 * (store analytics more than two days old, or a sales day that should be out by now).
 */
export function nextCheckAt(dataset: AppDataset, checkedAt: number): number {
  const publish = new Date(checkedAt);
  publish.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
  if (publish.getTime() <= checkedAt) publish.setUTCDate(publish.getUTCDate() + 1);
  const today = isoDate(checkedAt);
  const published = new Date(checkedAt).getUTCHours() >= PUBLISH_HOUR_UTC;
  const behind =
    dataset.coverage.analytics === "pending"
    || (dataset.coverage.analytics === "observed" && (dataset.coverage.analyticsThrough ?? "") < addDays(today, -2))
    || dataset.sales.some((d) => d.status === "unavailable")
    || dataset.coverage.salesPendingDates.some((d) => d < addDays(today, published ? -1 : -2) || (published && d === addDays(today, -1)));
  return behind ? Math.min(publish.getTime(), checkedAt + LATE_RECHECK_MS) : publish.getTime();
}

export interface StoredDataset {
  dataset: AppDataset;
  /** When Apple was last asked. */
  checkedAt: number;
  /** When asking again could find something new. */
  nextCheckAt: number;
}

const datasetKey = (auth: AscAuth, app: AppSummary, days: number) => `dataset-v3/${keyPart(auth.vendorNumber || "none")}/${keyPart(app.id)}-${days}.json`;

/** The last finished dataset saved on this computer, if any. Reads only the local cache: no network, no key. */
export async function storedDataset(platform: Platform, auth: AscAuth, app: AppSummary, days: number): Promise<StoredDataset | null> {
  const stored = await readCache<StoredDataset>(platform, datasetKey(auth, app, days));
  return stored?.dataset && typeof stored.nextCheckAt === "number" ? stored : null;
}

export const isDue = (stored: StoredDataset, now = Date.now()) => now >= stored.nextCheckAt;

/** Ask Apple now and save the result. Individual reports already downloaded are never fetched again. */
export async function refreshDataset(platform: Platform, auth: AscAuth, app: AppSummary, days: number): Promise<StoredDataset> {
  const checkedAt = Date.now();
  const dataset = await buildFreshDataset(platform, auth, app, days);
  const stored: StoredDataset = { dataset, checkedAt, nextCheckAt: nextCheckAt(dataset, checkedAt) };
  // Answers are kept, including "analytics not enabled" or "waiting for Apple". A failure must be retried, not remembered.
  if (dataset.coverage.analytics !== "error" && dataset.coverage.sales !== "error") {
    try { await writeCache(platform, datasetKey(auth, app, days), stored); } catch { /* caching is best effort */ }
  }
  return stored;
}

/**
 * Everything the dashboard needs for one app: current + previous window of `days`.
 * Uses the saved dataset until Apple could have published something new; `refresh` asks now.
 */
export async function buildDataset(platform: Platform, auth: AscAuth, app: AppSummary, days: number, options: { refresh?: boolean } = {}): Promise<StoredDataset> {
  if (!options.refresh) {
    const stored = await storedDataset(platform, auth, app, days);
    if (stored && !isDue(stored)) return stored;
  }
  return refreshDataset(platform, auth, app, days);
}

async function buildFreshDataset(platform: Platform, auth: AscAuth, app: AppSummary, days: number): Promise<AppDataset> {
  const client = createAscClient(auth, platform.fetch);
  const yesterday = isoDate(Date.now() - 86_400_000);
  const since = addDays(yesterday, -(days * 2 + 3));

  const coverage: ReportCoverage = { analytics: "unavailable", analyticsThrough: null, sales: "unavailable", salesPendingDates: [] };
  const describe = (e: unknown) => e instanceof AscError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : typeof e === "string" ? e : "Request failed.";

  const [analyticsResult, salesResult, releaseResult] = await Promise.allSettled([
    analytics(platform, client, app.id, since),
    auth.vendorNumber ? sales(platform, client, auth.vendorNumber, app, since, yesterday) : Promise.resolve(null),
    releases(platform, client, app.id),
  ]);

  let metrics: AppDataset["metrics"] = [];
  let revenue: DailyRevenue[] = [];
  let outcomes: DailySourceOutcome[] = [];
  if (analyticsResult.status === "fulfilled") {
    if (analyticsResult.value.status === "observed") {
      coverage.analytics = "observed";
      coverage.analyticsFrom = analyticsResult.value.from;
      coverage.analyticsThrough = analyticsResult.value.through;
      metrics = analyticsResult.value.metrics;
      revenue = analyticsResult.value.revenue ?? [];
      outcomes = analyticsResult.value.outcomes ?? [];
      coverage.revenue = analyticsResult.value.revenue ? "observed" : "unavailable";
      coverage.revenueThrough = revenue.at(-1)?.date ?? null;
    } else if (analyticsResult.value.status === "waiting") {
      coverage.analytics = "pending";
      coverage.analyticsDetail = "Analytics is enabled. Apple usually needs 24–48 hours to publish the first reports.";
    } else {
      coverage.analytics = "not_enabled";
      coverage.analyticsDetail = "No ongoing Analytics Reports request exists for this app. Impressions, page views and sources come from those reports.";
    }
  } else {
    coverage.analytics = "error";
    coverage.analyticsDetail = describe(analyticsResult.reason);
  }

  let salesDays: DailySales[] = [];
  if (salesResult.status === "fulfilled") {
    if (salesResult.value === null) {
      coverage.sales = "unavailable";
      coverage.salesDetail = "Add a vendor number in Settings to see download units and sales.";
    } else {
      coverage.sales = "observed";
      salesDays = salesResult.value;
      coverage.salesPendingDates = salesDays.filter((d) => d.status === "pending").map((d) => d.date);
    }
  } else {
    coverage.sales = "error";
    coverage.salesDetail = describe(salesResult.reason);
  }

  return {
    app, generatedAt: new Date().toISOString(), metrics, sales: salesDays, revenue, outcomes, coverage, demo: false,
    releases: releaseResult.status === "fulfilled" ? releaseResult.value : [],
  };
}
