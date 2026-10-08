import type { ReactNode } from "react";
import { InsightCard } from "./insight-card";
import { KpiCard } from "./kpi-card";
import { RevenueSection } from "./revenue-section";
import { Notice } from "./notice";
import { SourceTable } from "./source-table";
import { TrendCharts, type AppLine } from "./trend-charts";
import { shortDate } from "@/core/format";
import { diagnose, INSIGHT_POLICY } from "@/core/insights/diagnose";
import { isoDate, kpis, series, totals, windows, type Grain, type Window } from "@/core/insights/metrics";
import type { AppDataset } from "@/core/insights/types";
import { ALL_APPS } from "@/core/all-apps";

const EXCLUDED_REASON: Record<string, string> = {
  pending: "waiting for Apple's first reports",
  not_enabled: "analytics not enabled",
  error: "couldn't load",
  unavailable: "unavailable",
};

const APP_COLORS = ["var(--app-1)", "var(--app-2)", "var(--app-3)", "var(--app-4)", "var(--app-5)", "var(--app-6)"];

/** Each app with store analytics as its own impressions line. Past six colors, the rest fold into "Other apps". */
function appLinesFor(dataset: AppDataset, window: Window, grain: Grain): AppLine[] {
  const members = dataset.members ?? [];
  const lines: AppLine[] = [];
  const other: string[] = [];
  members.forEach((member, index) => {
    if (!dataset.metrics.some((m) => m.app === member.name)) return;
    if (index >= APP_COLORS.length) { other.push(member.name); return; }
    lines.push({ name: member.name, iconUrl: member.iconUrl, color: APP_COLORS[index]!, impressions: series(dataset.metrics.filter((m) => m.app === member.name), window, grain).map((p) => p.impressions) });
  });
  if (other.length) {
    lines.push({ name: "Other apps", iconUrl: null, color: "var(--app-other)", impressions: series(dataset.metrics.filter((m) => m.app && other.includes(m.app)), window, grain).map((p) => p.impressions) });
  }
  return lines;
}

export const GRAINS: readonly Grain[] = ["day", "week", "month"];

/**
 * The Growth insights screen, shared by the web app and the Mac app. It has no
 * framework imports: each host supplies its own range picker, grain links/buttons
 * and Settings link.
 */
export interface Freshness {
  /** When Apple was last asked. */
  checkedAt: number;
  /** When Apple could next have something new. */
  nextCheckAt: number;
  /** "Now" when this was produced, so rendering stays pure. */
  now: number;
  /** A background check is running right now. */
  checking?: boolean;
  /** The last check failed; the data shown is from `checkedAt`. */
  error?: string;
}

const clock = (ms: number, now: number) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
};

/** "Updated 7:12 AM · next check after 1:00 PM" with the host's refresh control. */
function FreshnessLine({ freshness, refreshControl }: { freshness: Freshness; refreshControl?: ReactNode }) {
  const { now } = freshness;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-3" role="status" aria-label="Data freshness">
      <span>Updated {clock(freshness.checkedAt, now)}</span>
      <span aria-hidden>·</span>
      <span className={freshness.error ? "text-bad" : undefined}>{freshness.checking ? "Checking Apple for new data…" : freshness.error ? `Couldn't reach Apple: ${freshness.error}` : freshness.nextCheckAt > now ? `Apple's next data expected after ${clock(freshness.nextCheckAt, now)}` : "New data may be available"}</span>
      {refreshControl && !freshness.checking && <><span aria-hidden>·</span>{refreshControl}</>}
    </div>
  );
}

