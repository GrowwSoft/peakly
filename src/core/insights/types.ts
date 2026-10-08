/**
 * Normalized metrics every data source is reduced to before insights run.
 *
 * A value is `null` when the source did not report it. That means "unknown",
 * never zero: missing, suppressed or not-yet-published data must not read as
 * a measured absence.
 */

export type SourceType = "search" | "browse" | "app_referrer" | "web_referrer" | "other";

export const SOURCE_LABELS: Record<SourceType, string> = {
  search: "App Store search",
  browse: "App Store browse",
  app_referrer: "App referrer",
  web_referrer: "Web referrer",
  other: "Other / unavailable",
};

/** One day of store-funnel counts for one acquisition source. Event counts, not people. */
export interface DailySourceMetrics {
  date: string; // YYYY-MM-DD
  source: SourceType;
  impressions: number | null;
  /** Unique devices that saw an impression that day (Apple's "Unique Counts"); the denominator of Apple's conversion rate. */
  uniqueImpressions: number | null;
  pageViews: number | null;
  getTaps: number | null;
  firstDownloads: number | null;
  /** First downloads whose Page Type was a product page (direct search downloads bypass the page). */
  pageDownloads: number | null;
  redownloads: number | null;
  /** Which app the row is from, when several apps are combined. */
  app?: string;
}

export interface DailySales {
  date: string;
  /** "unavailable": Apple didn't say why the report is missing, so the day is unknown (not zero). */
  status: "available" | "pending" | "no_sales" | "unavailable";
  appUnits: number;
  updateUnits: number;
  redownloadUnits: number;
  paidUnits: number;
  /** Proceeds per currency. Never summed across currencies. */
  proceeds: Record<string, number>;
  refunds: number;
}

/** One day of purchases and subscription activity (Apple's Analytics Reports; proceeds are Apple's USD estimate). */
export interface DailyRevenue {
  date: string;
  /** In-app and paid-app purchases (refunds counted separately). */
  purchases: number;
  refunds: number;
  /** Estimated proceeds in USD after Apple's commission and taxes; refunds and partial refunds subtract. */
  proceedsUsd: number;
  trialStarts: number;
  /** Free trials and paid offers that converted to paid subscriptions. */
  offerConversions: number;
  /** Paid subscriptions that started without an offer. */
  paidStarts: number;
  renewals: number;
  /** Voluntary and involuntary churn. */
  churned: number;
  /** Subscribers who cancelled. */
  voluntaryChurn: number;
  /** Subscribers lost to billing problems Apple couldn't recover. */
  involuntaryChurn: number;
  /** The most common free-trial length that day, in days (from the offer duration), when known. */
  trialDays: number | null;
  /** Active paid subscriptions that day (snapshot); null when the snapshot isn't published. */
  activePaid: number | null;
  activeTrials: number | null;
}

/**
 * What happens after the download, per acquisition source and day. Installs and deletions
 * come from users who share analytics with developers (opt-in); purchases and trial starts
 * from Apple's purchase and subscription reports. Null where the report isn't published.
 */
export interface DailySourceOutcome {
  date: string;
  source: SourceType;
  /** First-time downloads and redownloads installed (updates and restores excluded). */
  installs: number | null;
  deletions: number | null;
  purchases: number | null;
  trialStarts: number | null;
}

export interface AppRelease {
  version: string;
  state: string;
  /** The build Apple shipped (or is reviewing) for this version, when the key can read it. */
  build: string | null;
  /** When the version went public. Recorded by Peakly when it first sees the version live; null if that was before. */
  releasedAt: string | null;
  /** Whether this version has ever been on the App Store. Activity on any other version is tester activity. */
  public: boolean;
  /** Which app the version belongs to, when several apps are combined. */
  app?: string;
}

export interface AppSummary {
  id: string;
  name: string;
  bundleId: string;
  sku: string;
  iconUrl: string | null;
}

export interface ReportCoverage {
  analytics: "observed" | "pending" | "not_enabled" | "error" | "unavailable";
  analyticsDetail?: string;
  /** First and last day Apple returned store analytics for. Days outside are unknown. */
  analyticsFrom?: string | null;
  analyticsThrough: string | null;
  sales: "observed" | "error" | "unavailable";
  salesDetail?: string;
  salesPendingDates: string[];
  /** Purchases and subscriptions from Analytics Reports (no vendor number needed). */
  revenue?: "observed" | "unavailable";
  revenueThrough?: string | null;
  /** When several apps are combined: the apps whose store analytics aren't in the totals, and why. */
  excludedApps?: { name: string; reason: ReportCoverage["analytics"] }[];
}

export interface AppDataset {
  app: AppSummary;
  generatedAt: string;
  metrics: DailySourceMetrics[];
  sales: DailySales[];
  releases: AppRelease[];
  /** Days Apple published purchase and subscription reports for. Empty when unavailable. */
  revenue?: DailyRevenue[];
  /** Installs, deletions, purchases and trial starts by source. */
  outcomes?: DailySourceOutcome[];
  coverage: ReportCoverage;
  demo: boolean;
  /** The apps combined into this dataset, in a stable order (All apps only). */
  members?: AppSummary[];
}
