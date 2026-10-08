import { CheckCircle2, CircleAlert, CircleDashed, PauseCircle } from "lucide-react";
import type { AppReadiness, Readiness, ReadinessResult } from "@/core/readiness";
import { CopyCommand } from "./copy-command";
import type { ReactNode } from "react";

const STATUS: Record<Readiness, { label: string; icon: typeof CheckCircle2; className: string }> = {
  ready: { label: "Reports available", icon: CheckCircle2, className: "text-good" },
  waiting: { label: "Waiting for first reports", icon: CircleDashed, className: "text-[var(--tone-amber-ink)]" },
  missing: { label: "Analytics not enabled", icon: CircleAlert, className: "text-[var(--tone-amber-ink)]" },
  stopped: { label: "Analytics stopped (inactive)", icon: PauseCircle, className: "text-[var(--tone-amber-ink)]" },
  unknown: { label: "Couldn't check", icon: CircleDashed, className: "text-ink-3" },
};

/** Every app on the connected account with its Analytics Reports status. */
export function ReadinessView({ result, scriptPath = "scripts/enable-analytics-reports.mjs", renderActivation }: {
  result: ReadinessResult;
  scriptPath?: string;
  renderActivation?: (app: AppReadiness) => ReactNode;
}) {
  return (
    <section className="mt-5 rounded-2xl border border-line bg-card p-6">
      <h2 className="text-xl font-semibold text-ink">Your apps</h2>
      {!result.ok ? (
        <p className="mt-3 text-sm text-bad" role="alert">{result.message}</p>
      ) : result.apps.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">This key can&apos;t see any apps.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {result.apps.filter((a) => a.analytics === "ready").length} of {result.apps.length} app(s) are ready. One key covers every app on this account.
          </p>
          <ul className="mt-4 divide-y divide-line">
            {result.apps.map((app) => {
              const s = STATUS[app.analytics];
              const Icon = s.icon;
              return (
                <li key={app.id} className="flex items-center gap-3 py-3">
                  {app.iconUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={app.iconUrl} alt="" width={36} height={36} className="rounded-xl" />
                    : <span className="size-9 rounded-xl bg-card-muted ring-1 ring-line" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{app.name}</span>
                    {(app.analytics === "missing" || app.analytics === "stopped") && renderActivation?.(app)}
                  </span>
                  <span className={`flex shrink-0 items-center gap-1.5 text-sm ${s.className}`}><Icon className="size-4" aria-hidden />{s.label}</span>
                </li>
              );
            })}
          </ul>
          {!renderActivation && <MissingAnalytics scriptPath={scriptPath} ids={result.apps.filter((a) => a.analytics === "missing" || a.analytics === "stopped").map((a) => a.id)} />}
          {result.apps.some((a) => a.analytics === "waiting") && <p className="mt-4 text-sm text-ink-2">Apple usually publishes the first reports 24–48 hours after analytics is enabled. Peakly checks again while it&apos;s open.</p>}
        </>
      )}
    </section>
  );
}

function MissingAnalytics({ ids, scriptPath }: { ids: string[]; scriptPath: string }) {
  if (ids.length === 0) return null;
  const command = `ASC_ISSUER_ID=<issuer-id> ASC_KEY_PATH=./AuthKey_<ADMINKEY>.p8 node ${scriptPath.includes(" ") ? `"${scriptPath}"` : scriptPath} ${ids.join(" ")}`;
  return (
    <div className="mt-5 rounded-xl bg-[var(--tone-amber-bg)] p-5 text-sm">
      <p className="font-semibold text-ink">Enable analytics for {ids.length} app(s)</p>
      <p className="mt-1 leading-relaxed text-ink-2">
        Apple only lets an <strong>Admin</strong> key turn on Analytics Reports, and this app keeps your saved key read-only.
        Run this once on your own computer with an Admin key. It shows what it will do, and creates nothing until you type &ldquo;yes&rdquo;.
        Reports arrive 24–48 hours later.
      </p>
      <CopyCommand command={command} />
    </div>
  );
}
