import { knownTotal, type Window } from "@/core/insights/metrics";
import { SOURCE_LABELS, type DailySourceMetrics, type SourceType } from "@/core/insights/types";
import { percent } from "@/core/format";

const SOURCES: SourceType[] = ["search", "browse", "app_referrer", "web_referrer", "other"];

export function SourceTable({ rows, window }: { rows: DailySourceMetrics[]; window: Window }) {
  const data = SOURCES.map((source) => ({ source,
    impressions: knownTotal(rows, window, "impressions", source),
    pageViews: knownTotal(rows, window, "pageViews", source),
    firstDownloads: knownTotal(rows, window, "firstDownloads", source),
    pageDownloads: knownTotal(rows, window, "pageDownloads", source),
  })).filter(({ impressions, pageViews, firstDownloads }) => (impressions.value ?? 0) + (pageViews.value ?? 0) + (firstDownloads.value ?? 0) > 0);
  const cell = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
  return (
    <section className="rounded-2xl border border-line bg-card p-6">
      <h2 className="text-lg font-semibold text-ink">Where downloads come from</h2>
      <p className="mt-1 text-sm text-ink-3">Event counts by App Store source, not unique people. Direct search downloads skip the product page.</p>
      {data.some(({ firstDownloads, pageDownloads }) => firstDownloads.partial || pageDownloads.partial) && (
        <p className="mt-1 text-sm text-ink-3">Download counts add reported dates only; missing dates remain unknown.</p>
      )}
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
              {data.map(({ source, impressions, pageViews, firstDownloads, pageDownloads }) => (
                <tr key={source} className="border-t border-line text-ink">
                  <td className="py-2.5">{SOURCE_LABELS[source]}</td>
                  <td className="py-2.5 text-right">{cell(impressions.value)}</td>
                  <td className="py-2.5 text-right">{cell(pageViews.value)}</td>
                  <td className="py-2.5 text-right">{cell(firstDownloads.value)}</td>
                  <td className="py-2.5 text-right">{cell(pageDownloads.value)}</td>
                  <td className="py-2.5 text-right">{!pageViews.partial && !pageDownloads.partial && pageViews.value ? percent((pageDownloads.value ?? 0) / pageViews.value) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
