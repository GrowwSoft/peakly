#!/usr/bin/env node
/**
 * Enable App Store Connect Analytics Reports for apps that don't have them yet.
 *
 * Run this on YOUR machine with an Admin team key. The key never leaves this process
 * and is never given to the Peakly / Growth Insights server, which stays read-only.
 *
 *   ASC_ISSUER_ID=... ASC_KEY_PATH=./AuthKey_XXXXXXXXXX.p8 \
 *     node scripts/enable-analytics-reports.mjs <appId> [<appId> ...]
 *
 * ASC_KEY_ID is read from the AuthKey_<KEYID>.p8 file name unless set explicitly.
 * It previews every app first and creates nothing until you type "yes".
 * Apple usually starts delivering reports 24–48 hours after a request is created.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";

const API = "https://api.appstoreconnect.apple.com";
const { ASC_ISSUER_ID: issuerId, ASC_KEY_PATH: keyPath } = process.env;
const appIds = process.argv.slice(2).filter((a) => /^\d+$/.test(a));

if (!issuerId || !keyPath || appIds.length === 0) {
  console.error("Usage: ASC_ISSUER_ID=<uuid> ASC_KEY_PATH=<AuthKey_XXXX.p8> node scripts/enable-analytics-reports.mjs <appId> [...]");
  process.exit(2);
}
const keyId = process.env.ASC_KEY_ID ?? /AuthKey_([A-Z0-9]{8,12})\.p8$/i.exec(basename(keyPath))?.[1]?.toUpperCase();
if (!keyId) {
  console.error("Set ASC_KEY_ID: it couldn't be read from the key's file name.");
  process.exit(2);
}
const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));

function token() {
  const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({ aud: "appstoreconnect-v1", iss: issuerId, iat, exp: iat + 600 })}`;
  return `${head}.${sign("sha256", Buffer.from(head), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.errors?.[0];
    throw new Error(`${res.status} ${e?.code ?? ""} ${e?.detail ?? e?.title ?? res.statusText}`.trim());
  }
  return json;
}

// 1. Preview (read-only)
const plan = [];
for (const id of appIds) {
  try {
    const app = await api("GET", `/v1/apps/${id}?fields[apps]=name`);
    const requests = await api("GET", `/v1/apps/${id}/analyticsReportRequests`);
    const ongoing = requests.data.filter((r) => r.attributes.accessType === "ONGOING");
    const active = ongoing.some((r) => !r.attributes.stoppedDueToInactivity);
    const status = active ? "already enabled" : ongoing.length ? "stopped (will request again)" : "missing";
    plan.push({ id, name: app.data.attributes.name, create: !active, status });
  } catch (e) {
    plan.push({ id, name: "?", create: false, status: `can't read: ${e.message}` });
  }
}
console.log("\nAnalytics Reports status:");
for (const p of plan) console.log(`  ${p.create ? "+" : " "} ${p.name} (${p.id}): ${p.status}`);
const todo = plan.filter((p) => p.create);
if (todo.length === 0) {
  console.log("\nNothing to do.");
  process.exit(0);
}

// 2. Explicit confirmation
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question(`\nCreate an ongoing Analytics Reports request for ${todo.length} app(s)? Type "yes" to continue: `)).trim().toLowerCase();
rl.close();
if (answer !== "yes") {
  console.log("Cancelled. Nothing was created.");
  process.exit(0);
}

// 3. Create, reporting each result
let failed = 0;
for (const p of todo) {
  try {
    await api("POST", "/v1/analyticsReportRequests", {
      data: { type: "analyticsReportRequests", attributes: { accessType: "ONGOING" }, relationships: { app: { data: { type: "apps", id: p.id } } } },
    });
    console.log(`  ✓ ${p.name}: requested`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${p.name}: ${e.message}`);
  }
}
console.log(failed ? `\n${failed} request(s) failed. You can re-run safely; enabled apps are skipped.` : "\nDone. Reports usually appear within 24–48 hours.");
process.exit(failed ? 1 : 0);
