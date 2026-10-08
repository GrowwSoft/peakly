import type { DailyRevenue, DailySourceMetrics, DailySourceOutcome, SourceType } from "@/core/insights/types";
import { toNumber } from "./tsv";

export const ENGAGEMENT_REPORT = "App Store Discovery and Engagement Standard";
export const DOWNLOADS_REPORT = "App Downloads Standard";
/** Revenue reports, readable with the same key (no vendor number). Names as the API lists them. */
export const PURCHASES_REPORT = "App Store Purchases Standard";
export const SUBSCRIPTION_EVENT_REPORT = "App Store Subscription Event Report Standard";
export const SUBSCRIPTION_STATE_REPORT = "App Store Subscription State Report Standard";
export const REVENUE_REPORTS = [PURCHASES_REPORT, SUBSCRIPTION_EVENT_REPORT, SUBSCRIPTION_STATE_REPORT];
/** Installs and deletions by source (opt-in users only). */
export const INSTALLS_REPORT = "App Store Installation and Deletion Standard";

/** A compact row kept in the cache: the report it came from, its date, the dimensions we use, and Counts. */
export interface CompactRow {
  report: string;
  date: string;
  event: string;
  pageType: string;
  sourceType: string;
  engagementType: string;
  downloadType: string;
  /** Every dimension value, so restated rows from a newer instance replace older ones exactly. */
  identity: string;
  /** "Counts", or "Purchases" in the purchases report. */
  counts: number;
  /** "Unique Counts" (unique devices that day), where the report has it. */
  unique?: number;
  // Revenue reports only.
  proceedsUsd?: number;
  stateMetric?: string;
  stateGrouping?: string;
  eventGrouping?: string;
  eventSubType?: string;
  offerDuration?: string;
}

const MEASURES = new Set(["Counts", "Unique Counts", "Unique Devices", "Purchases", "Proceeds in USD", "Sales in USD", "Paying Users"]);

export function compactRows(report: string, rows: Record<string, string>[]): CompactRow[] {
  const out: CompactRow[] = [];
  for (const row of rows) {
    const counts = toNumber(row["Counts"] ?? row["Purchases"]);
    const date = row["Date"] ?? row["Event Date"]; // the subscription event report calls it "Event Date"
    if (counts === null || !date) continue;
    const identity = Object.entries(row).filter(([k]) => !MEASURES.has(k)).map(([k, v]) => `${k}=${v}`).sort().join("|");
    out.push({
      report, date, counts, identity,
      ...(row["Unique Counts"] !== undefined ? { unique: toNumber(row["Unique Counts"]) ?? 0 } : {}),
      // The subscription reports call the source "App Download Source Type".
      event: row["Event"] ?? "", pageType: row["Page Type"] ?? "", sourceType: row["Source Type"] ?? row["App Download Source Type"] ?? "",
      engagementType: row["Engagement Type"] ?? "", downloadType: row["Download Type"] ?? "",
      ...(report === PURCHASES_REPORT ? { proceedsUsd: toNumber(row["Proceeds in USD"]) ?? 0 } : {}),
      ...(report === SUBSCRIPTION_STATE_REPORT ? { stateMetric: row["State Metric"] ?? "", stateGrouping: row["State Metric Grouping"] ?? "" } : {}),
      ...(report === SUBSCRIPTION_EVENT_REPORT ? { eventGrouping: row["Event Grouping"] ?? "", eventSubType: row["Event Sub Type"] ?? "", offerDuration: row["Offer Duration"] ?? "" } : {}),
    });
  }
  return out;
}

export function sourceOf(sourceType: string): SourceType {
  switch (sourceType.trim().toLowerCase()) {
    case "app store search": return "search";
    case "app store browse": return "browse";
    case "app referrer": return "app_referrer";
    case "web referrer": return "web_referrer";
    default: return "other";
  }
}

const SOURCES: SourceType[] = ["search", "browse", "app_referrer", "web_referrer", "other"];

