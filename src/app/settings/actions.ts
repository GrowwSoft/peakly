"use server";

import { revalidatePath } from "next/cache";
import { checkConnection, parseConnectionForm, parseVendorNumber, verifyKey, verifyVendor } from "@/core/connection";
import type { CheckResult, SaveState } from "@/core/settings-types";
import { assertCanManageConnections } from "@/lib/server/access";
import { forgetApps } from "@/lib/server/apps";
import { loadAscCredentials, removeAscCredentials, saveAscCredentials, setVendorNumber } from "@/lib/server/connections";
import { authFromCredentials, nodePlatform } from "@/lib/server/platform";

export async function saveAppStoreConnect(_prev: SaveState, form: FormData): Promise<SaveState> {
  try { await assertCanManageConnections(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const parsed = await parseConnectionForm(form);
  if (!parsed.ok) return parsed.state;
  const problem = await verifyKey(nodePlatform, authFromCredentials(parsed.credentials));
  if (problem) return { ok: false, message: problem, values: parsed.values };
  saveAscCredentials(parsed.credentials);
  forgetApps();
  revalidatePath("/", "layout");
  return { ok: true, message: "Connected. The key is stored encrypted on this server and can't be viewed again." };
}

export async function saveVendorNumber(_prev: SaveState, form: FormData): Promise<SaveState> {
  try { await assertCanManageConnections(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const credentials = loadAscCredentials();
  if (!credentials) return { ok: false, message: "No App Store Connect key saved." };
  const vendorNumber = parseVendorNumber(form);
  if (!vendorNumber) return { ok: false, message: "Vendor number is 6–12 digits, from Payments and Financial Reports." };
  const problem = await verifyVendor(nodePlatform, authFromCredentials({ ...credentials, vendorNumber }));
  if (problem) return { ok: false, message: problem };
  setVendorNumber(vendorNumber);
  revalidatePath("/", "layout");
  return { ok: true, message: "Vendor number saved. Sales reports are now included." };
}

export async function removeAppStoreConnect(): Promise<void> {
  await assertCanManageConnections();
  removeAscCredentials();
  forgetApps();
  revalidatePath("/", "layout");
}

export async function checkAppStoreConnect(): Promise<CheckResult[]> {
  await assertCanManageConnections();
  const credentials = loadAscCredentials();
  if (!credentials) return [{ label: "Key", status: "fail", detail: "No key saved." }];
  return checkConnection(nodePlatform, authFromCredentials(credentials));
}
