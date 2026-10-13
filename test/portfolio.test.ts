import { describe, expect, it } from "vitest";
import { combineDatasets, storedPortfolio } from "@/core/portfolio";
import { demoDataset } from "@/core/demo";
import type { Platform } from "@/core/platform";
import { series, windows } from "@/core/insights/metrics";

describe("portfolio freshness", () => {
  const app = (id: string, through: string) => {
    const data = demoDataset(7);
    return { ...data, demo: false, app: { ...data.app, id, name: id },
      coverage: { ...data.coverage, analytics: "observed" as const, analyticsFrom: "2026-10-01", analyticsThrough: through },
      metrics: data.metrics.slice(0, 1).map((row) => ({ ...row, date: through })) };
  };

  it("keeps October 12 visible when another app stops at October 8, without treating partial totals as complete", () => {
    const combined = combineDatasets([app("lagging", "2026-10-08"), app("current", "2026-10-12")]);
    expect(combined.coverage.analyticsThrough).toBe("2026-10-12");
    expect(combined.coverage.analyticsCompleteThrough).toBe("2026-10-08");
    expect(combined.coverage.delayedApps).toEqual([{ name: "lagging", through: "2026-10-08" }]);
    expect(combined.metrics.some((row) => row.app === "current" && row.date === "2026-10-12")).toBe(true);
    const completeRows = combined.metrics.filter((row) => row.date <= combined.coverage.analyticsCompleteThrough!);
    expect(series(completeRows, windows("2026-10-12", 7).current, "day").at(-1)?.impressions).toBeNull();
  });

  it("reconstructs the latest timeline from persisted per-app data after restart", async () => {
    const datasets = [app("lagging", "2026-10-08"), app("current", "2026-10-12")];
    const platform: Platform = { fetch, cache: {
      get: async (key) => JSON.stringify({ dataset: datasets.find((d) => key.includes(d.app.id)), checkedAt: 100, nextCheckAt: 200 }),
      set: async () => {},
    } };
    const combined = await storedPortfolio(platform, { token: async () => "unused", vendorNumber: "" }, datasets.map((d) => d.app), 7);
    expect(combined?.dataset.coverage.analyticsThrough).toBe("2026-10-12");
    expect(combined?.dataset.metrics).toHaveLength(2);
    expect(combined?.nextCheckAt).toBe(200);
  });
});