/**
 * Turn deduplicated rows into daily per-source metrics. Apple omits zero rows, so a
 * date covered by BOTH published reports starts at 0; dates either report doesn't
 * cover produce nothing (unknown), never a fabricated zero.
 */
export function toDailyMetrics(rows: CompactRow[], coveredDates: Set<string>): DailySourceMetrics[] {
  const byKey = new Map<string, DailySourceMetrics>();
  for (const date of coveredDates) {
    for (const source of SOURCES) {
      byKey.set(`${date}|${source}`, { date, source, impressions: 0, uniqueImpressions: 0, pageViews: 0, getTaps: 0, firstDownloads: 0, pageDownloads: 0, redownloads: 0 });
    }
  }
  for (const row of rows) {
    const m = byKey.get(`${row.date}|${sourceOf(row.sourceType)}`);
    if (!m) continue;
    // Apple's glossary and files differ in capitalization ("First-time Download" vs "First-time download",
    // "No Page" vs "No page"), so values are compared case-insensitively.
    const is = (value: string, expected: string) => value.trim().toLowerCase() === expected;
    const productPage = is(row.pageType, "product page");
    if (row.report === ENGAGEMENT_REPORT) {
      if (is(row.event, "impression")) {
        m.impressions! += row.counts;
        m.uniqueImpressions! += row.unique ?? 0;
      }
      else if (is(row.event, "page view") && productPage) m.pageViews! += row.counts;
      // "Get" taps also include Buy and Pre-order taps.
      else if (is(row.event, "tap") && is(row.engagementType, "get") && productPage) m.getTaps! += row.counts;
    } else if (row.report === DOWNLOADS_REPORT) {
      if (is(row.downloadType, "first-time download")) {
        m.firstDownloads! += row.counts;
        if (productPage) m.pageDownloads! += row.counts;
      } else if (is(row.downloadType, "redownload")) m.redownloads! += row.counts;
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Keep each row identity from the newest instance only (Apple restates rows in later instances). */
export function dedupeNewest(instances: { processingDate: string; rows: CompactRow[] }[]): CompactRow[] {
  // Apple restates days in later instances. For each report and day, the newest instance that
  // covers it replaces every older row for that day, so dropped or corrected rows don't linger.
  const newest = new Map<string, string>();
  for (const instance of instances) {
    for (const row of instance.rows) {
      const key = `${row.report}#${row.date}`;
      if ((newest.get(key) ?? "") < instance.processingDate) newest.set(key, instance.processingDate);
    }
  }
  const seen = new Set<string>();
  const out: CompactRow[] = [];
  for (const instance of instances) {
    for (const row of instance.rows) {
      if (newest.get(`${row.report}#${row.date}`) !== instance.processingDate) continue;
      const key = `${row.report}#${row.identity}`; // the same instance listed twice still counts once
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

const same = (value: string | undefined, expected: string) => (value ?? "").trim().toLowerCase() === expected.toLowerCase();

/**
 * Daily purchases and subscription activity from Apple's Analytics Reports. A day Apple
 * published a report for but with no rows is a real zero; other days are left out (unknown).
 * Purchases: negative counts are refunds; zero purchases with negative proceeds is a partial refund.
 */
export function toDailyRevenue(rows: CompactRow[], coveredDates: Set<string>): DailyRevenue[] {
  const byDate = new Map<string, DailyRevenue>();
  for (const date of coveredDates) {
    byDate.set(date, { date, purchases: 0, refunds: 0, proceedsUsd: 0, trialStarts: 0, offerConversions: 0, paidStarts: 0, renewals: 0, churned: 0, voluntaryChurn: 0, involuntaryChurn: 0, trialDays: null, activePaid: null, activeTrials: null });
  }
  const trialLengths = new Map<string, Map<number, number>>(); // date -> days -> trial starts
  for (const row of rows) {
    const day = byDate.get(row.date);
    if (!day) continue;
    if (row.report === PURCHASES_REPORT) {
      if (row.counts >= 0) day.purchases += row.counts;
      else day.refunds += -row.counts;
      day.proceedsUsd += row.proceedsUsd ?? 0;
    } else if (row.report === SUBSCRIPTION_EVENT_REPORT) {
      if (same(row.eventSubType, "Free Trial Starts")) {
        day.trialStarts += row.counts;
        const days = durationDays(row.offerDuration);
        if (days) {
          const lengths = trialLengths.get(row.date) ?? new Map<number, number>();
          lengths.set(days, (lengths.get(days) ?? 0) + row.counts);
          trialLengths.set(row.date, lengths);
        }
      }
      if (same(row.eventGrouping, "Paid Subscriptions from Offers")) day.offerConversions += row.counts;
      else if (same(row.eventGrouping, "Paid Subscription Starts")) day.paidStarts += row.counts;
      else if (same(row.eventGrouping, "Renewals")) day.renewals += row.counts;
      else if (same(row.eventGrouping, "Voluntary Churn")) { day.churned += row.counts; day.voluntaryChurn += row.counts; }
      else if (same(row.eventGrouping, "Involuntary Churn")) { day.churned += row.counts; day.involuntaryChurn += row.counts; }
    } else if (row.report === SUBSCRIPTION_STATE_REPORT) {
      // A snapshot: active subscriptions on that day.
      if (same(row.stateGrouping, "Paid plans")) day.activePaid = (day.activePaid ?? 0) + row.counts;
      if (same(row.stateMetric, "Free trials")) day.activeTrials = (day.activeTrials ?? 0) + row.counts;
    }
  }
  for (const day of byDate.values()) {
    day.proceedsUsd = Math.round(day.proceedsUsd * 100) / 100;
    const lengths = trialLengths.get(day.date);
    if (lengths) day.trialDays = [...lengths.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** "3 Days", "1 Week", "2 Weeks", "1 Month" → days. Unknown wording → null. */
export function durationDays(text: string | undefined): number | null {
  const m = (text ?? "").trim().toLowerCase().match(/^(\d+)\s*(day|week|month|year)s?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "day" ? n : m[2] === "week" ? n * 7 : m[2] === "month" ? n * 30 : n * 365;
}

/**
 * Installs, deletions, purchases and trial starts per source and day. Each part is only
 * filled for days its own report was published; elsewhere it stays null (unknown).
 */
export function toDailyOutcomes(rows: CompactRow[], usageDates: Set<string>, revenueDates: Set<string>): DailySourceOutcome[] {
  const byKey = new Map<string, DailySourceOutcome>();
  const slot = (date: string, source: SourceType) => {
    const key = `${date}|${source}`;
    let o = byKey.get(key);
    if (!o) {
      o = { date, source, installs: usageDates.has(date) ? 0 : null, deletions: usageDates.has(date) ? 0 : null, purchases: revenueDates.has(date) ? 0 : null, trialStarts: revenueDates.has(date) ? 0 : null };
      byKey.set(key, o);
    }
    return o;
  };
  for (const date of new Set([...usageDates, ...revenueDates])) for (const source of SOURCES) slot(date, source);
  for (const row of rows) {
    const source = sourceOf(row.sourceType);
    if (row.report === INSTALLS_REPORT && usageDates.has(row.date)) {
      const o = slot(row.date, source);
      if (same(row.event, "Delete")) o.deletions! += row.counts;
      else if (same(row.event, "Install") && (same(row.downloadType, "First-time download") || same(row.downloadType, "Redownload"))) o.installs! += row.counts;
    } else if (revenueDates.has(row.date)) {
      const o = slot(row.date, source);
      if (row.report === PURCHASES_REPORT && row.counts > 0) o.purchases! += row.counts;
      if (row.report === SUBSCRIPTION_EVENT_REPORT && same(row.eventSubType, "Free Trial Starts")) o.trialStarts! += row.counts;
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}
