import { SOURCE_LABELS, type DailyRevenue, type DailySales, type DailySourceMetrics, type DailySourceOutcome, type ReportCoverage, type SourceType } from "./types";
import { appStoreConversion, laggedTrialConversion, outcomeTotals, revenueSummary, salesSummary, totals, type SalesSummary, type Window } from "./metrics";
import { wilsonInterval } from "./stats";

/**
 * Thresholds are explicit heuristics, not fitted benchmarks. They are exported so
 * a self-hosted instance can tune them, and every insight quotes the numbers it used.
 */
export const INSIGHT_POLICY = {
  /** Page conversion (page-attributed first downloads / page-view events) treated as healthy. */
  targetPageConversion: 0.25,
  /** Below this many impressions per day, discovery is treated as low. */
  lowImpressionsPerDay: 100,
  /** Fewer page views than this can't support a conversion verdict either way. */
  minPageViews: 30,
  /** A single source above this share of first downloads is called out. */
  dominantSourceShare: 0.6,
  /** A source needs this many first downloads before its after-download numbers are compared. */
  minSourceDownloads: 20,
  /** With no dominant source, a source mix is described once there are this many first downloads. */
  minMixedDownloads: 10,
  /** Fewer trial starts than this can't support a trial-to-paid verdict. */
  minTrials: 20,
} as const;

export type Tone = "blue" | "amber" | "green" | "slate";

/**
 * Every insight separates what the data shows from what we suspect:
 * observed numbers → plausible explanations → one test → the measure that settles it.
 */
export interface Insight {
  id: string;
  tone: Tone;
  title: string;
  /** What the data shows, with its numbers. */
  observed: string[];
  /** Possible reasons. The data narrows them down; it doesn't prove which one is true. */
  explanations: string[];
  /** One specific thing to try. */
  test: { title: string; body: string };
  /** How to tell whether it worked, or which explanation it rules out. */
  success: string;
  /** The limits of the data behind this insight. */
  caveats: string[];
}

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const fmt = (v: number) => v.toLocaleString("en-US");
const per100 = (part: number, whole: number) => Math.round((part / whole) * 100);

const STORE_SETTLING = "Apple can still revise the last 3 days of store data.";
const USAGE_SETTLING = "Installs and deletions can take 5 days to settle, and only cover users who share analytics with developers: compare sources by direction, not totals.";
const NOT_A_COHORT = "Deletions, purchases and trials in a period come from anyone who installed at any time, not only this period's downloads.";

export type ExposureLevel = "low" | "high";
export type ConversionLevel = "low" | "high" | "uncertain";

export function classify(impressions: number, days: number, pageViews: number, pageDownloads: number) {
  const exposure: ExposureLevel = impressions / days < INSIGHT_POLICY.lowImpressionsPerDay ? "low" : "high";
  const interval = wilsonInterval(pageDownloads, pageViews);
  let conversion: ConversionLevel = "uncertain";
  if (interval && pageViews >= INSIGHT_POLICY.minPageViews) {
    if (interval.low >= INSIGHT_POLICY.targetPageConversion) conversion = "high";
    else if (interval.high < INSIGHT_POLICY.targetPageConversion) conversion = "low";
  }
  return { exposure, conversion, interval };
}

// ---------- 1. Storefront: where the store funnel loses people ----------

