import { ArrowDownRight, ArrowUpRight, Download, Eye, Filter, LayoutPanelTop } from "lucide-react";
import type { Kpi } from "@/core/insights/metrics";
import { compact, percent, signedPercent, signedPoints } from "@/core/format";

const STYLE = {
  impressions: { icon: Eye, chip: "bg-[#e8f1fd] text-[#2a78d6]" },
  conversion: { icon: Filter, chip: "bg-[#e3f6ee] text-[#14865d]" },
  firstDownloads: { icon: Download, chip: "bg-[#eeebfc] text-[#4a3aa7]" },
  pageViews: { icon: LayoutPanelTop, chip: "bg-[#fdf3dc] text-[#b07400]" },
} as const;

export function KpiCard({ kpi, thin }: { kpi: Kpi; thin: boolean }) {
  const { icon: Icon, chip } = STYLE[kpi.key];
  const value = kpi.value === null ? "—" : kpi.key === "conversion" ? percent(kpi.value) : compact(kpi.value);
  const up = (kpi.change ?? 0) > 0;
  const flat = kpi.change === null || kpi.change === 0;
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start gap-4">
        <div className={`grid size-14 shrink-0 place-items-center rounded-full ${chip}`}>
          <Icon className="size-6" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] text-ink-2">{kpi.label}</h3>
          <p className="tabular mt-1 text-[32px] font-bold leading-none tracking-tight text-ink">{value}</p>
        </div>
      </div>
      <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {kpi.change === null ? (
          <span className="text-ink-3">{kpi.value === null ? "Not reported" : "No comparable previous period"}</span>
        ) : (
          <>
            <span className={`inline-flex items-center gap-1 font-semibold ${flat ? "text-ink-2" : up ? "text-good" : "text-bad"}`}>
              {!flat && (up ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowDownRight className="size-4" aria-hidden />)}
              {kpi.changeKind === "points" ? signedPoints(kpi.change) : signedPercent(kpi.change)}
            </span>
            <span className="text-ink-3">vs. previous period</span>
          </>
        )}
        {thin && <span className="rounded-full bg-card-muted px-2 py-0.5 text-xs text-ink-3 ring-1 ring-line">small sample</span>}
      </p>
    </section>
  );
}
