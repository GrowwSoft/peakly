import { ratio, relativeChange } from "./stats";
import type { DailyRevenue, DailySales, DailySourceMetrics, DailySourceOutcome, SourceType } from "./types";

export type MetricKey = "impressions" | "uniqueImpressions" | "pageViews" | "getTaps" | "firstDownloads" | "pageDownloads" | "redownloads";
const METRIC_KEYS: MetricKey[] = ["impressions", "uniqueImpressions", "pageViews", "getTaps", "firstDownloads", "pageDownloads", "redownloads"];

/**
 * App Store Connect's Conversion Rate: total downloads (first-time + redownloads) divided by
 * unique-device impressions. Apple also counts pre-orders, which these reports don't expose,
 * and may de-duplicate devices across a whole period, while daily reports only give daily uniques.
 */
export function appStoreConversion(t: { firstDownloads: number | null; redownloads: number | null; uniqueImpressions: number | null }): number | null {
  if (t.firstDownloads === null && t.redownloads === null) return null;
  return ratio((t.firstDownloads ?? 0) + (t.redownloads ?? 0), t.uniqueImpressions);
}

export type Totals = Record<MetricKey, number | null>;

export interface Window {
  start: string;
  end: string;
  days: number;
}

const DAY = 86_400_000;
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY);

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The decision window ends at the latest observed analytics day; the previous window is the same length before it. */
export function windows(latestObserved: string, days: number): { current: Window; previous: Window } {
  const currentStart = addDays(latestObserved, -(days - 1));
  return {
    current: { start: currentStart, end: latestObserved, days },
    previous: { start: addDays(currentStart, -days), end: addDays(currentStart, -1), days },
  };
}

export function inWindow(date: string, w: Window): boolean {
  return date >= w.start && date <= w.end;
}