function storefrontInsight(rows: DailySourceMetrics[], w: Window): Insight | null {
  const t = totals(rows, w);
  if (t.impressions === null || t.pageViews === null || t.pageDownloads === null) return null;
  const { exposure, conversion, interval } = classify(t.impressions, w.days, t.pageViews, t.pageDownloads);
  const direct = Math.max((t.firstDownloads ?? 0) - t.pageDownloads, 0);
  const directShare = t.firstDownloads ? direct / t.firstDownloads : 0;
  const storeRate = appStoreConversion(t);
  const observed = [
    `${fmt(t.impressions)} impressions in ${w.days} days (${fmt(Math.round(t.impressions / w.days))} a day; "low" below ${INSIGHT_POLICY.lowImpressionsPerDay})`,
    `${fmt(t.pageViews)} product page views: ${t.impressions ? pct(t.pageViews / t.impressions) : "—"} of impressions`,
    `${fmt(t.pageDownloads)} downloads from the product page: ${t.pageViews ? pct(t.pageDownloads / t.pageViews) : "—"} of page views`
      + (interval ? ` (95% range ${pct(interval.low)}–${pct(interval.high)}; target ${pct(INSIGHT_POLICY.targetPageConversion)})` : ""),
    ...(direct > 0 ? [`${fmt(direct)} downloads straight from search results, without a page view (${pct(directShare)} of first-time downloads)`] : []),
    ...(storeRate !== null ? [`App Store Connect conversion rate: ${pct(storeRate)}`] : []),
  ];
  const caveats = [`The ${pct(INSIGHT_POLICY.targetPageConversion)} page-conversion target is a heuristic, not a benchmark.`, STORE_SETTLING];

  if (conversion === "uncertain") {
    return {
      id: "too-early", tone: "slate", title: "Too early to judge conversion", observed,
      explanations: [t.pageViews < INSIGHT_POLICY.minPageViews
        ? `Only ${fmt(t.pageViews)} product page views so far: any conversion rate from this is mostly noise.`
        : `Page conversion could be anywhere from ${pct(interval!.low)} to ${pct(interval!.high)}, which spans the target.`],
      test: { title: "Grow qualified traffic before changing the listing", body: "Keep the listing as it is and bring more people to it from one source, so the result isn't muddied by several changes at once." },
      success: `At least ${INSIGHT_POLICY.minPageViews} product page views in a period, so the 95% range is narrow enough to judge.`,
      caveats,
    };
  }

  if (exposure === "low" && conversion === "high") {
    return {
      id: "low-exposure-high-conversion", tone: "blue", title: "Low impressions · High conversion", observed,
      explanations: [
        "The listing works for people who reach it, but the app appears in few places: few matching searches, a low ranking, or a new app.",
        "Most visitors may arrive through links rather than the App Store itself (see the sources insight).",
      ],
      test: { title: "Widen search coverage", body: "Rework the subtitle and keyword field to match more relevant searches. Change nothing else for two weeks." },
      success: "Impressions a day rise while page conversion stays inside its current 95% range.",
      caveats,
    };
  }
  if (exposure === "high" && conversion === "low") {
    const resultsSell = directShare >= 0.5;
    return {
      id: "high-exposure-low-conversion", tone: "amber", title: "High impressions · Low conversion", observed,
      explanations: resultsSell
        ? [
          "Most downloads happen straight from search results, so the result card (icon, name, first screenshots) is doing the selling. Few page views can coexist with healthy acquisition.",
          "People who do open the page want more detail and don't find it there.",
        ]
        : [
          "The screenshots or description don't convince people who open the page.",
          "The page reaches people the app isn't for (keywords or sources that don't match).",
          "Price, ratings or reviews put people off.",
        ],
      test: resultsSell
        ? { title: "Keep the result card, test the page", body: "Leave the icon, name and first screenshots alone; test the later screenshots or description with Product Page Optimization." }
        : { title: "Test the first three screenshots", body: "Run one Product Page Optimization test with a single change. Keep keywords fixed so the audience doesn't change at the same time." },
      success: resultsSell
        ? "Page conversion rises without direct downloads from search results falling."
        : `The test page beats the original in App Store Connect's results, after at least ${INSIGHT_POLICY.minPageViews} page views for each.`,
      caveats,
    };
  }
  if (exposure === "high" && conversion === "high") {
    return {
      id: "healthy", tone: "green", title: "High impressions · High conversion", observed,
      explanations: ["People find the app and the listing convinces them. The open question is whether those downloads turn into engaged or paying users."],
      test: { title: "Scale the source that brings the best users", body: "Put more effort behind the source with the best after-download numbers (see the sources insight), one change at a time." },
      success: "Downloads grow while page conversion stays in its range and purchases or trials per download hold.",
      caveats,
    };
  }
  return {
    id: "low-low", tone: "amber", title: "Low impressions · Low conversion", observed,
    explanations: [
      "Few people see the app, and the page doesn't convince those who do.",
      "More exposure now would mostly reach people who don't download.",
    ],
    test: { title: "Fix the page before seeking more exposure", body: "Test the first screenshots and the subtitle first; widen keywords once the page converts." },
    success: `Page conversion's 95% range moves above ${pct(INSIGHT_POLICY.targetPageConversion)}, then impressions grow.`,
    caveats,
  };
}

