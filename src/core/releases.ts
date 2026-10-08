import type { AppRelease } from "./insights/types";

/**
 * Release history and the tester rule.
 *
 * Apple's public lookup only reports when the *current* version went live, so Peakly
 * records each version the first time it sees it live and keeps that history. With it,
 * any activity that carries a version and build can be split into customers and testers:
 * activity is tester activity when it ran a version that never went public, a different
 * build than the one Apple shipped, or a public build before its release time.
 *
 * Apple's own reports (store analytics and sales) never include TestFlight, App Review
 * or sandbox purchases, so they need no filtering. The rule is for sources that log
 * every session, such as in-app event SDKs.
 */

/**
 * Version states that mean the version was released at some point: appVersionState's
 * READY_FOR_DISTRIBUTION and REPLACED_WITH_NEW_VERSION, plus the deprecated appStoreState
 * values. Released isn't the same as downloadable everywhere: availability is set per territory.
 */
export const PUBLIC_STATES = new Set(["READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "READY_FOR_SALE", "DEVELOPER_REMOVED_FROM_SALE", "REMOVED_FROM_SALE"]);

/** What Peakly remembers about a version once it has been seen live. */
export interface ReleaseRecord {
  version: string;
  build: string | null;
  releasedAt: string | null;
}

export interface ObservedVersion {
  version: string;
  state: string;
  build: string | null;
}

/** Add the live version to the history the first time it's seen, filling in anything learned since. */
export function recordRelease(history: ReleaseRecord[], live: { version: string; releasedAt: string | null } | null, versions: ObservedVersion[]): ReleaseRecord[] {
  const next = history.map((r) => ({ ...r }));
  if (!live) return next;
  const shipped = versions.find((v) => v.version === live.version && PUBLIC_STATES.has(v.state));
  if (!shipped) return next; // the lookup can run ahead of App Store Connect; wait until both agree
  const known = next.find((r) => r.version === live.version);
  if (!known) next.push({ version: live.version, build: shipped.build, releasedAt: live.releasedAt });
  else {
    known.build ??= shipped.build;
    known.releasedAt ??= live.releasedAt;
  }
  return next;
}

/** Every version App Store Connect lists, with its release time from the history when known. */
export function releaseTable(history: ReleaseRecord[], versions: ObservedVersion[]): AppRelease[] {
  const rows: AppRelease[] = versions.map((v) => {
    const known = history.find((r) => r.version === v.version);
    return { version: v.version, state: v.state, build: v.build ?? known?.build ?? null, releasedAt: known?.releasedAt ?? null, public: PUBLIC_STATES.has(v.state) || Boolean(known) };
  });
  // Versions that have dropped off Apple's list stay known from the history.
  for (const r of history) {
    if (!rows.some((row) => row.version === r.version)) rows.push({ version: r.version, state: "REPLACED_WITH_NEW_VERSION", build: r.build, releasedAt: r.releasedAt, public: true });
  }
  return rows;
}

export type TesterReason = "sandbox" | "not_released" | "other_build" | "before_release";

export interface Activity {
  version: string;
  build?: string | null;
  /** ISO time the activity happened. */
  at: string;
  sandbox?: boolean;
}

/** Why an activity came from a tester, or null when it ran a build customers could have. */
export function testerReason(activity: Activity, releases: AppRelease[]): TesterReason | null {
  if (activity.sandbox) return "sandbox";
  const release = releases.find((r) => r.public && r.version === activity.version);
  if (!release) return "not_released";
  if (release.build && activity.build && activity.build !== release.build) return "other_build";
  if (release.releasedAt && Date.parse(activity.at) < Date.parse(release.releasedAt)) return "before_release";
  return null;
}

/**
 * A device is a tester if any of its activity was, and it stays one after the build
 * goes public: App Review and early installs keep using the same device.
 */
export function isTesterDevice(activity: Activity[], releases: AppRelease[]): boolean {
  return activity.some((a) => testerReason(a, releases) !== null);
}
