import { BarChart3, CircleDollarSign, Clock3, CreditCard, FlaskConical, Link2, Repeat, Search, Shuffle, Sparkles, Store, TrendingUp, Users } from "lucide-react";
import type { Insight } from "@/core/insights/diagnose";

/** Each card gets its own color, in the same order and hues as the KPI cards (blue, green, violet, amber). */
const PALETTE: { bg: string; inner: string; ink: string }[] = [
  { bg: "#f3f8fe", inner: "#e8f1fd", ink: "#1c5cab" },
  { bg: "#f1faf6", inner: "#e3f6ee", ink: "#14865d" },
  { bg: "#f6f5fe", inner: "#eeebfc", ink: "#4a3aa7" },
  { bg: "#fefaf0", inner: "#fdf3dc", ink: "#8a5a00" },
];

const ICONS: Record<string, typeof BarChart3> = {
  "low-exposure-high-conversion": BarChart3,
  "high-exposure-low-conversion": Users,
  "low-low": Users,
  healthy: TrendingUp,
  "too-early": Clock3,
  "referrer-led": Link2,
  "search-led": Search,
  "browse-led": Store,
  "mixed-sources": Shuffle,
  "no-paid": CircleDollarSign,
  paid: CircleDollarSign,
  "no-purchases": CircleDollarSign,
  purchases: CircleDollarSign,
  "trial-conversion": Repeat,
  "subscriptions-early": Clock3,
  "billing-churn": CreditCard,
  "analytics-missing": Sparkles,
};

/** One insight: what the data shows, what might explain it, one test, and how to tell if it worked. */
export function InsightCard({ insight, index = 0 }: { insight: Insight; index?: number }) {
  const tone = PALETTE[index % PALETTE.length]!;
  const Head = ICONS[insight.id] ?? Sparkles;
  return (
    <section className="flex flex-col rounded-2xl border border-line p-6" style={{ background: tone.bg }} aria-label={insight.title}>
      <div className="flex items-center gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-full" style={{ background: tone.inner, color: tone.ink }}>
          <Head className="size-6" aria-hidden />
        </div>
        <h3 className="text-[21px] font-bold leading-tight tracking-tight text-ink">{insight.title}</h3>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">What we see</p>
        <ul className="mt-1.5 space-y-1 text-[15px] leading-relaxed text-ink">
          {insight.observed.map((o) => <li key={o}>{o}</li>)}
        </ul>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Possible reasons</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink-2">
          {insight.explanations.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </div>

      <div className="mt-5 flex gap-4 rounded-2xl p-5" style={{ background: tone.inner }}>
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-card/70" style={{ color: tone.ink }}>
          <FlaskConical className="size-5" aria-hidden />
        </div>
        <div>
          <p className="text-sm text-ink-2">Try next</p>
          <p className="mt-0.5 text-[18px] font-semibold" style={{ color: tone.ink }}>{insight.test.title}</p>
          <p className="mt-1 leading-relaxed text-ink-2">{insight.test.body}</p>
          <p className="mt-3 text-sm text-ink-2"><span className="font-semibold text-ink">It worked if: </span>{insight.success}</p>
        </div>
      </div>

      {insight.caveats.length > 0 && (
        <details className="mt-4 text-sm text-ink-2">
          <summary className="cursor-pointer select-none text-ink-3 hover:text-ink-2">Limits of this data</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {insight.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
