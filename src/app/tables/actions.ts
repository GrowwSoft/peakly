"use server";

import type { ExplorerTable } from "@/core/explorer";
import { loadReportTable, REPORT_TABLES } from "@/core/report-tables";
import { RANGES } from "@/core/ranges";
import { assertCanAccessPrivateData } from "@/lib/server/access";
import { getApps } from "@/lib/server/apps";
import { loadAscCredentials } from "@/lib/server/connections";
import { authFromCredentials, nodePlatform } from "@/lib/server/platform";

/** Loads one report table for the Table viewer when its tab is opened. Read-only. */
export async function loadReportTableAction(appId: string | null, range: number, id: string): Promise<ExplorerTable> {
  await assertCanAccessPrivateData();
  const spec = REPORT_TABLES.find((t) => t.id === id);
  const state = await getApps();
  const credentials = loadAscCredentials();
  if (!spec || state.mode !== "live" || !credentials || !(RANGES as readonly number[]).includes(range)) throw new Error("This report isn't available.");
  const app = state.apps.find((a) => a.id === appId);
  return loadReportTable(nodePlatform, authFromCredentials(credentials), app ? [app] : state.apps, spec, range);
}
