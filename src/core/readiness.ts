import { AscError, createAscClient, type AscResource } from "./asc/client";
import { listApps } from "./dataset";
import { DOWNLOADS_REPORT, ENGAGEMENT_REPORT } from "./asc/normalize";
import type { AscAuth, Platform } from "./platform";

export type Readiness = "ready" | "waiting" | "missing" | "stopped" | "unknown";

export interface AppReadiness {
  id: string;
  name: string;
  iconUrl: string | null;
  analytics: Readiness;
}

export type ReadinessResult =
  | { ok: true; apps: AppReadiness[] }
  | { ok: false; message: string };

/**
 * Every app on the account with whether its core Analytics Reports are available yet.
 * Read-only: lists existing report requests, never creates one.
 */
export async function getReadiness(platform: Platform, auth: AscAuth): Promise<ReadinessResult> {
  let result: ReadinessResult;
  try {
    const apps = await listApps(platform, auth);
    const client = createAscClient(auth, platform.fetch);
    const out: AppReadiness[] = apps.map((a) => ({ id: a.id, name: a.name, iconUrl: a.iconUrl, analytics: "unknown" }));
    let next = 0;
    let denied = false;
    await Promise.all(Array.from({ length: Math.min(4, out.length) }, async () => {
      while (next < out.length && !denied) {
        const app = out[next++]!;
        try {
          const requests = await client.all<AscResource<{ accessType: string; stoppedDueToInactivity?: boolean }>>(
            `/v1/apps/${app.id}/analyticsReportRequests`);
          const ongoing = requests.filter((r) => r.attributes.accessType === "ONGOING");
          const active = ongoing.find((r) => !r.attributes.stoppedDueToInactivity);
          if (active) {
            const reports = await client.all<AscResource<{ name: string }>>(`/v1/analyticsReportRequests/${active.id}/reports`);
            const coreReports = [ENGAGEMENT_REPORT, DOWNLOADS_REPORT].map((name) => reports.find((r) => r.attributes.name === name));
            if (coreReports.some((report) => !report)) {
              app.analytics = "waiting";
              continue;
            }
            if (coreReports.every(Boolean)) {
              const published = await Promise.all(coreReports.map((report) => client.all<{ attributes: { granularity: string } }>(
                `/v1/analyticsReports/${report!.id}/instances?limit=200`, 1)));
              app.analytics = published.every((instances) => instances.some((instance) => instance.attributes.granularity === "DAILY"))
                ? "ready" : "waiting";
            } else {
              app.analytics = "waiting";
            }
          } else {
            app.analytics = ongoing.length ? "stopped" : "missing";
          }
        } catch (e) {
          if (e instanceof AscError && e.status === 403) denied = true;
        }
      }
    }));
    result = denied
      ? { ok: false, message: "This key can't read Analytics Reports (403). Use a key with the Sales and Reports role." }
      : { ok: true, apps: out };
  } catch (e) {
    result = { ok: false, message: e instanceof AscError ? `${e.code}: ${e.message}` : "Could not reach App Store Connect." };
  }
  return result;
}