// ---------- 2. Sources: volume, and what happens after the download ----------

const SOURCES: SourceType[] = ["search", "browse", "app_referrer", "web_referrer", "other"];

function sourceInsight(rows: DailySourceMetrics[], outcomes: DailySourceOutcome[], w: Window): Insight | null {
  const all = totals(rows, w);
  if (!all.firstDownloads) return null;
  const sources = SOURCES
    .map((source) => ({ source, t: totals(rows, w, source), o: outcomeTotals(outcomes, w, source) }))
    .map((s) => ({ ...s, share: (s.t.firstDownloads ?? 0) / all.firstDownloads! }))
    .filter((s) => s.t.firstDownloads)
    .sort((a, b) => b.share - a.share);
  const top = sources[0]!;
  if (top.share < INSIGHT_POLICY.dominantSourceShare && all.firstDownloads < INSIGHT_POLICY.minMixedDownloads) return null;

  const enough = (s: (typeof sources)[number]) => (s.t.firstDownloads ?? 0) >= INSIGHT_POLICY.minSourceDownloads;
  const observed = sources.map((s) => {
    const parts = [`${SOURCE_LABELS[s.source]}: ${fmt(s.t.firstDownloads!)} first-time downloads (${pct(s.share)})`];
    if (s.t.pageViews && s.t.pageViews >= INSIGHT_POLICY.minPageViews && s.t.pageDownloads !== null) parts.push(`page conversion ${pct(s.t.pageDownloads / s.t.pageViews)}`);
    if (enough(s) && s.o.installs && s.o.deletions !== null) parts.push(`${per100(s.o.deletions, s.o.installs)} deletions per 100 installs`);
    if (enough(s) && s.o.trialStarts !== null) parts.push(`${per100(s.o.trialStarts, s.t.firstDownloads!)} trial starts per 100 downloads`);
    if (enough(s) && s.o.purchases !== null) parts.push(`${per100(s.o.purchases, s.t.firstDownloads!)} purchases per 100 downloads`);
    return parts.join(" · ");
  });
  const usesOutcomes = sources.some((s) => enough(s) && (s.o.installs !== null || s.o.purchases !== null || s.o.trialStarts !== null));
  const caveats = [STORE_SETTLING, ...(usesOutcomes ? [USAGE_SETTLING, NOT_A_COHORT] : [])];

  // Where value and volume part ways: a smaller source whose users trial or buy more often.
  const value = (s: (typeof sources)[number]) => ((s.o.purchases ?? 0) + (s.o.trialStarts ?? 0)) / s.t.firstDownloads!;
  const better = sources.filter((s) => s !== top && enough(s) && enough(top) && value(s) > value(top) * 1.5 && (s.o.purchases ?? 0) + (s.o.trialStarts ?? 0) >= 5)[0];
  const valueNote = better ? [`${SOURCE_LABELS[better.source]} brings fewer downloads, but its users start trials or buy more often per download than ${SOURCE_LABELS[top.source]}'s.`] : [];

  if (top.share < INSIGHT_POLICY.dominantSourceShare) {
    return {
      id: "mixed-sources", tone: "blue", title: "Downloads come from several sources", observed,
      explanations: [
        "No single channel carries the app yet: several small ones each bring some downloads.",
        "Some may be one-off spikes (a share, a feature) rather than lasting channels.",
        ...valueNote,
      ],
      test: { title: "Tag your own links and watch each source", body: "Use campaign links (ct= tokens) wherever you share the app, so referrer downloads are attributed. Then compare sources over two periods before putting effort behind one." },
      success: "One source keeps its share, or grows, across two comparable periods, with users who stay (deletions per install) and pay.",
      caveats: [...caveats, ...(all.firstDownloads < INSIGHT_POLICY.minSourceDownloads ? [`Only ${fmt(all.firstDownloads)} first-time downloads: shares this small move a lot from one download.`] : [])],
    };
  }
  if (top.source === "app_referrer" || top.source === "web_referrer") {
    return {
      id: "referrer-led", tone: "amber", title: `Most downloads come from ${top.source === "app_referrer" ? "links in other apps" : "websites"}`, observed,
      explanations: [
        "People follow a link rather than finding the app in the App Store.",
        "The link could be someone else's post, your own sharing, or another app; Download detail in the Table viewer shows the referring app or site.",
        ...valueNote,
      ],
      test: { title: "Identify and tag the referrer", body: "Find where the links live, then use campaign links (ct= and pt= tokens) so App Store Connect attributes downloads to each placement." },
      success: "Downloads show up under your campaign tokens in Download detail, showing which placement brings them and whether those users stay.",
      caveats,
    };
  }
  if (top.source === "search") {
    const direct = Math.max((top.t.firstDownloads ?? 0) - (top.t.pageDownloads ?? 0), 0);
    return {
      id: "search-led", tone: "blue", title: "Search drives most downloads", observed,
      explanations: [
        direct > 0
          ? `${fmt(direct)} search downloads happened straight from the results list, without opening the product page. The icon, title and first screenshots carry the decision.`
          : "App Store search is the main source of downloads.",
        "People who search already have a need, which tends to make search users the most deliberate ones.",
        ...valueNote,
      ],
      test: { title: "Optimize what shows in search results", body: "Test the icon, title, subtitle or first three screenshots, one at a time, and grow keyword coverage." },
      success: "Search downloads per search impression rise between two comparable periods, while search users' deletions per install don't.",
      caveats,
    };
  }
  if (top.source === "browse") {
    return {
      id: "browse-led", tone: "blue", title: "Browsing the App Store drives most downloads", observed,
      explanations: [
        "The app is reaching people through Today, Games, Apps or charts. That can mean featuring or chart placement, which may not last.",
        "Browse users may have less specific intent than search users; their after-download numbers show whether that matters here.",
        ...valueNote,
      ],
      test: { title: "Check whether browse users stay and pay", body: "Compare browse with search on deletions per install and trials or purchases per download before changing anything." },
      success: "Browse users' deletions and purchases per download are within reach of search users', so the traffic is worth keeping.",
      caveats,
    };
  }
  return null;
}

