import type { AppSummary } from "./insights/types";

/** The app-switcher value for every app on the account together. */
export const ALL_APPS = "all";

export const ALL_APPS_SUMMARY: AppSummary = { id: ALL_APPS, name: "All apps", bundleId: "", sku: "", iconUrl: null };
