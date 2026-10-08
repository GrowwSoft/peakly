import Link from "next/link";
import { connection } from "next/server";
import { DataExplorer } from "@/components/data-explorer";
import { Notice } from "@/components/notice";
import { RangeSelect } from "@/components/range-select";
import { buildDataset } from "@/core/dataset";
import { buildPortfolio } from "@/core/portfolio";
import { REPORT_TABS } from "@/core/report-tables";
import { loadReportTableAction } from "./actions";
import { demoDataset } from "@/core/demo";
import { buildExplorerTables, demoReadiness } from "@/core/explorer";
import { RANGES } from "@/core/ranges";
import { getApps, getReadiness } from "@/lib/server/apps";
import { loadAscCredentials } from "@/lib/server/connections";
import { authFromCredentials, nodePlatform } from "@/lib/server/platform";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TablesPage({ searchParams }: PageProps<"/tables">) {
  await connection();
  const sp = await searchParams;
  const range = (RANGES as readonly number[]).includes(Number(one(sp.range))) ? Number(one(sp.range)) : 28;
  const state = await getApps();
  if (state.mode === "error") {
    return <Notice tone="error" title="Couldn't load your App Store Connect account">{state.message} <Link href="/settings" className="font-medium text-accent underline">Check your keys in Settings</Link>.</Notice>;
  }
  if (state.mode === "demo") {
    const dataset = demoDataset(range);
    return <DataExplorer appName="the sample app" tables={buildExplorerTables({ apps: [dataset.app], dataset, readiness: demoReadiness(dataset) })} lazy={REPORT_TABS} controls={<RangeSelect key="range" value={range} />} />;
  }
  const app = state.apps.find((a) => a.id === one(sp.app)); // none chosen: all apps together
  const credentials = loadAscCredentials();
  if (state.apps.length === 0 || !credentials) return <Notice tone="info" title="No apps found">This key can&apos;t see any apps.</Notice>;
  const auth = authFromCredentials(credentials);
  const [dataset, readiness] = await Promise.all([
    (app ? buildDataset(nodePlatform, auth, app, range) : buildPortfolio(nodePlatform, auth, state.apps, range)).then((s) => s.dataset),
    getReadiness(),
  ]);
  return (
    <DataExplorer key={`${app?.id ?? "all"}|${range}`} appName={app ? app.name : "all apps"} tables={buildExplorerTables({ apps: state.apps, dataset, readiness })}
      lazy={REPORT_TABS} loadLazy={loadReportTableAction.bind(null, app?.id ?? null, range)}
      controls={<RangeSelect key="range" value={range} />} />
  );
}