export function Dashboard({
  dataset, range, grain, rangeControl, renderGrain, settingsLink, freshness, refreshControl,
}: {
  dataset: AppDataset;
  range: number;
  grain: Grain;
  rangeControl: ReactNode;
  /** When the data was fetched and when Apple could next have more. Not shown for sample data. */
  freshness?: Freshness;
  /** A "Refresh now" button or form, styled as a link. */
  refreshControl?: ReactNode;
  renderGrain: (grain: Grain, props: { className: string; active: boolean; children: ReactNode }) => ReactNode;
  settingsLink: (children: ReactNode) => ReactNode;
}) {
  const latest = dataset.coverage.analyticsThrough ?? isoDate(Date.parse(dataset.generatedAt) - 3 * 86_400_000);
  const { current, previous } = windows(latest, range);
  const cards = kpis(dataset.metrics, current, previous);
  const pageViews = totals(dataset.metrics, current).pageViews ?? 0;
  const points = series(dataset.metrics, current, grain);
  const insights = diagnose(dataset.metrics, dataset.sales, current, dataset.coverage, dataset.revenue, dataset.outcomes);
  // All apps: one line per app, colored by the app's place in the account (never by rank), so colors stay put.
  const appLines: AppLine[] = dataset.app.id === ALL_APPS && dataset.members
    ? appLinesFor(dataset, current, grain)
    : [];
  const markers = grain === "day"
    ? dataset.releases.filter((r) => r.releasedAt && !r.app).map((r) => ({ date: r.releasedAt!.slice(0, 10), label: `v${r.version}` }))
    : [];

  return (
    <div className="mx-auto max-w-[1240px]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink sm:text-[44px]">Growth insights</h1>
          <p className="mt-2 text-[17px] text-ink-2">Understand what&apos;s driving {dataset.demo ? "your app" : dataset.app.id === ALL_APPS ? "your apps" : dataset.app.name}&apos;{dataset.app.id === ALL_APPS ? "" : "s"} growth and get a clear next step.</p>
          {freshness && !dataset.demo && <FreshnessLine freshness={freshness} refreshControl={refreshControl} />}
        </div>
        {rangeControl}
      </header>

      {dataset.demo && (
        <Notice tone="info" title="You're looking at sample data">
          Connect a read-only App Store Connect key in {settingsLink("Settings")} to see your own apps.
        </Notice>
      )}
      {dataset.coverage.analytics !== "observed" && !dataset.demo && (
        <Notice tone={dataset.coverage.analytics === "pending" ? "info" : "warn"}
          title={dataset.coverage.analytics === "pending" ? "Waiting for Apple’s first reports" : "Store analytics unavailable"}>
          {dataset.coverage.analyticsDetail}{dataset.coverage.analytics === "pending" && " Peakly checks again while it’s open."}{dataset.coverage.analytics === "not_enabled" && <> {settingsLink("Enable analytics in Settings")}</>}
        </Notice>
      )}
      {dataset.coverage.sales === "error" && <Notice tone="warn" title="Sales reports unavailable">{dataset.coverage.salesDetail}</Notice>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {cards.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} thin={kpi.key === "conversion" && pageViews < INSIGHT_POLICY.minPageViews} />)}
      </div>

      <section className="mt-5 rounded-2xl border border-line bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">Impressions and conversion rate{appLines.length > 0 && <span className="font-normal text-ink-3"> · all apps averaged</span>}</h2>
            <p className="mt-1 text-sm text-ink-3">{shortDate(current.start)} – {shortDate(current.end)}</p>
            {appLines.length > 0 && <p className="mt-1 max-w-xl text-sm text-ink-3">The blue area adds up impressions across apps; the green line is conversion averaged across apps, weighted by page views. Each app&apos;s impressions are drawn in its own color.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <span className="flex items-center gap-2 text-sm text-ink-2"><span className="size-2.5 rounded-full bg-[var(--series-1)]" />{appLines.length ? "Total impressions" : "Impressions"}</span>
            <span className="flex items-center gap-2 text-sm text-ink-2"><span className="size-2.5 rounded-full bg-[var(--series-3)]" />{appLines.length ? "Average conversion rate" : "Conversion rate"}</span>
            <div className="flex rounded-xl bg-card-muted p-1 ring-1 ring-line" role="group" aria-label="Granularity">
              {GRAINS.map((g) => renderGrain(g, {
                active: grain === g,
                className: `rounded-lg px-4 py-1.5 text-sm capitalize ${grain === g ? "bg-card font-semibold text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`,
                children: g,
              }))}
            </div>
          </div>
        </div>
        <div className="mt-2">
          <TrendCharts points={points} markers={markers} grain={grain} apps={appLines} />
        </div>
      </section>

      {insights.length > 0 && (
        <div className={`mt-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0 ${insights.length >= 3 ? "2xl:grid-cols-3" : ""}`}>
          {insights.map((insight, i) => <InsightCard key={insight.id} insight={insight} index={i} />)}
        </div>
      )}

      {/* Coverage notes come after the insights, so the first thing people read is what to do. */}
      {dataset.coverage.excludedApps && dataset.coverage.excludedApps.length > 0 && dataset.coverage.analytics === "observed" && (
        <Notice tone="info" title={`Store analytics cover ${dataset.coverage.excludedApps.length === 1 ? "all but 1 app" : `all but ${dataset.coverage.excludedApps.length} apps`}`}>
          Totals add up every app that reports store analytics; rates come from the combined counts. Not included yet: {dataset.coverage.excludedApps.map((a) => `${a.name} (${EXCLUDED_REASON[a.reason]})`).join(", ")}.
        </Notice>
      )}
      {dataset.coverage.analyticsFrom && dataset.coverage.analyticsFrom > previous.start && (
        <Notice tone="info" title={`Apple has store analytics for ${dataset.app.id === ALL_APPS ? "these apps" : "this app"} from ${shortDate(dataset.coverage.analyticsFrom)}`}>
          Earlier days are unknown, not zero, so {dataset.coverage.analyticsFrom > current.start ? "this period is partial and " : ""}comparisons with the previous period may be unavailable. History builds up here as Apple publishes new days.
        </Notice>
      )}

      {dataset.coverage.revenue === "observed" && dataset.revenue && <RevenueSection revenue={dataset.revenue} window={current} />}

      <div className="mt-5 grid gap-5 xl:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <SourceTable rows={dataset.metrics} window={current} />
        <section className="rounded-2xl border border-line bg-card p-6 text-sm">
          <h2 className="text-lg font-semibold text-ink">Data coverage</h2>
          <dl className="mt-4 space-y-3 text-ink-2">
            <div><dt className="text-ink-3">Store analytics</dt><dd>{dataset.coverage.analytics === "observed" ? `${dataset.coverage.analyticsFrom ? `${shortDate(dataset.coverage.analyticsFrom)} – ` : "Through "}${shortDate(dataset.coverage.analyticsThrough!)}` : dataset.coverage.analytics.replace("_", " ")}</dd></div>
            <div><dt className="text-ink-3">Sales reports</dt><dd>{dataset.coverage.sales === "observed" ? (dataset.coverage.salesPendingDates.length ? `${dataset.coverage.salesPendingDates.length} day(s) not published yet` : "Up to date") : dataset.coverage.sales === "unavailable" ? "Not configured (add a vendor number in Settings)" : dataset.coverage.sales}</dd></div>
            <div><dt className="text-ink-3">Purchases and subscriptions</dt><dd>{dataset.coverage.revenue === "observed" ? (dataset.coverage.revenueThrough ? `Through ${shortDate(dataset.coverage.revenueThrough)}` : "Waiting for Apple's first reports") : "Not available"}</dd></div>
            <div><dt className="text-ink-3">Comparison</dt><dd>{shortDate(previous.start)} – {shortDate(previous.end)}</dd></div>
            <div><dt className="text-ink-3">Testers</dt><dd>Not counted. Apple leaves TestFlight, App Review and sandbox purchases out of these reports.</dd></div>
          </dl>
          <p className="mt-5 leading-relaxed text-ink-3">
            Conversion rate is App Store Connect&apos;s: total downloads (first-time and redownloads) divided by unique-device impressions. Apple&apos;s reports give unique devices per day, so over longer ranges it can read a little lower than App Store Connect, which may count a device once per period. Other counts are App Store events, not unique people. Days Apple hasn&apos;t published are shown as gaps, never as zero. Apple can still revise the last 3 days of store data and the last 5 days of usage data.
          </p>
        </section>
      </div>
    </div>
  );
}
