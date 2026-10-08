import { AscError, createAscClient } from "./asc/client";
import type { AscAuth, Platform } from "./platform";

const API_ORIGIN = "https://api.appstoreconnect.apple.com";

export type AnalyticsActivationPlan = {
  appId: string;
  appName: string;
  status: "already_enabled" | "stopped" | "missing";
};

async function requestPlan(platform: Platform, auth: AscAuth, appId: string): Promise<AnalyticsActivationPlan> {
  if (!/^\d+$/.test(appId)) throw new Error("Choose an app from your connected account.");

  const client = createAscClient(auth, platform.fetch);
  const app = await client.json<{ data: { id: string; attributes: { name: string } } }>(`/v1/apps/${appId}?fields[apps]=name`);
  if (app.data.id !== appId || !app.data.attributes.name) throw new Error("Apple returned an unexpected app.");

  const requests = await client.all<{ attributes: { accessType: string; stoppedDueToInactivity?: boolean } }>(`/v1/apps/${appId}/analyticsReportRequests`);
  const ongoing = requests.filter((r) => r.attributes.accessType === "ONGOING");
  const status = ongoing.some((r) => !r.attributes.stoppedDueToInactivity)
    ? "already_enabled"
    : ongoing.length ? "stopped" : "missing";
  return { appId, appName: app.data.attributes.name, status };
}

/** Read-only preview. The supplied Admin key is used in memory and never saved. */
export function previewAnalyticsActivation(platform: Platform, adminAuth: AscAuth, appId: string) {
  return requestPlan(platform, adminAuth, appId);
}

/** Create exactly one ongoing request, after the UI has shown the plan and the user confirms. */
export async function createAnalyticsActivation(
  platform: Platform,
  adminAuth: AscAuth,
  approved: Pick<AnalyticsActivationPlan, "appId" | "appName">,
): Promise<"requested" | "already_enabled"> {
  const current = await requestPlan(platform, adminAuth, approved.appId);
  if (current.appName !== approved.appName) throw new Error("The app changed since the preview. Review it again before continuing.");
  if (current.status === "already_enabled") return "already_enabled";

  const url = new URL("/v1/analyticsReportRequests", API_ORIGIN);
  const response = await platform.fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await adminAuth.token()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: approved.appId } } },
      },
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let detail = response.statusText;
    try {
      const body = await response.json() as { errors?: { code?: string; title?: string; detail?: string }[] };
      const first = body.errors?.[0];
      code = first?.code ?? code;
      detail = first?.detail ?? first?.title ?? detail;
    } catch { /* Keep the HTTP status if Apple returned no JSON body. */ }
    throw new AscError(response.status, code, detail);
  }
  return "requested";
}
