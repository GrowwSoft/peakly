/** Fixed App Store Connect data served by the mock Apple server, shared with the specs' expectations. */
export const ISSUER_ID = "11111111-2222-3333-4444-555555555555";
export const KEY_ID = "E2ETESTKEY";
export const VENDOR_NUMBER = "88123456";

export const APPS = [
  { id: "1001", name: "Studio Level", bundleId: "com.example.studiolevel", sku: "STUDIO1" },
  { id: "1002", name: "Calm Notes", bundleId: "com.example.calmnotes", sku: "CALM1" },
  { id: "1003", name: "Echo Pad", bundleId: "com.example.echopad", sku: "ECHO1" },
];

/** Per day for app 1003: a lower page conversion (10% vs 40%), so All apps must weight by page views (20%), not average rates (25%). */
/** Echo Pad's downloads are split evenly between search (from the page) and web links, so no source dominates. */
export const ECHO_DAILY = { impressions: 30, uniqueImpressions: 10, pageViews: 20, getTaps: 3, pageDownloads: 2, directDownloads: 2, salesUnits: 2 };

/** Per day, per app 1001, all from App Store search. */
export const DAILY = { impressions: 50, uniqueImpressions: 40, pageViews: 10, getTaps: 6, pageDownloads: 4, directDownloads: 2, salesUnits: 3 };

const DAY = 86_400_000;
export const isoDay = (offset: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + offset * DAY).toISOString().slice(0, 10);
/** Analytics days: from 62 days ago through 2 days ago. */
export const ANALYTICS_DAYS = Array.from({ length: 61 }, (_, i) => isoDay(-62 + i));
