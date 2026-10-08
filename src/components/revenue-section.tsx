import { BadgeCheck, CircleDollarSign, Repeat, ShoppingBag, Sparkles, UserMinus, Users, Undo2, type LucideIcon } from "lucide-react";
import { revenueSummary, type Window } from "@/core/insights/metrics";
import type { DailyRevenue } from "@/core/insights/types";

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const count = (v: number) => v.toLocaleString("en-US");

/**
 * Purchases and subscriptions from Apple's Analytics Reports: readable with the same key,
 * no vendor number. Proceeds are Apple's estimate in US dollars.
 */
export function RevenueSection({ revenue, window }: { revenue: DailyRevenue[]; window: Window }) {
  const r = revenueSummary(revenue, window);
  const tiles: { label: string; value: string; icon: LucideIcon; hint?: string }[] = [
    { label: "Estimated proceeds", value: usd(r.proceedsUsd), icon: CircleDollarSign, hint: "After Apple's commission, refunds included" },
    { label: "Purchases", value: count(r.purchases), icon: ShoppingBag, hint: "Paid apps and in-app purchases" },
    { label: "Refunds", value: count(r.refunds), icon: Undo2 },
    { label: "Free-trial starts", value: count(r.trialStarts), icon: Sparkles },
    { label: "Trials and offers converted", value: count(r.offerConversions), icon: BadgeCheck, hint: "Became paid subscriptions" },
    { label: "New paid subscriptions", value: count(r.paidStarts), icon: Users, hint: "Started without an offer" },
    { label: "Renewals", value: count(r.renewals), icon: Repeat },
    { label: "Churned", value: count(r.churned), icon: UserMinus, hint: "Cancelled or billing failed" },
  ];
  return (
    <section className="mt-5 rounded-2xl border border-line bg-card p-6" aria-labelledby="revenue-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="revenue-title" className="text-xl font-semibold text-ink">Revenue and subscriptions</h2>
        <p className="text-sm text-ink-3">
          {r.activePaid !== null ? `${count(r.activePaid)} active paid subscriptions` : "Active subscriptions not published yet"}
          {r.activeTrials !== null ? ` · ${count(r.activeTrials)} in a free trial` : ""}
        </p>
      </div>
      {r.days === 0 ? (
        <p className="mt-3 text-sm text-ink-2" role="status">Apple hasn&apos;t published purchase and subscription reports for this period yet.</p>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map(({ label, value, icon: Icon, hint }) => (
            <div key={label} className="rounded-xl border border-line bg-card-muted px-4 py-3">
              <dt className="flex items-center gap-2 text-sm text-ink-2"><Icon className="size-4 text-ink-3" aria-hidden />{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular">{value}</dd>
              {hint && <dd className="text-xs text-ink-3">{hint}</dd>}
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 text-xs leading-relaxed text-ink-3">
        From Apple&apos;s purchase and subscription reports, using the same key. Proceeds are Apple&apos;s estimate in US dollars; a vendor number adds the exact sales reports.
      </p>
    </section>
  );
}
