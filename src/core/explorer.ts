import type { AppDataset, AppSummary } from "./insights/types";
import { SOURCE_LABELS } from "./insights/types";
import type { ReadinessResult } from "./readiness";

/** Where a piece of data comes from: what makes it readable, or Peakly itself for values it works out. */
export type Provider = "asc" | "vendor" | "public" | "derived";

export const PROVIDERS: Record<Provider, { label: string; detail: string }> = {
  asc: { label: "App Store Connect key", detail: "Issuer ID + .p8 key" },
  vendor: { label: "Sales reports", detail: "Same key, plus your vendor number" },
  public: { label: "Public App Store data", detail: "No key needed (US storefront)" },
  derived: { label: "Worked out by Peakly", detail: "From the data in the other columns" },
};

export type Cell = string | number | null;

export interface ExplorerColumn {
  key: string;
  label: string;
  provider: Provider;
  numeric?: boolean;
}

export interface ExplorerTable {
  id: string;
  title: string;
  /** The API call(s) this table comes from. */
  call: string;
  columns: ExplorerColumn[];
  rows: Record<string, Cell>[];
  /** Why the table is empty, when its data can't be read. */
  unavailable?: string;
  /** Anything else worth knowing, such as rows left out. */
  note?: string;
}

const releaseTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