// ---------- 3. Paid: sales, purchases and subscriptions ----------

function paidSalesInsight(sales: DailySales[], w: Window, coverage: ReportCoverage): Insight | null {
  if (coverage.sales !== "observed") return null;
  const s: SalesSummary = salesSummary(sales, w);
  if (s.availableDays === 0) return null;
  const observed = [
    `${s.availableDays} daily sales reports available${s.pendingDays ? `, ${s.pendingDays} not yet published or unknown` : ""}`,
    `${fmt(s.appUnits)} app units, ${fmt(s.paidUnits)} paid units, ${fmt(s.refunds)} refunds`,
    ...Object.entries(s.proceeds).map(([c, v]) => `Proceeds ${v.toFixed(2)} ${c}`),
  ];
  const caveats = ["Sales reports show completed payments only: free-trial starts don't appear in them."];
  if (s.paidUnits === 0) {
    return {
      id: "no-paid", tone: "slate", title: "No paid sales in this period", observed,
      explanations: [
        "No one bought in this period.",
        "Purchases could be failing: a product not approved or available, or a broken purchase flow.",
        "Trials may still be starting; they only show up as sales when they convert.",
      ],
      test: { title: "Confirm purchases work", body: "Check that every product is approved and available, then make a purchase on the released build." },
      success: "The test purchase completes and appears in Apple's sales report the next day.",
      caveats,
    };
  }
  return {
    id: "paid", tone: "green", title: `${fmt(s.paidUnits)} paid ${s.paidUnits === 1 ? "sale" : "sales"} in this period`, observed,
    explanations: ["Apple's sales reports confirm paying customers in this window."],
    test: { title: "Find which source pays", body: "Compare purchases per download by source (see the sources insight, and Purchases in the Table viewer) before scaling a channel." },
    success: "One source shows clearly more purchases per download over two comparable periods.",
    caveats,
  };
}

