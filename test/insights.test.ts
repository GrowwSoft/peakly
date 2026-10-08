import { describe, expect, it } from "vitest";
import { wilsonInterval } from "@/core/insights/stats";
import { kpis, series, totals, windows } from "@/core/insights/metrics";
import { classify, diagnose } from "@/core/insights/diagnose";
import type { DailySales, DailySourceMetrics, ReportCoverage, SourceType } from "@/core/insights/types";

const day = (date: string, source: SourceType, m: Partial<DailySourceMetrics> = {}): DailySourceMetrics => ({
  date, source, impressions: 0, uniqueImpressions: 0, pageViews: 0, getTaps: 0, firstDownloads: 0, pageDownloads: 0, redownloads: 0, ...m,
});
const observed: ReportCoverage = { analytics: "observed", analyticsThrough: "2026-10-03", sales: "observed", salesPendingDates: [] };

describe("wilsonInterval", () => {
  it("is wide for tiny samples and narrows with more data", () => {
    const small = wilsonInterval(3, 14)!;
    const large = wilsonInterval(300, 1400)!;
    expect(small.low).toBeLessThan(0.1);
    expect(small.high).toBeGreaterThan(0.45);
    expect(large.high - large.low).toBeLessThan(0.05);
  });
  it("returns null without trials", () => expect(wilsonInterval(0, 0)).toBeNull());
});

describe("totals", () => {
  it("keeps unknown as null instead of zero", () => {
    const w = windows("2026-10-03", 7).current;
    expect(totals([], w).impressions).toBeNull();
    const t = totals([day("2026-10-01", "search", { impressions: 10, pageViews: null })], w);
    expect(t.impressions).toBe(10);
    expect(t.pageViews).toBeNull();
  });
});

describe("windows and kpis", () => {
  it("compares equal-length adjacent windows", () => {
    const { current, previous } = windows("2026-10-03", 7);
    expect(current).toEqual({ start: "2026-09-27", end: "2026-10-03", days: 7 });
    expect(previous).toEqual({ start: "2026-09-20", end: "2026-09-26", days: 7 });
  });
  it("reports conversion change in percentage points", () => {
    const { current, previous } = windows("2026-10-03", 7);
    const rows = [
      // App Store Connect's rate: (first-time + redownloads) / unique impressions.
      day("2026-09-21", "search", { impressions: 100, uniqueImpressions: 10, firstDownloads: 2 }),
      day("2026-09-28", "search", { impressions: 150, uniqueImpressions: 10, firstDownloads: 2, redownloads: 1 }),
    ];
    const conv = kpis(rows, current, previous).find((k) => k.key === "conversion")!;
    expect(conv.value).toBeCloseTo(0.3);
    expect(conv.change).toBeCloseTo(0.1);
    expect(kpis(rows, current, previous).find((k) => k.key === "impressions")!.change).toBeCloseTo(0.5);
  });
  it("leaves unpublished days as gaps in the series", () => {
    const w = windows("2026-10-03", 3).current;
    const s = series([day("2026-10-02", "search", { impressions: 5, uniqueImpressions: 2, firstDownloads: 1 })], w, "day");
    expect(s.map((p) => p.impressions)).toEqual([null, 5, null]);
    expect(s[1]!.conversion).toBe(0.5);
  });
});

describe("monthly series", () => {
  it("groups days into calendar months", () => {
    const w = { start: "2026-09-29", end: "2026-10-02", days: 4 };
    const rows = [
      day("2026-09-30", "search", { impressions: 10, uniqueImpressions: 4, firstDownloads: 1 }),
      day("2026-10-01", "search", { impressions: 5, uniqueImpressions: 4, firstDownloads: 2, redownloads: 1 }),
    ];
    const s = series(rows, w, "month");
    expect(s.map((p) => [p.label, p.impressions])).toEqual([["2026-09-01", 10], ["2026-10-01", 5]]);
    expect(s[1]!.conversion).toBe(0.75);
  });
});

describe("classify", () => {
  it("only calls conversion high or low when the interval clears the target", () => {
    expect(classify(500, 28, 14, 3).conversion).toBe("uncertain");
    expect(classify(500, 28, 400, 160).conversion).toBe("high");
    expect(classify(50_000, 28, 400, 40).conversion).toBe("low");
    expect(classify(500, 28, 400, 160).exposure).toBe("low");
  });
});

describe("diagnose", () => {
  const w = windows("2026-10-28", 28).current;
  const many = (m: Partial<DailySourceMetrics>, source: SourceType = "search") =>
    Array.from({ length: 28 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, source, m));

  it("flags low exposure with high conversion", () => {
    const out = diagnose(many({ impressions: 40, pageViews: 15, pageDownloads: 6, firstDownloads: 6 }), [], w, observed);
    expect(out[0]!.id).toBe("low-exposure-high-conversion");
  });
  it("says it's too early on tiny samples", () => {
    const rows = [day("2026-10-10", "search", { impressions: 30, pageViews: 3, pageDownloads: 1, firstDownloads: 1 })];
    expect(diagnose(rows, [], w, observed)[0]!.id).toBe("too-early");
  });
  it("calls out referrer-led growth", () => {
    const rows = many({ pageViews: 2, pageDownloads: 1, firstDownloads: 1 }, "app_referrer");
    expect(diagnose(rows, [], w, observed).map((i) => i.id)).toContain("referrer-led");
  });
  it("reports no paid sales without claiming zero lifetime revenue", () => {
    const sales: DailySales[] = [{ date: "2026-10-05", status: "available", appUnits: 3, updateUnits: 0, redownloadUnits: 0, paidUnits: 0, proceeds: {}, refunds: 0 }];
    const out = diagnose([], sales, w, observed);
    expect(out.find((i) => i.id === "no-paid")?.title).toBe("No paid sales in this period");
  });
  it("explains missing analytics instead of inventing metrics", () => {
    const out = diagnose([], [], w, { ...observed, analytics: "not_enabled", analyticsDetail: "x" });
    expect(out[0]!.id).toBe("analytics-missing");
  });
});
