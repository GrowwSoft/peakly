import type { ReactNode } from "react";

/** Settings layout shared by web and Mac. Each host passes its own connection form, connected view and readiness list. */
export function SettingsScreen({ intro, configured, form, connected, readiness, guideFooter }: {
  intro: string;
  configured: boolean;
  form: ReactNode;
  connected: ReactNode;
  readiness?: ReactNode;
  guideFooter: string;
}) {
  return (
    <div className="mx-auto max-w-[880px]">
      <h1 className="text-[34px] font-bold tracking-tight text-ink sm:text-[44px]">Settings</h1>
      <p className="mt-2 text-[17px] text-ink-2">{intro}</p>

      <section className="mt-8 rounded-2xl border border-line bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">App Store Connect</h2>
            <p className="mt-1 text-sm text-ink-2">Impressions, page views, sources and downloads (Analytics Reports) plus units and proceeds (Sales reports).</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${configured ? "bg-[var(--tone-green-bg)] text-[var(--tone-green-ink)] ring-[var(--tone-green-inner)]" : "bg-card-muted text-ink-3 ring-line"}`}>
            {configured ? "Connected" : "Not connected"}
          </span>
        </div>
        {configured ? connected : form}
      </section>

      {configured && readiness}

      <section className="mt-5 rounded-2xl border border-line bg-card-muted p-6 text-sm leading-relaxed text-ink-2">
        <h2 className="text-base font-semibold text-ink">Where to find these</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>In App Store Connect, open <strong>Users and Access → Integrations → App Store Connect API</strong>.</li>
          <li>Generate a <strong>Team Key</strong> with the <strong>Sales and Reports</strong> role. Download the .p8 file (Apple lets you download it only once).</li>
          <li>Copy the <strong>Issuer ID</strong> from the same page. The Key ID is read from the <code>AuthKey_….p8</code> file name.</li>
          <li>Optional: find your <strong>Vendor number</strong> under <strong>Payments and Financial Reports</strong> to include sales. You can add it later.</li>
          <li>{guideFooter}</li>
        </ol>
      </section>
    </div>
  );
}

export const READINESS_FALLBACK = <div className="mt-5 h-40 animate-pulse rounded-2xl border border-line bg-card-muted" aria-label="Checking your apps" />;