const money = (proceeds: Record<string, number>) =>
  Object.entries(proceeds).map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`).join(", ") || null;

/** Every table of readable data for one app: one table per type of call. */
export function buildExplorerTables(input: { apps: AppSummary[]; dataset: AppDataset; readiness: ReadinessResult | null }): ExplorerTable[] {
  const { apps, dataset, readiness } = input;
  const appsTable: ExplorerTable = {
    id: "apps",
    title: "Apps",
    call: "GET /v1/apps · iTunes lookup",
    columns: [
      { key: "name", label: "Name", provider: "asc" },
      { key: "id", label: "Apple ID", provider: "asc" },
      { key: "bundleId", label: "Bundle ID", provider: "asc" },
      { key: "sku", label: "SKU", provider: "asc" },
      { key: "icon", label: "Icon", provider: "public" },
    ],
    rows: apps.map((a) => ({ name: a.name, id: a.id, bundleId: a.bundleId, sku: a.sku || null, icon: a.iconUrl ? "Available" : null })),
  };

  const versionsTable: ExplorerTable = {
    id: "versions",
    title: "App Store versions",
    call: `GET /v1/apps/{id}/appStoreVersions?include=build · iTunes lookup · release history`,
    columns: [
      ...(dataset.releases.some((r) => r.app) ? [{ key: "app", label: "App", provider: "asc" as const }] : []),
      { key: "version", label: "Version", provider: "asc" },
      { key: "build", label: "Build", provider: "asc" },
      { key: "state", label: "State", provider: "asc" },
      { key: "releasedAt", label: "Public release", provider: "public" },
      { key: "released", label: "Released", provider: "derived" },
    ],
    rows: dataset.releases.map((r) => ({
      app: r.app ?? null,
      version: r.version,
      build: r.build,
      state: r.state,
      // The time Apple's lookup reported when Peakly first saw this version live.
      releasedAt: r.releasedAt ? releaseTime(r.releasedAt) : r.public ? "Before Peakly started recording" : null,
      released: r.public ? "Yes" : "Not yet",
    })),
  };

  const readinessTable: ExplorerTable = {
    id: "readiness",
    title: "Analytics readiness",
    call: "GET /v1/apps/{id}/analyticsReportRequests → reports → instances",
    columns: [
      { key: "app", label: "App", provider: "asc" },
      { key: "analytics", label: "Analytics Reports", provider: "derived" },
    ],
    rows: readiness?.ok ? readiness.apps.map((a) => ({ app: a.name, analytics: a.analytics })) : [],
    ...(readiness && !readiness.ok ? { unavailable: readiness.message } : readiness ? {} : { unavailable: "Not loaded yet." }),
  };

  const analyticsTable: ExplorerTable = {
    id: "analytics",
    title: "Store analytics by day and source",
    call: "Analytics Reports: App Store Discovery and Engagement + App Downloads (Standard, daily)",
    columns: [
      { key: "date", label: "Date", provider: "asc" },
      ...(dataset.metrics.some((m) => m.app) ? [{ key: "app", label: "App", provider: "asc" as const }] : []),
      { key: "source", label: "Source", provider: "asc" },
      { key: "impressions", label: "Impressions", provider: "asc", numeric: true },
      { key: "uniqueImpressions", label: "Unique impressions", provider: "asc", numeric: true },
      { key: "pageViews", label: "Page views", provider: "asc", numeric: true },
      { key: "getTaps", label: "Get/Buy taps", provider: "asc", numeric: true },
      { key: "firstDownloads", label: "First downloads", provider: "asc", numeric: true },
      { key: "pageDownloads", label: "From page", provider: "asc", numeric: true },
      { key: "redownloads", label: "Redownloads", provider: "asc", numeric: true },
    ],
    rows: dataset.metrics
      .filter((m) => (m.impressions ?? 0) + (m.pageViews ?? 0) + (m.getTaps ?? 0) + (m.firstDownloads ?? 0) + (m.redownloads ?? 0) > 0)
      .sort((a, b) => b.date.localeCompare(a.date) || (a.app ?? "").localeCompare(b.app ?? "") || a.source.localeCompare(b.source))
      .map((m) => ({ date: m.date, app: m.app ?? null, source: SOURCE_LABELS[m.source], impressions: m.impressions, uniqueImpressions: m.uniqueImpressions, pageViews: m.pageViews, getTaps: m.getTaps, firstDownloads: m.firstDownloads, pageDownloads: m.pageDownloads, redownloads: m.redownloads })),
    ...(dataset.coverage.analytics !== "observed" ? { unavailable: dataset.coverage.analyticsDetail ?? "Store analytics aren't available for this app." } : {}),
  };

  const salesTable: ExplorerTable = {
    id: "sales",
    title: "Sales by day",
    call: "GET /v1/salesReports (SALES, SUMMARY, DAILY)",
    columns: [
      { key: "date", label: "Date", provider: "vendor" },
      { key: "status", label: "Report", provider: "vendor" },
      { key: "appUnits", label: "App units", provider: "vendor", numeric: true },
      { key: "updateUnits", label: "Updates", provider: "vendor", numeric: true },
      { key: "redownloadUnits", label: "Redownloads", provider: "vendor", numeric: true },
      { key: "paidUnits", label: "Paid units", provider: "vendor", numeric: true },
      { key: "refunds", label: "Refunds", provider: "vendor", numeric: true },
      { key: "proceeds", label: "Proceeds", provider: "vendor" },
    ],
    rows: [...dataset.sales].sort((a, b) => b.date.localeCompare(a.date)).map((d) => ({
      date: d.date,
      status: d.status === "available" ? "Published" : d.status === "pending" ? "Not published yet" : d.status === "no_sales" ? "No sales" : "Unavailable",
      appUnits: d.status === "available" ? d.appUnits : null,
      updateUnits: d.status === "available" ? d.updateUnits : null,
      redownloadUnits: d.status === "available" ? d.redownloadUnits : null,
      paidUnits: d.status === "available" ? d.paidUnits : null,
      refunds: d.status === "available" ? d.refunds : null,
      proceeds: money(d.proceeds),
    })),
    ...(dataset.coverage.sales !== "observed" ? { unavailable: dataset.coverage.salesDetail ?? "Sales reports aren't available." } : {}),
  };

  const revenueTable: ExplorerTable = {
    id: "revenue",
    title: "Purchases and subscriptions by day",
    call: "Analytics Reports: App Store Purchases + Subscription Event + Subscription State (Standard, daily)",
    columns: [
      { key: "date", label: "Date", provider: "asc" },
      { key: "purchases", label: "Purchases", provider: "asc", numeric: true },
      { key: "refunds", label: "Refunds", provider: "asc", numeric: true },
      { key: "proceedsUsd", label: "Est. proceeds (USD)", provider: "asc", numeric: true },
      { key: "trialStarts", label: "Trial starts", provider: "asc", numeric: true },
      { key: "offerConversions", label: "Converted to paid", provider: "asc", numeric: true },
      { key: "paidStarts", label: "New paid", provider: "asc", numeric: true },
      { key: "renewals", label: "Renewals", provider: "asc", numeric: true },
      { key: "churned", label: "Churned", provider: "asc", numeric: true },
      { key: "activePaid", label: "Active paid", provider: "asc", numeric: true },
      { key: "activeTrials", label: "Active trials", provider: "asc", numeric: true },
    ],
    rows: [...(dataset.revenue ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map((d) => ({ ...d, proceedsUsd: d.proceedsUsd.toFixed(2) })),
    ...(dataset.coverage.revenue !== "observed" ? { unavailable: "Purchase and subscription reports come with Analytics Reports. Enable them for this app in Settings." } : {}),
  };

  return [appsTable, versionsTable, readinessTable, analyticsTable, salesTable, revenueTable];
}

/** Readiness for the sample app, so the demo shows every table. */
export function demoReadiness(dataset: AppDataset): ReadinessResult {
  return { ok: true, apps: [{ id: dataset.app.id, name: dataset.app.name, iconUrl: null, analytics: "ready" }] };
}
