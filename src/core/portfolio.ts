import { buildDataset, storedDataset, type StoredDataset } from "./dataset";
import type { AppDataset, AppSummary, DailyRevenue, DailySales, ReportCoverage } from "./insights/types";
import type { AscAuth, Platform } from "./platform";
import { ALL_APPS_SUMMARY } from "./all-apps";

export { ALL_APPS, ALL_APPS_SUMMARY } from "./all-apps";


/**
 * Every app's dataset combined into one. Counts are added up, so rates such as page
 * conversion come from the combined counts (a weighted figure), never an average of
 * each app's rate. Store analytics only cover days every reporting app has published:
 * a day one app hasn't published yet is unknown for the whole account, not zero.
 */
export function combineDatasets(datasets: AppDataset[]): AppDataset {
  const observed = datasets.filter((d) => d.coverage.analytics === "observed");
  const from = observed.map((d) => d.coverage.analyticsFrom).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const through = observed.map((d) => d.coverage.analyticsThrough).filter((d): d is string => Boolean(d)).sort()[0] ?? null;

  const statusOrder: ReportCoverage["analytics"][] = ["observed", "pending", "not_enabled", "error", "unavailable"];
  const analytics = statusOrder.find((s) => datasets.some((d) => d.coverage.analytics === s)) ?? "unavailable";
  const salesStates = datasets.map((d) => d.coverage.sales);
  const sales: ReportCoverage["sales"] = salesStates.includes("error") ? "error" : salesStates.includes("observed") ? "observed" : "unavailable";

  const coverage: ReportCoverage = {
    analytics,
    analyticsFrom: from,
    analyticsThrough: through,
    analyticsDetail: analytics === "observed" ? undefined : datasets.find((d) => d.coverage.analytics === analytics)?.coverage.analyticsDetail,
    sales,
    salesDetail: datasets.find((d) => d.coverage.sales === sales)?.coverage.salesDetail,
    salesPendingDates: [...new Set(datasets.flatMap((d) => d.coverage.salesPendingDates))].sort(),
    revenue: datasets.some((d) => d.coverage.revenue === "observed") ? "observed" : "unavailable",
    revenueThrough: datasets.map((d) => d.coverage.revenueThrough).filter((d): d is string => Boolean(d)).sort()[0] ?? null,
    excludedApps: datasets.filter((d) => d.coverage.analytics !== "observed").map((d) => ({ name: d.app.name, reason: d.coverage.analytics })),
  };

  return {
    app: ALL_APPS_SUMMARY,
    generatedAt: datasets.map((d) => d.generatedAt).sort()[0] ?? new Date(0).toISOString(),
    metrics: observed.flatMap((d) => d.metrics
      .filter((m) => (!from || m.date >= from) && (!through || m.date <= through))
      .map((m) => ({ ...m, app: d.app.name }))),
    sales: combineSales(datasets.map((d) => d.sales)),
    revenue: combineRevenue(datasets.map((d) => d.revenue ?? [])),
    // Per-source rows simply add up across apps.
    outcomes: datasets.flatMap((d) => d.outcomes ?? []),
    releases: datasets.flatMap((d) => d.releases.map((r) => ({ ...r, app: d.app.name }))),
    coverage,
    demo: false,
    members: datasets.map((d) => d.app),
  };
}

/** Purchases and subscriptions added up per day. Only days every reporting app published are kept. */
function combineRevenue(perApp: DailyRevenue[][]): DailyRevenue[] {
  const reporting = perApp.filter((days) => days.length > 0);
  if (reporting.length === 0) return [];
  const shared = reporting.map((days) => new Set(days.map((d) => d.date))).reduce((a, b) => new Set([...a].filter((d) => b.has(d))));
  const byDate = new Map<string, DailyRevenue>();
  for (const day of reporting.flat()) {
    if (!shared.has(day.date)) continue;
    const into = byDate.get(day.date);
    if (!into) { byDate.set(day.date, { ...day }); continue; }
    for (const key of ["purchases", "refunds", "proceedsUsd", "trialStarts", "offerConversions", "paidStarts", "renewals", "churned", "voluntaryChurn", "involuntaryChurn"] as const) into[key] += day[key];
    if (into.trialDays !== day.trialDays) into.trialDays = into.trialDays ?? day.trialDays;
    into.proceedsUsd = Math.round(into.proceedsUsd * 100) / 100;
    if (day.activePaid !== null) into.activePaid = (into.activePaid ?? 0) + day.activePaid;
    if (day.activeTrials !== null) into.activeTrials = (into.activeTrials ?? 0) + day.activeTrials;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** One row per day across apps. A day is pending while any app's report for it is. */
function combineSales(perApp: DailySales[][]): DailySales[] {
  const byDate = new Map<string, DailySales>();
  for (const day of perApp.flat()) {
    const into = byDate.get(day.date);
    if (!into) { byDate.set(day.date, { ...day, proceeds: { ...day.proceeds } }); continue; }
    const either = (s: DailySales["status"]) => into.status === s || day.status === s;
    into.status = either("unavailable") ? "unavailable" : either("pending") ? "pending" : either("available") ? "available" : "no_sales";
    into.appUnits += day.appUnits;
    into.updateUnits += day.updateUnits;
    into.redownloadUnits += day.redownloadUnits;
    into.paidUnits += day.paidUnits;
    into.refunds += day.refunds;
    for (const [currency, amount] of Object.entries(day.proceeds)) into.proceeds[currency] = (into.proceeds[currency] ?? 0) + amount;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const combineStored = (stored: StoredDataset[]): StoredDataset => ({
  dataset: combineDatasets(stored.map((s) => s.dataset)),
  checkedAt: Math.min(...stored.map((s) => s.checkedAt)),
  nextCheckAt: Math.min(...stored.map((s) => s.nextCheckAt)),
});

/** All apps from what's saved on this computer. Apps not saved yet make the result due at once. */
export async function storedPortfolio(platform: Platform, auth: AscAuth, apps: AppSummary[], days: number): Promise<StoredDataset | null> {
  const stored = await Promise.all(apps.map((app) => storedDataset(platform, auth, app, days)));
  const found = stored.filter((s): s is StoredDataset => s !== null);
  if (found.length === 0) return null;
  const combined = combineStored(found);
  return found.length < apps.length ? { ...combined, nextCheckAt: 0 } : combined;
}

/** All apps, each from its saved copy unless Apple could have something new (or `refresh`). Two apps at a time. */
export async function buildPortfolio(platform: Platform, auth: AscAuth, apps: AppSummary[], days: number, options: { refresh?: boolean } = {}): Promise<StoredDataset> {
  const out: StoredDataset[] = [];
  for (let i = 0; i < apps.length; i += 2) {
    out.push(...await Promise.all(apps.slice(i, i + 2).map((app) => buildDataset(platform, auth, app, days, options))));
  }
  return combineStored(out);
}
