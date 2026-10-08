import { totals, type Window } from "@/core/insights/metrics";
import { SOURCE_LABELS, type DailySourceMetrics, type SourceType } from "@/core/insights/types";
import { percent } from "@/core/format";

const SOURCES: SourceType[] = ["search", "browse", "app_referrer", "web_referrer", "other"];

export function SourceTable({ rows, window }: { rows: DailySourceMetrics[]; window: Window }) {
  const data = SOURCES.map((source) => ({ source, t: totals(rows, window, source) }))
    .filter(({ t }) => (t.impressions ?? 0) + (t.pageViews ?? 0) + (t.firstDownloads ?? 0) > 0);
  const cell = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
  return (
    <section className="rounded-2xl border border-line bg-card p-6">
      <h2 className="text-lg font-semibold text-ink">Where downloads come from</h2>
      <p className="mt-1 text-sm text-ink-3">Event counts by App Store source, not unique people. Direct search downloads skip the product page.</p>
      {data.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No source data in this period.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 text-right font-medium">Impressions</th>
                <th className="py-2 text-right font-medium">Page views</th>
                <th className="py-2 text-right font-medium">First downloads</th>
                <th className="py-2 text-right font-medium">From page</th>
                <th className="py-2 text-right font-medium">Page conversion</th>
              </tr>
            </thead>
            <tbody>
              {data.map(({ source, t }) => (
                <tr key={source} className="border-t border-line text-ink">
                  <td className="py-2.5">{SOURCE_LABELS[source]}</td>
                  <td className="py-2.5 text-right">{cell(t.impressions)}</td>
                  <td className="py-2.5 text-right">{cell(t.pageViews)}</td>
                  <td className="py-2.5 text-right">{cell(t.firstDownloads)}</td>
                  <td className="py-2.5 text-right">{cell(t.pageDownloads)}</td>
                  <td className="py-2.5 text-right">{t.pageViews ? percent((t.pageDownloads ?? 0) / t.pageViews) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