/** Without a vendor number, Apple's purchases report (estimated USD) still shows whether anyone pays. */
function purchasesInsight(revenue: DailyRevenue[], w: Window, coverage: ReportCoverage): Insight | null {
  if (coverage.sales === "observed" || coverage.revenue !== "observed") return null;
  const r = revenueSummary(revenue, w);
  if (r.days === 0) return null;
  const observed = [
    `${r.days} daily purchase reports`,
    `${fmt(r.purchases)} purchases, ${fmt(r.refunds)} refunds, about $${r.proceedsUsd.toFixed(2)} in estimated proceeds`,
    `${fmt(r.trialStarts)} free-trial starts`,
  ];
  const caveats = ["Proceeds are Apple's estimate in US dollars; add a vendor number for the exact sales reports."];
  if (r.purchases === 0 && r.trialStarts === 0) {
    return {
      id: "no-purchases", tone: "slate", title: "No purchases or trials in this period", observed,
      explanations: ["No one bought or started a trial.", "Purchases could be failing, or people never reach the offer."],
      test: { title: "Confirm purchases work", body: "Check that every product is approved and available, then make a purchase on the released build." },
      success: "The test purchase completes and shows in Apple's purchase report within two days.",
      caveats,
    };
  }
  return {
    id: "purchases", tone: "green", observed, caveats,
    title: r.purchases > 0 ? `${fmt(r.purchases)} ${r.purchases === 1 ? "purchase" : "purchases"} in this period` : `${fmt(r.trialStarts)} free-trial ${r.trialStarts === 1 ? "start" : "starts"}, no purchases yet`,
    explanations: ["People are paying or trying the app's paid features in this window."],
    test: { title: "Find which source pays", body: "Compare purchases and trials per download by source (see the sources insight) before scaling a channel." },
    success: "One source shows clearly more purchases or trials per download over two comparable periods.",
  };
}

