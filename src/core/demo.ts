import type { AppDataset, DailyRevenue, DailySales, DailySourceMetrics, SourceType } from "./insights/types";
import { addDays, isoDate } from "./insights/metrics";

/** Deterministic PRNG so the demo looks the same on every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const SHARES: Record<SourceType, { impressions: number; views: number; conv: number; direct: number }> = {
  search: { impressions: 0.78, views: 0.06, conv: 0.31, direct: 0.9 },
  browse: { impressions: 0.2, views: 0.05, conv: 0.24, direct: 0.1 },
  app_referrer: { impressions: 0, views: 1, conv: 0.42, direct: 0 },
  web_referrer: { impressions: 0, views: 0.5, conv: 0.35, direct: 0 },
  other: { impressions: 0.02, views: 0.01, conv: 0.2, direct: 0 },
};

export function demoDataset(days: number): AppDataset {
  const random = rng(42);
  const end = isoDate(Date.now() - 3 * 86_400_000);
  const start = addDays(end, -(days * 2 - 1));
  const metrics: DailySourceMetrics[] = [];
  const sales: DailySales[] = [];
  const revenue: DailyRevenue[] = [];
  for (let i = 0; i < days * 2; i++) {
    const date = addDays(start, i);
    const trend = 1 + i / (days * 2); // gentle growth across both windows
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const base = 140 * trend * (weekday === 0 || weekday === 6 ? 1.15 : 1) * (0.85 + random() * 0.3);
    let firstDownloads = 0;
    for (const source of Object.keys(SHARES) as SourceType[]) {
      const s = SHARES[source];
      const impressions = Math.round(base * s.impressions);
      const pageViews = source === "app_referrer" ? Math.round(2 + random() * 3) : source === "web_referrer" ? Math.round(random() * 2) : Math.round(impressions * s.views * (0.8 + random() * 0.4));
      const pageDownloads = Math.round(pageViews * s.conv * (0.7 + random() * 0.6));
      const direct = Math.round(impressions * 0.012 * s.direct * (0.6 + random() * 0.8));
      firstDownloads += pageDownloads + direct;
      metrics.push({ date, source, impressions, uniqueImpressions: Math.round(impressions * 0.78), pageViews, getTaps: Math.round(pageDownloads * 1.3), firstDownloads: pageDownloads + direct, pageDownloads, redownloads: Math.round(random() * 1.4) });
    }
    const paid = random() < 0.18 * trend ? 1 : 0;
    sales.push({ date, status: "available", appUnits: firstDownloads, updateUnits: Math.round(random() * 4), redownloadUnits: 0, paidUnits: paid, proceeds: paid ? { USD: 2.99 * 0.85 } : {}, refunds: 0 });
    const trialStarts = Math.round(firstDownloads * 0.12 * (0.7 + random() * 0.6));
    const offerConversions = Math.round(trialStarts * 0.4 * random());
    revenue.push({
      date, purchases: paid, refunds: 0, proceedsUsd: Math.round((paid * 2.54 + offerConversions * 6.79) * 100) / 100,
      trialStarts, offerConversions, paidStarts: random() < 0.2 ? 1 : 0, renewals: Math.round(random() * 2 * trend),
      ...(() => { const voluntary = random() < 0.12 ? 1 : 0; const involuntary = random() < 0.05 ? 1 : 0; return { churned: voluntary + involuntary, voluntaryChurn: voluntary, involuntaryChurn: involuntary }; })(),
      trialDays: 7,
      activePaid: Math.round(30 * trend), activeTrials: Math.round(9 * trend),
    });
  }
  return {
    app: { id: "demo", name: "Demo app", bundleId: "com.example.demo", sku: "DEMO", iconUrl: null },
    generatedAt: new Date().toISOString(),
    metrics, sales, revenue,
    releases: [
      { version: "1.3", state: "WAITING_FOR_REVIEW", build: "14", releasedAt: null, public: false },
      { version: "1.2", state: "READY_FOR_SALE", build: "12", releasedAt: `${addDays(end, -Math.floor(days / 3))}T17:00:00Z`, public: true },
    ],
    coverage: { analytics: "observed", analyticsThrough: end, sales: "observed", salesPendingDates: [], revenue: "observed", revenueThrough: end },
    demo: true,
  };
}
