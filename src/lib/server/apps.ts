import "server-only";
import type { AppSummary } from "@/core/insights/types";
import { AscError } from "@/core/asc/client";
import { listApps } from "@/core/dataset";
import { getReadiness as coreReadiness, type ReadinessResult } from "@/core/readiness";
import { connectionStatus, loadAscCredentials } from "./connections";
import { authFromCredentials, nodePlatform } from "./platform";
import { assertCanAccessPrivateData } from "./access";

export type AppsState =
  | { mode: "demo" }
  | { mode: "live"; apps: AppSummary[] }
  | { mode: "error"; message: string };

let appsMemo: { at: number; key: string; state: AppsState } | null = null;
let readinessMemo: { at: number; key: string; result: ReadinessResult } | null = null;
const APPS_TTL = 10 * 60_000;
const READINESS_TTL = 5 * 60_000;

/** The connected account's apps, memoized briefly so navigation doesn't call Apple every time. */
export async function getApps(): Promise<AppsState> {
  const status = connectionStatus().appStoreConnect;
  if (!status.configured) return { mode: "demo" };
  await assertCanAccessPrivateData();
  const key = status.keyId + status.savedAt;
  if (appsMemo && appsMemo.key === key && Date.now() - appsMemo.at < APPS_TTL) return appsMemo.state;
  let state: AppsState;
  try {
    const credentials = loadAscCredentials();
    if (!credentials) return { mode: "demo" };
    state = { mode: "live", apps: await listApps(nodePlatform, authFromCredentials(credentials)) };
  } catch (error) {
    state = { mode: "error", message: error instanceof AscError ? `${error.code}: ${error.message}` : "Could not reach App Store Connect." };
  }
  appsMemo = { at: Date.now(), key, state };
  return state;
}

/** Analytics readiness for every app, memoized briefly. Null when no key is saved. */
export async function getReadiness(): Promise<ReadinessResult | null> {
  const status = connectionStatus().appStoreConnect;
  if (!status.configured) return null;
  await assertCanAccessPrivateData();
  const credentials = loadAscCredentials();
  if (!credentials) return null;
  const key = status.keyId + status.savedAt;
  if (readinessMemo && readinessMemo.key === key && Date.now() - readinessMemo.at < READINESS_TTL) return readinessMemo.result;
  const result = await coreReadiness(nodePlatform, authFromCredentials(credentials));
  readinessMemo = { at: Date.now(), key, result };
  return result;
}

export function forgetApps(): void {
  appsMemo = null;
  readinessMemo = null;
}
