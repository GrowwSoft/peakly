import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseTsv } from "@/core/asc/tsv";
import { salesForApp } from "@/core/asc/sales";
import { compactRows, dedupeNewest, DOWNLOADS_REPORT, ENGAGEMENT_REPORT, toDailyMetrics } from "@/core/asc/normalize";
import { createAscToken, normalizePrivateKey } from "@/core/asc/jwt";
import { seal, unseal } from "@/lib/server/crypto";
import { keyIdFromFileName } from "@/core/key-file";
import { ascCredentialsSchema } from "@/core/credentials";
import { gunzipText } from "@/core/asc/gzip";
import { assertCacheKey, cachedToken } from "@/core/platform";
import { gzipSync } from "node:zlib";

const SALES_HEADER = ["Provider", "SKU", "Title", "Product Type Identifier", "Units", "Developer Proceeds", "Customer Price", "Currency of Proceeds", "Apple Identifier", "Parent Identifier", "Order Type"].join("\t");
const salesRow = (cells: Record<string, string>) =>
  SALES_HEADER.split("\t").map((h) => cells[h] ?? "").join("\t");

describe("parseTsv", () => {
  it("keeps trailing empty columns instead of flagging the row malformed", () => {
    const tsv = `a\tb\tc\n1\t2\t\n`;
    const parsed = parseTsv(tsv);
    expect(parsed.malformed).toBe(0);
    expect(parsed.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("salesForApp", () => {
  const app = { id: "111", sku: "APP_SKU" };
  const tsv = [
    SALES_HEADER,
    salesRow({ "Product Type Identifier": "1", Units: "3", "Customer Price": "0", "Developer Proceeds": "0", "Currency of Proceeds": "USD", "Apple Identifier": "111" }),
    salesRow({ "Product Type Identifier": "7", Units: "2", "Apple Identifier": "111", "Currency of Proceeds": "USD" }),
    salesRow({ "Product Type Identifier": "IAY", Units: "1", "Customer Price": "4.99", "Developer Proceeds": "4.24", "Currency of Proceeds": "EUR", "Apple Identifier": "999", "Parent Identifier": "APP_SKU" }),
    salesRow({ "Product Type Identifier": "IA1", Units: "-1", "Customer Price": "-2.99", "Developer Proceeds": "2.54", "Currency of Proceeds": "USD", "Apple Identifier": "998", "Parent Identifier": "APP_SKU" }),
    salesRow({ "Product Type Identifier": "1", Units: "9", "Apple Identifier": "222", "Currency of Proceeds": "USD" }),
  ].join("\n");

  it("attributes app rows by Apple ID and purchases by parent SKU", () => {
    const day = salesForApp("2026-10-06", tsv, app);
    expect(day.appUnits).toBe(3);
    expect(day.updateUnits).toBe(2);
    expect(day.paidUnits).toBe(1);
    expect(day.refunds).toBe(1);
    expect(day.proceeds).toEqual({ EUR: 4.24, USD: -2.54 });
  });
});

describe("analytics normalization", () => {
  const engagement = compactRows(ENGAGEMENT_REPORT, [
    { Date: "2026-10-01", Event: "Impression", "Page Type": "No page", "Source Type": "App Store search", Counts: "40", "Unique Counts": "30" },
    { Date: "2026-10-01", Event: "Page view", "Page Type": "Product page", "Source Type": "App Store search", Counts: "6", "Unique Counts": "5" },
    { Date: "2026-10-01", Event: "Tap", "Engagement Type": "Get", "Page Type": "Product page", "Source Type": "App referrer", Counts: "2", "Unique Counts": "2" },
  ]);
  const downloads = compactRows(DOWNLOADS_REPORT, [
    { Date: "2026-10-01", "Download Type": "First-time download", "Page Type": "No page", "Source Type": "App Store search", Counts: "3" },
    { Date: "2026-10-01", "Download Type": "First-time download", "Page Type": "Product page", "Source Type": "App Store search", Counts: "1" },
  ]);

  it("maps events to per-source metrics and fills covered quiet days with zero", () => {
    const metrics = toDailyMetrics([...engagement, ...downloads], new Set(["2026-10-01", "2026-10-02"]));
    const search = metrics.find((m) => m.date === "2026-10-01" && m.source === "search")!;
    expect(search).toMatchObject({ impressions: 40, pageViews: 6, firstDownloads: 4, pageDownloads: 1 });
    expect(metrics.find((m) => m.date === "2026-10-01" && m.source === "app_referrer")!.getTaps).toBe(2);
    expect(metrics.find((m) => m.date === "2026-10-02" && m.source === "search")!.impressions).toBe(0);
  });

  it("keeps the newest instance when Apple restates a row", () => {
    const older = compactRows(ENGAGEMENT_REPORT, [{ Date: "2026-10-01", Event: "Impression", "Source Type": "App Store search", Counts: "40" }]);
    const newer = compactRows(ENGAGEMENT_REPORT, [{ Date: "2026-10-01", Event: "Impression", "Source Type": "App Store search", Counts: "42" }]);
    const rows = dedupeNewest([{ processingDate: "2026-10-02", rows: older }, { processingDate: "2026-10-04", rows: newer }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.counts).toBe(42);
  });
});

describe("credentials", () => {
  it("round-trips sealed secrets and rejects tampering with the context", () => {
    const key = randomBytes(32);
    const sealed = seal("secret", key, "ctx");
    expect(unseal(sealed, key, "ctx")).toBe("secret");
    expect(() => unseal(sealed, key, "other")).toThrow();
  });

  it("creates a verifiable ES256 App Store Connect token", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = await createAscToken({ issuerId: "issuer", keyId: "ABCDEFGHIJ", privateKey: pem.replace(/\n/g, "\\n") }, new Date(0));
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABCDEFGHIJ", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ aud: "appstoreconnect-v1", iss: "issuer", iat: 0, exp: 600 });
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(normalizePrivateKey(pem)), dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("fewer setup inputs", () => {
  it("reads the Key ID from Apple's AuthKey file name", () => {
    expect(keyIdFromFileName("AuthKey_2X9R4HXF34.p8")).toBe("2X9R4HXF34");
    expect(keyIdFromFileName("/Downloads/authkey_ab12cd34ef.p8")).toBe("AB12CD34EF");
    expect(keyIdFromFileName("my-key.p8")).toBeNull();
    expect(keyIdFromFileName(undefined)).toBeNull();
  });

  it("accepts a connection without a vendor number but rejects a malformed one", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const base = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    expect(ascCredentialsSchema.parse({ ...base, vendorNumber: "" }).vendorNumber).toBe("");
    expect(ascCredentialsSchema.parse(base).vendorNumber).toBe("");
    expect(ascCredentialsSchema.safeParse({ ...base, vendorNumber: "12" }).success).toBe(false);
  });
});

describe("portable platform helpers", () => {
  it("gunzips Apple report payloads with the built-in DecompressionStream", async () => {
    const tsv = "Date\tCounts\n2026-10-01\t5\n";
    expect(await gunzipText(new Uint8Array(gzipSync(tsv)))).toBe(tsv);
  });

  it("only accepts safe relative cache keys", () => {
    expect(assertCacheKey("sales/88123456/2026-10-01.json")).toBe("sales/88123456/2026-10-01.json");
    for (const bad of ["../secret", "/etc/passwd", "a/../../b", "a//b", "a b", ""]) expect(() => assertCacheKey(bad)).toThrow();
  });

  it("reuses a token until it expires", async () => {
    let made = 0;
    const token = cachedToken(async () => `t${++made}`, 60_000);
    expect(await token()).toBe("t1");
    expect(await token()).toBe("t1");
  });
});
