import Link from "next/link";
import { connection } from "next/server";
import { refreshReports } from "./actions";
import { Dashboard, type Freshness } from "@/components/dashboard";
import { Notice } from "@/components/notice";
import { RangeSelect } from "@/components/range-select";
import { demoDataset } from "@/core/demo";
import { buildDataset, type StoredDataset } from "@/core/dataset";
import { buildPortfolio } from "@/core/portfolio";
import type { Grain } from "@/core/insights/metrics";
import type { AppDataset } from "@/core/insights/types";
import { RANGES } from "@/core/ranges";
import { getApps } from "@/lib/server/apps";
import { loadAscCredentials } from "@/lib/server/connections";
import { authFromCredentials, nodePlatform } from "@/lib/server/platform";

/** Request time (after `connection()`), for "Updated 7:12 AM" and the next expected publish. */
const freshnessOf = (stored: StoredDataset): Freshness => ({ checkedAt: stored.checkedAt, nextCheckAt: stored.nextCheckAt, now: Date.now() });

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function GrowthInsightsPage({ searchParams }: PageProps<"/">) {
  await connection(); // reports, saved keys and "today" are all request-time
  const sp = await searchParams;
  const range = (RANGES as readonly number[]).includes(Number(one(sp.range))) ? Number(one(sp.range)) : 28;
  const grain: Grain = one(sp.grain) === "week" ? "week" : one(sp.grain) === "month" ? "month" : "day";
  const state = await getApps();

  if (state.mode === "error") {
    return (
      <Notice tone="error" title="Couldn't load your App Store Connect account">
        {state.message} <Link href="/settings" className="font-medium text-accent underline">Check your keys in Settings</Link>.
      </Notice>
    );
  }

  let dataset: AppDataset;
  let freshness: Freshness | undefined;
  if (state.mode === "live") {
    const app = state.apps.find((a) => a.id === one(sp.app)); // none chosen: all apps together
    const credentials = loadAscCredentials();
    if (state.apps.length === 0 || !credentials) return <Notice tone="info" title="No apps found">This key can&apos;t see any apps. Check its access in App Store Connect.</Notice>;
    const auth = authFromCredentials(credentials);
    const stored = app ? await buildDataset(nodePlatform, auth, app, range) : await buildPortfolio(nodePlatform, auth, state.apps, range);
    dataset = stored.dataset;
    freshness = freshnessOf(stored);
  } else {
    dataset = demoDataset(range);
  }

  const grainHref = (g: Grain) => {
    const next = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    next.set("grain", g);
    return `?${next}`;
  };

  return (
    <Dashboard
      dataset={dataset}
      range={range}
      grain={grain}
      rangeControl={<RangeSelect value={range} />}
      renderGrain={(g, { className, active, children }) => (
        <Link key={g} href={grainHref(g)} aria-current={active ? "true" : undefined} className={className}>{children}</Link>
      )}
      settingsLink={(children) => <Link href="/settings" className="font-medium text-accent underline">{children}</Link>}
      freshness={freshness}
      refreshControl={
        <form action={refreshReports} className="inline">
          <input type="hidden" name="app" value={dataset.app.id} />
          <input type="hidden" name="range" value={range} />
          <button type="submit" className="font-medium text-accent underline">Refresh now</button>
        </form>
      }
    />
  );
}
