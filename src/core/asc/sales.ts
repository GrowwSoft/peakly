import type { DailySales } from "@/core/insights/types";
import { parseTsv, toNumber } from "./tsv";

/** Apple product type identifiers (Sales and Trends). Unknown types are kept out of every bucket. */
const APP_TYPES = new Set(["1", "1F", "1T", "1E", "1EP", "1EU", "F1"]);
const UPDATE_TYPES = new Set(["7", "7F", "7T", "F7"]);
const REDOWNLOAD_TYPES = new Set(["3", "3F", "3T", "F3"]);
const isIap = (type: string) => /^(IA|FI)/.test(type);

/**
 * Reduce one account-wide daily SUMMARY report to a single app. App rows match the
 * Apple Identifier; in-app purchase and subscription rows match the app SKU through
 * Parent Identifier.
 */
export function salesForApp(date: string, tsv: string, app: { id: string; sku: string }): DailySales {
  const day: DailySales = { date, status: "available", appUnits: 0, updateUnits: 0, redownloadUnits: 0, paidUnits: 0, proceeds: {}, refunds: 0 };
  for (const row of parseTsv(tsv).rows) {
    const type = row["Product Type Identifier"] ?? "";
    const isAppRow = row["Apple Identifier"] === app.id;
    const isChildRow = isIap(type) && app.sku !== "" && row["Parent Identifier"] === app.sku;
    if (!isAppRow && !isChildRow) continue;
    const units = toNumber(row["Units"]) ?? 0;
    const price = toNumber(row["Customer Price"]) ?? 0;
    const proceedsPerUnit = toNumber(row["Developer Proceeds"]) ?? 0;
    const currency = row["Currency of Proceeds"] || "UNK";

    // Negative units can also be bundle credits, so only app and in-app purchase rows count as refunds.
    if (units < 0 && (APP_TYPES.has(type) || isIap(type))) day.refunds += -units;
    if (APP_TYPES.has(type)) day.appUnits += Math.max(units, 0);
    else if (UPDATE_TYPES.has(type)) day.updateUnits += Math.max(units, 0);
    else if (REDOWNLOAD_TYPES.has(type)) day.redownloadUnits += Math.max(units, 0);
    if ((isIap(type) || APP_TYPES.has(type)) && price !== 0 && units > 0) day.paidUnits += units;
    // A partial refund arrives as zero units with negative proceeds: count the amount itself.
    const amount = units === 0 ? proceedsPerUnit : proceedsPerUnit * units;
    if (amount !== 0) day.proceeds[currency] = (day.proceeds[currency] ?? 0) + amount;
  }
  return day;
}