/** Sum each metric; a metric with no reported rows at all stays null (unknown), not 0. */
export function totals(rows: DailySourceMetrics[], w: Window, source?: SourceType): Totals {
  const out = Object.fromEntries(METRIC_KEYS.map((k) => [k, null])) as Totals;
  for (const row of rows) {
    if (!inWindow(row.date, w) || (source && row.source !== source)) continue;
    for (const key of METRIC_KEYS) {
      const value = row[key];
      if (value === null) continue;
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

export interface Kpi {
  key: "impressions" | "pageViews" | "firstDownloads" | "conversion";
  label: string;
  value: number | null;
  previous: number | null;
  /** Relative change for counts; percentage-point change for the conversion rate. */
  change: number | null;
  changeKind: "relative" | "points";
}

export function kpis(rows: DailySourceMetrics[], current: Window, previous: Window): Kpi[] {
  const now = totals(rows, current);
  const before = totals(rows, previous);
  const conv = appStoreConversion(now);
  const convBefore = appStoreConversion(before);
  const count = (key: "impressions" | "pageViews" | "firstDownloads", label: string): Kpi => ({
    key, label, value: now[key], previous: before[key], change: relativeChange(now[key], before[key]), changeKind: "relative",
  });
  return [
    count("impressions", "Impressions"),
    { key: "conversion", label: "Conversion rate", value: conv, previous: convBefore,
      change: conv === null || convBefore === null ? null : conv - convBefore, changeKind: "points" },
    count("firstDownloads", "First-time downloads"),
    count("pageViews", "Product page views"),
  ];
}

export interface SeriesPoint {
  label: string; // date or week start
  impressions: number | null;
  uniqueImpressions: number | null;
  firstDownloads: number | null;
  redownloads: number | null;
  /** App Store Connect's conversion rate (see appStoreConversion). */
  conversion: number | null;
}

export type Grain = "day" | "week" | "month";

/** Daily, weekly (from the window start) or calendar-month totals across all sources for the chart. */
export function series(rows: DailySourceMetrics[], w: Window, grain: Grain): SeriesPoint[] {
  const dates = datesBetween(w.start, w.end);
  const buckets = new Map<string, SeriesPoint>();
  const bucketOf = (date: string) => {
    if (grain === "day") return date;
    if (grain === "month") return `${date.slice(0, 7)}-01`;
    const index = Math.floor((Date.parse(date) - Date.parse(w.start)) / (7 * DAY));
    return addDays(w.start, index * 7);
  };
  for (const date of dates) {
    const key = bucketOf(date);
    if (!buckets.has(key)) buckets.set(key, { label: key, impressions: null, uniqueImpressions: null, firstDownloads: null, redownloads: null, conversion: null });
  }
  for (const row of rows) {
    if (!inWindow(row.date, w)) continue;
    const point = buckets.get(bucketOf(row.date))!;
    for (const key of ["impressions", "uniqueImpressions", "firstDownloads", "redownloads"] as const) {
      if (row[key] !== null) point[key] = (point[key] ?? 0) + row[key]!;
    }
  }
  for (const point of buckets.values()) point.conversion = appStoreConversion(point);
  return [...buckets.values()];
}

export interface SalesSummary {
  appUnits: number;
  paidUnits: number;
  refunds: number;
  proceeds: Record<string, number>;
  availableDays: number;
  pendingDays: number;
}

export function salesSummary(sales: DailySales[], w: Window): SalesSummary {
  const out: SalesSummary = { appUnits: 0, paidUnits: 0, refunds: 0, proceeds: {}, availableDays: 0, pendingDays: 0 };
  for (const day of sales) {
    if (!inWindow(day.date, w)) continue;
    if (day.status === "pending" || day.status === "unavailable") { out.pendingDays++; continue; } // unknown, not zero
    out.availableDays++;
    out.appUnits += day.appUnits;
    out.paidUnits += day.paidUnits;
    out.refunds += day.refunds;
    for (const [currency, amount] of Object.entries(day.proceeds)) out.proceeds[currency] = (out.proceeds[currency] ?? 0) + amount;
  }
  return out;
}

export interface RevenueSummary {
  /** Days in the window Apple published purchase and subscription reports for. */
  days: number;
  purchases: number;
  refunds: number;
  proceedsUsd: number;
  trialStarts: number;
  offerConversions: number;
  paidStarts: number;
  renewals: number;
  churned: number;
  voluntaryChurn: number;
  involuntaryChurn: number;
  /** The most common free-trial length in the window, in days, when known. */
  trialDays: number | null;
  /** From the latest published snapshot in the window. */
  activePaid: number | null;
  activeTrials: number | null;
}

/** Purchases and subscription activity added up over a window; active counts are the latest snapshot. */
export function revenueSummary(revenue: DailyRevenue[], w: Window): RevenueSummary {
  const out: RevenueSummary = { days: 0, purchases: 0, refunds: 0, proceedsUsd: 0, trialStarts: 0, offerConversions: 0, paidStarts: 0, renewals: 0, churned: 0, voluntaryChurn: 0, involuntaryChurn: 0, trialDays: null, activePaid: null, activeTrials: null };
  const lengths = new Map<number, number>();
  for (const day of revenue) {
    if (!inWindow(day.date, w)) continue;
    out.days++;
    for (const key of ["purchases", "refunds", "proceedsUsd", "trialStarts", "offerConversions", "paidStarts", "renewals", "churned", "voluntaryChurn", "involuntaryChurn"] as const) out[key] += day[key] ?? 0;
    if (day.trialDays) lengths.set(day.trialDays, (lengths.get(day.trialDays) ?? 0) + day.trialStarts);
    if (day.activePaid !== null) out.activePaid = day.activePaid;
    if (day.activeTrials !== null) out.activeTrials = day.activeTrials;
  }
  out.proceedsUsd = Math.round(out.proceedsUsd * 100) / 100;
  out.trialDays = [...lengths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return out;
}

/**
 * Trial-to-paid, matched by trial length: conversions in the window divided by trials that
 * started one trial length earlier. Apple counts events on the day they happen, so this is
 * an estimate, not a cohort. Null when the earlier period isn't mostly published.
 */
export function laggedTrialConversion(revenue: DailyRevenue[], w: Window, trialDays: number): { rate: number; conversions: number; trials: number; from: string; to: string } | null {
  const earlier: Window = { start: addDays(w.start, -trialDays), end: addDays(w.end, -trialDays), days: w.days };
  const before = revenueSummary(revenue, earlier);
  const now = revenueSummary(revenue, w);
  if (before.days < w.days / 2 || before.trialStarts === 0) return null;
  return { rate: now.offerConversions / before.trialStarts, conversions: now.offerConversions, trials: before.trialStarts, from: earlier.start, to: earlier.end };
}

export interface OutcomeTotals {
  installs: number | null;
  deletions: number | null;
  purchases: number | null;
  trialStarts: number | null;
}

/** Installs, deletions, purchases and trial starts in a window, optionally for one source. Null = not published. */
export function outcomeTotals(outcomes: DailySourceOutcome[], w: Window, source?: SourceType): OutcomeTotals {
  const out: OutcomeTotals = { installs: null, deletions: null, purchases: null, trialStarts: null };
  for (const o of outcomes) {
    if (!inWindow(o.date, w) || (source && o.source !== source)) continue;
    for (const key of ["installs", "deletions", "purchases", "trialStarts"] as const) {
      if (o[key] !== null) out[key] = (out[key] ?? 0) + o[key]!;
    }
  }
  return out;
}
