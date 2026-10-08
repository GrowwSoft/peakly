import { AscError, createAscClient } from "./asc/client";
import type { AscCredentials } from "./asc/jwt";
import { ascCredentialsSchema } from "./credentials";
import { addDays, isoDate } from "./insights/metrics";
import { keyIdFromFileName } from "./key-file";
import type { AscAuth, Platform } from "./platform";
import type { CheckResult, SaveState } from "./settings-types";

/** Plain-language message for an App Store Connect failure. */
export function describeAscError(e: unknown): string {
  return e instanceof AscError
    ? e.status === 401 ? "Apple rejected the key (401). Check the issuer ID, key ID and private key."
      : e.status === 403 ? "The key doesn't have access to this (403)."
      : `${e.code}: ${e.message}`
    : "Could not reach App Store Connect.";
}

/**
 * Validate the connection form. Accepts an uploaded `privateKeyFile` or a
 * `privateKey` text field; the Key ID falls back to the AuthKey_<KEYID>.p8 file name.
 */
export async function parseConnectionForm(form: FormData): Promise<{ ok: true; credentials: AscCredentials; values: NonNullable<SaveState["values"]> } | { ok: false; state: SaveState }> {
  const file = form.get("privateKeyFile");
  const uploaded = typeof File !== "undefined" && file instanceof File && file.size > 0 ? file : null;
  const privateKey = uploaded ? await uploaded.text() : String(form.get("privateKey") ?? "");
  const keyId = String(form.get("keyId") ?? "").trim() || keyIdFromFileName(uploaded?.name) || "";
  const values = { issuerId: String(form.get("issuerId") ?? ""), keyId, vendorNumber: String(form.get("vendorNumber") ?? "") };
  const parsed = ascCredentialsSchema.safeParse({ issuerId: form.get("issuerId"), keyId, privateKey, vendorNumber: form.get("vendorNumber") ?? "" });
  if (!parsed.success) {
    const fieldErrors: SaveState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof NonNullable<SaveState["fieldErrors"]>] = issue.message;
    return { ok: false, state: { ok: false, message: "Check the highlighted fields.", fieldErrors, values } };
  }
  return { ok: true, credentials: parsed.data, values };
}

/** Read-only proof that a key works, before anything is stored. Returns an error message or null. */
export async function verifyKey(platform: Platform, auth: AscAuth): Promise<string | null> {
  try {
    await createAscClient(auth, platform.fetch).json("/v1/apps?limit=1&fields[apps]=name");
    return null;
  } catch (e) {
    return describeAscError(e);
  }
}

export function parseVendorNumber(form: FormData): string | null {
  const parsed = ascCredentialsSchema.shape.vendorNumber.safeParse(String(form.get("vendorNumber") ?? "").trim());
  return parsed.success && parsed.data ? parsed.data : null;
}

/** Read-only proof that Apple accepts a vendor number for sales reports. Returns an error message or null. */
export async function verifyVendor(platform: Platform, auth: AscAuth): Promise<string | null> {
  try {
    await createAscClient(auth, platform.fetch).salesReport(addDays(isoDate(Date.now()), -3));
    return null;
  } catch (e) {
    return describeAscError(e);
  }
}

/** Read-only health check of every report the dashboard uses. Checks every app, four at a time. */
export async function checkConnection(platform: Platform, auth: AscAuth): Promise<CheckResult[]> {
  const client = createAscClient(auth, platform.fetch);
  const results: CheckResult[] = [];

  let apps: { id: string; attributes: { name: string } }[] = [];
  try {
    apps = await client.all("/v1/apps?fields[apps]=name&limit=200");
    results.push({ label: "Apps", status: apps.length ? "pass" : "warn", detail: `${apps.length} app(s) visible to this key.` });
  } catch (e) {
    results.push({ label: "Apps", status: "fail", detail: describeAscError(e) });
    return results;
  }

  const probeDate = addDays(isoDate(Date.now()), -3);
  if (!auth.vendorNumber) {
    results.push({ label: "Sales reports", status: "warn", detail: "Not configured. Add a vendor number to include download units and sales." });
  } else try {
    const sales = await client.salesReport(probeDate);
    results.push({ label: "Sales reports", status: "pass", detail: sales.status === "available" ? `Report for ${probeDate} downloaded.` : sales.status === "no_sales" ? `Accessible; no sales on ${probeDate}.` : sales.status === "pending" ? `Accessible; ${probeDate} not published yet.` : `Accessible; Apple didn't return a report for ${probeDate}.` });
  } catch (e) {
    results.push({ label: "Sales reports", status: "fail", detail: describeAscError(e) });
  }

  const missing: string[] = [];
  let checked = 0;
  let failed = 0;
  let denied = false;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, apps.length) }, async () => {
    while (next < apps.length && !denied) {
      const app = apps[next++]!;
      try {
        const requests = await client.all<{ attributes: { accessType: string; stoppedDueToInactivity?: boolean } }>(`/v1/apps/${app.id}/analyticsReportRequests`);
        checked++;
        if (!requests.some((r) => r.attributes.accessType === "ONGOING" && !r.attributes.stoppedDueToInactivity)) missing.push(app.attributes.name);
      } catch (e) {
        if (e instanceof AscError && e.status === 403) denied = true;
        else failed++;
      }
    }
  }));
  if (denied) {
    results.push({ label: "Analytics reports", status: "fail", detail: "This key can't read Analytics Reports (403)." });
  } else {
    const parts = [`${checked - missing.length} of ${checked} app(s) have ongoing analytics reports enabled.`];
    if (missing.length) parts.push(`Missing: ${missing.sort().join(", ")}.`);
    if (failed) parts.push(`${failed} app(s) couldn't be checked; try again.`);
    results.push({ label: "Analytics reports", status: missing.length || failed ? "warn" : "pass", detail: parts.join(" ") });
  }
  return results;
}
