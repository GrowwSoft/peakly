import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDataset, listApps } from "@/core/dataset";
import { getReadiness } from "@/core/readiness";
import { createAscClient } from "@/core/asc/client";
import { authFromCredentials, nodePlatform } from "@/lib/server/platform";
import { diagnose } from "@/core/insights/diagnose";
import { kpis, totals, windows } from "@/core/insights/metrics";

/**
 * Read-only smoke test with a real key held in memory only (never saved by the app).
 * GI_SMOKE_ASC_CONFIG points at a JSON file with APP_STORE_CONNECT_ISSUER_ID, _KEY_ID,
 * _PRIVATE_KEY_PATH and vendorNumber. Prints aggregates only.
 */
const configPath = process.env.GI_SMOKE_ASC_CONFIG;
describe.skipIf(!configPath)("live App Store Connect", () => {
  it("builds a dataset for one app", async () => {
    const c = JSON.parse(readFileSync(configPath!, "utf8"));
    const credentials = {
      issuerId: c.APP_STORE_CONNECT_ISSUER_ID, keyId: c.APP_STORE_CONNECT_KEY_ID,
      privateKey: readFileSync(c.APP_STORE_CONNECT_PRIVATE_KEY_PATH, "utf8"), vendorNumber: String(c.vendorNumber),
    };
    const apps = await listApps(nodePlatform, authFromCredentials(credentials));
    console.log("apps:", apps.map((a) => `${a.name} (${a.iconUrl ? "icon" : "no icon"})`).join(", "));
    const app = apps.find((a) => a.id === (process.env.GI_SMOKE_APP_ID ?? "")) ?? apps[0]!;
    const started = Date.now();
    const { dataset: data } = await buildDataset(nodePlatform, authFromCredentials(credentials), app, 28, { refresh: true });
    console.log("app:", app.name, "| took", Math.round((Date.now() - started) / 1000), "s");
    console.log("coverage:", JSON.stringify(data.coverage));
    console.log("releases:", JSON.stringify(data.releases.slice(0, 3)));
    if (data.coverage.analyticsThrough) {
      const { current, previous } = windows(data.coverage.analyticsThrough, 28);
      console.log("window:", current, "totals:", JSON.stringify(totals(data.metrics, current)));
      console.log("kpis:", JSON.stringify(kpis(data.metrics, current, previous).map((k) => [k.key, k.value, k.change])));
      console.log("insights:", diagnose(data.metrics, data.sales, current, data.coverage).map((i) => i.title).join(" | "));
    }
    const sold = data.sales.filter((d) => d.status === "available");
    console.log("sales days:", sold.length, "pending:", data.coverage.salesPendingDates.length, "app units:", sold.reduce((s, d) => s + d.appUnits, 0), "paid:", sold.reduce((s, d) => s + d.paidUnits, 0));
    expect(apps.length).toBeGreaterThan(0);
  });

  it("lists every app with its analytics readiness", async () => {
    const c = JSON.parse(readFileSync(configPath!, "utf8"));
    const credentials = {
      issuerId: c.APP_STORE_CONNECT_ISSUER_ID, keyId: c.APP_STORE_CONNECT_KEY_ID,
      privateKey: readFileSync(c.APP_STORE_CONNECT_PRIVATE_KEY_PATH, "utf8"), vendorNumber: "",
    };
    const result = await getReadiness(nodePlatform, authFromCredentials(credentials));
    console.log("readiness:", JSON.stringify(result.ok ? result.apps.map((a) => [a.name, a.analytics]) : result));
    expect(result.ok).toBe(true);
  });

  it("reports which hosts serve analytics report files (for the desktop network allowlist)", async () => {
    const c = JSON.parse(readFileSync(configPath!, "utf8"));
    const auth = authFromCredentials({ issuerId: c.APP_STORE_CONNECT_ISSUER_ID, keyId: c.APP_STORE_CONNECT_KEY_ID, privateKey: readFileSync(c.APP_STORE_CONNECT_PRIVATE_KEY_PATH, "utf8"), vendorNumber: "" });
    const client = createAscClient(auth);
    const appId = process.env.GI_SMOKE_APP_ID ?? (await listApps(nodePlatform, auth))[0]!.id;
    const requests = await client.all<{ id: string; attributes: { accessType: string } }>(`/v1/apps/${appId}/analyticsReportRequests`);
    const ongoing = requests.find((r) => r.attributes.accessType === "ONGOING");
    if (!ongoing) return;
    const reports = await client.all<{ id: string; attributes: { name: string } }>(`/v1/analyticsReportRequests/${ongoing.id}/reports`, 20);
    const report = reports.find((r) => r.attributes.name === "App Downloads Standard")!;
    const instances = await client.all<{ id: string }>(`/v1/analyticsReports/${report.id}/instances?limit=5`, 1);
    const segments = await client.all<{ attributes: { url: string } }>(`/v1/analyticsReportInstances/${instances[0]!.id}/segments`);
    console.log("segment hosts:", [...new Set(segments.map((s) => new URL(s.attributes.url).hostname))].join(", "));
  });
});
