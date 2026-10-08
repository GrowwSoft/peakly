"use server";

import { refresh } from "next/cache";
import { refreshDataset } from "@/core/dataset";
import { buildPortfolio } from "@/core/portfolio";
import { RANGES } from "@/core/ranges";
import { assertCanManageConnections } from "@/lib/server/access";
import { getApps } from "@/lib/server/apps";
import { loadAscCredentials } from "@/lib/server/connections";
import { authFromCredentials, nodePlatform } from "@/lib/server/platform";

/** Ask Apple now instead of waiting for the next expected publish. */
export async function refreshReports(form: FormData): Promise<void> {
  await assertCanManageConnections();
  const state = await getApps();
  const credentials = loadAscCredentials();
  if (state.mode !== "live" || !credentials) return;
  const app = state.apps.find((a) => a.id === form.get("app"));
  const range = Number(form.get("range"));
  if (!(RANGES as readonly number[]).includes(range)) return;
  const auth = authFromCredentials(credentials);
  if (app) await refreshDataset(nodePlatform, auth, app, range);
  else await buildPortfolio(nodePlatform, auth, state.apps, range, { refresh: true });
  refresh();
}