function subscriptionInsight(revenue: DailyRevenue[], w: Window, coverage: ReportCoverage, firstDownloads: number | null): Insight | null {
  if (coverage.revenue !== "observed") return null;
  const r = revenueSummary(revenue, w);
  if (r.days === 0 || (r.trialStarts === 0 && r.offerConversions === 0 && r.paidStarts === 0 && r.churned === 0 && !r.activePaid)) return null;
  const trialDays = r.trialDays ?? 7;
  const lagged = laggedTrialConversion(revenue, w, trialDays);
  const observed = [
    `${fmt(r.trialStarts)} free-trial starts${firstDownloads ? ` (${per100(r.trialStarts, firstDownloads)} per 100 first-time downloads)` : ""}`,
    lagged
      ? `About ${pct(lagged.rate)} of trials became paid: ${fmt(lagged.conversions)} conversions in this period against ${fmt(lagged.trials)} trials that started ${trialDays} days earlier`
      : `${fmt(r.offerConversions)} trials or offers converted to paid`,
    `${fmt(r.paidStarts)} paid subscriptions started without an offer, ${fmt(r.renewals)} renewals`,
    `Churn: ${fmt(r.voluntaryChurn)} cancelled, ${fmt(r.involuntaryChurn)} lost to billing problems`,
    ...(r.activePaid !== null ? [`${fmt(r.activePaid)} active paid subscriptions at the end of the period`] : []),
  ];
  const caveats = [
    `Trial-to-paid is an estimate: Apple counts events on the day they happen, so it's matched to trials that started one trial length (${trialDays} days${r.trialDays ? "" : ", assumed"}) earlier, not followed per person.`,
    "Subscription data can take 3 days to settle.",
  ];

  if (r.involuntaryChurn > 0 && r.involuntaryChurn >= r.voluntaryChurn) {
    return {
      id: "billing-churn", tone: "amber", title: "Failed payments cost as many subscribers as cancellations", observed,
      explanations: ["Subscribers whose payment fails, and isn't recovered, are lost even though they didn't choose to leave."],
      test: { title: "Turn on Billing Grace Period", body: "In App Store Connect, enable Billing Grace Period for the subscription group, so subscribers keep access while Apple retries the payment." },
      success: "Recoveries from billing issues rise and subscribers lost to billing problems fall over the next month.",
      caveats,
    };
  }
  if (r.trialStarts < INSIGHT_POLICY.minTrials || !lagged) {
    return {
      id: "subscriptions-early", tone: "slate", title: "Too early to judge trial conversion", observed,
      explanations: [`Fewer than ${INSIGHT_POLICY.minTrials} trial starts, or not enough earlier data to match them: any trial-to-paid rate would be mostly noise.`],
      test: { title: "Let trials accumulate", body: "Keep the trial and price unchanged until enough trials have run their full length." },
      success: `At least ${INSIGHT_POLICY.minTrials} trial starts in a period, and a full trial length of data before it.`,
      caveats,
    };
  }
  return {
    id: "trial-conversion", tone: "blue", title: `About ${pct(lagged.rate)} of trials become paid`, observed,
    explanations: [
      "People who don't convert may not reach the app's value during the trial.",
      "The trial may be too short or too long for how the app is used.",
      "The price shown when the trial ends may be the obstacle.",
    ],
    test: { title: "Change one thing in the trial", body: "Try a different trial length, or a reminder before the trial ends, for new subscribers only. Keep the price the same." },
    success: "The trial-to-paid estimate for trials started after the change rises over the next two trial lengths.",
    caveats,
  };
}

export function diagnose(rows: DailySourceMetrics[], sales: DailySales[], w: Window, coverage: ReportCoverage, revenue: DailyRevenue[] = [], outcomes: DailySourceOutcome[] = []): Insight[] {
  const out: Insight[] = [];
  if (coverage.analytics !== "observed") {
    out.push({
      id: "analytics-missing", tone: "slate", title: "Store analytics not available yet",
      observed: [coverage.analyticsDetail ?? "App Store Connect analytics reports are not available for this app."],
      explanations: ["Impressions, page views and sources come only from Apple's Analytics Reports, which must be turned on once per app."],
      test: { title: "Enable Analytics Reports", body: "An Admin creates one ongoing Analytics Reports request for this app (Settings can do it). Reports start arriving within about two days." },
      success: "The first daily reports appear and this dashboard fills in.",
      caveats: [],
    });
  } else {
    const storefront = storefrontInsight(rows, w);
    if (storefront) out.push(storefront);
    const source = sourceInsight(rows, outcomes, w);
    if (source) out.push(source);
  }
  const paid = paidSalesInsight(sales, w, coverage) ?? purchasesInsight(revenue, w, coverage);
  if (paid) out.push(paid);
  const subscriptions = subscriptionInsight(revenue, w, coverage, totals(rows, w).firstDownloads);
  if (subscriptions) out.push(subscriptions);
  return out;
}
