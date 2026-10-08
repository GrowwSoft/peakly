"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { Grain, SeriesPoint } from "@/core/insights/metrics";
import { compact, percent, shortDate, shortMonth } from "@/core/format";

interface Marker { date: string; label: string }

/** One app's impressions per period, drawn as its own line on the All apps chart. */
export interface AppLine { name: string; iconUrl: string | null; color: string; impressions: (number | null)[] }

const MARGIN = { left: 52, right: 52, top: 16, bottom: 8 };
/** Room to the right of the conversion axis for each app's logo at the end of its line. */
const LOGO_COLUMN = 40;
const LOGO = 22;

/** Logo positions at each line's last value, nudged apart so they never overlap. */
function logoSlots(ys: number[], top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const item of order) placed.push(Math.max(item.y, (placed.at(-1) ?? top - LOGO) + LOGO + 4));
  const overflow = Math.max(0, (placed.at(-1) ?? 0) - bottom);
  const out = new Array<number>(ys.length);
  order.forEach((item, k) => { out[item.i] = Math.max(top, placed[k]! - overflow); });
  return out;
}
const HEIGHT = 300;

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power * 4 >= max)! * power;
  return step * 4;
}

/** Split a series into contiguous runs so unknown periods draw as gaps, never as zero. */
function runs(values: (number | null)[]): { start: number; values: number[] }[] {
  const out: { start: number; values: number[] }[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const last = out.at(-1);
    if (last && last.start + last.values.length === i) last.values.push(v);
    else out.push({ start: i, values: [v] });
  });
  return out;
}

/** Impressions (left axis, filled area) and page conversion (right axis, line) on one chart. */
export function TrendCharts({ points, markers, grain, apps = [] }: { points: SeriesPoint[]; markers: Marker[]; grain: Grain; apps?: AppLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [table]);

  const label = (iso: string) => (grain === "month" ? shortMonth(iso) : shortDate(iso));
  const impressions = points.map((p) => p.impressions);
  const conversion = points.map((p) => p.conversion);
  const impMax = niceMax(Math.max(0, ...impressions.map((v) => v ?? 0)));
  const convMax = Math.min(1, niceMax(Math.max(0.04, ...conversion.map((v) => v ?? 0))));
  const right = MARGIN.right + (apps.length ? LOGO_COLUMN : 0);

  const innerW = Math.max(width - MARGIN.left - right, 10);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (i: number) => MARGIN.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yImp = (v: number) => MARGIN.top + innerH - (v / impMax) * innerH;
  const yConv = (v: number) => MARGIN.top + innerH - (v / convMax) * innerH;
  const ticks = [0, 1, 2, 3, 4];

  const indexAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const t = (clientX - rect.left - MARGIN.left) / innerW;
    return Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1))));
  };
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 90))));
  const hovered = hover === null ? null : points[hover];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={() => setTable((t) => !t)} className="text-sm text-accent hover:underline">
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-[360px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0 bg-card-muted text-left text-ink-2">
              <tr><th className="px-3 py-2 font-medium">Period</th><th className="px-3 py-2 text-right font-medium">Impressions</th><th className="px-3 py-2 text-right font-medium">Unique impressions</th><th className="px-3 py-2 text-right font-medium">Total downloads</th><th className="px-3 py-2 text-right font-medium">Conversion rate</th>{apps.map((a) => <th key={a.name} className="px-3 py-2 text-right font-medium">{a.name} impressions</th>)}</tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.label} className="border-t border-line">
                  <td className="px-3 py-1.5">{label(p.label)}</td>
                  <td className="px-3 py-1.5 text-right">{p.impressions?.toLocaleString() ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right">{p.uniqueImpressions?.toLocaleString() ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right">{p.firstDownloads === null && p.redownloads === null ? "—" : ((p.firstDownloads ?? 0) + (p.redownloads ?? 0)).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{p.conversion === null ? "—" : percent(p.conversion)}</td>
                  {apps.map((a) => <td key={a.name} className="px-3 py-1.5 text-right">{a.impressions[i]?.toLocaleString() ?? "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          className="relative outline-none"
          tabIndex={0}
          aria-label="Impressions and conversion rate over time. Use arrow keys to inspect periods."
          onMouseMove={(e) => setHover(indexAt(e.clientX))}
          onMouseLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
            if (e.key === "Escape") setHover(null);
          }}
        >
          <svg width={width} height={HEIGHT} role="img" aria-label="Impressions and conversion rate" className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGIN.left} x2={width - right} y1={yImp((impMax / 4) * t)} y2={yImp((impMax / 4) * t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={MARGIN.left - 10} y={yImp((impMax / 4) * t)} textAnchor="end" dominantBaseline="middle" className="fill-[var(--ink-3)] text-[12px] tabular">{compact((impMax / 4) * t)}</text>
                <text x={width - right + 10} y={yConv((convMax / 4) * t)} textAnchor="start" dominantBaseline="middle" className="fill-[var(--ink-3)] text-[12px] tabular">{percent((convMax / 4) * t, 0)}</text>
              </g>
            ))}
            {markers.map((m) => {
              const i = points.findIndex((p) => p.label === m.date);
              if (i < 0) return null;
              return (
                <g key={m.label}>
                  <line x1={x(i)} x2={x(i)} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--ink-3)" strokeOpacity={0.45} strokeWidth={1} />
                  <text x={x(i) + 4} y={MARGIN.top + 10} className="fill-[var(--ink-3)] text-[11px]">{m.label}</text>
                </g>
              );
            })}
            {runs(impressions).map((run) => {
              const line = `M${run.values.map((v, k) => `${x(run.start + k)},${yImp(v)}`).join("L")}`;
              const base = yImp(0);
              return (
                <g key={`i${run.start}`}>
                  {run.values.length > 1 && <path d={`${line}L${x(run.start + run.values.length - 1)},${base}L${x(run.start)},${base}Z`} fill="var(--series-1)" fillOpacity={0.14} />}
                  <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {run.values.length === 1 && <circle cx={x(run.start)} cy={yImp(run.values[0]!)} r={4} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />}
                </g>
              );
            })}
            {apps.map((a) => runs(a.impressions).map((run) => (
              <path key={`${a.name}${run.start}`} d={`M${run.values.map((v, k) => `${x(run.start + k)},${yImp(v)}`).join("L")}`}
                fill="none" stroke={a.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" data-app={a.name} />
            )))}
            {apps.length > 0 && (() => {
              const lastY = apps.map((a) => {
                const last = [...a.impressions].reverse().find((v) => v !== null);
                return last == null ? MARGIN.top + innerH : yImp(last);
              });
              const slots = logoSlots(lastY.map((y) => y - LOGO / 2), MARGIN.top, MARGIN.top + innerH - LOGO);
              const lx = width - LOGO_COLUMN + (LOGO_COLUMN - LOGO) / 2;
              return apps.map((a, i) => (
                <g key={a.name} aria-label={a.name}>
                  <title>{a.name}</title>
                  <clipPath id={`logo-${i}`}><rect x={lx} y={slots[i]} width={LOGO} height={LOGO} rx={6} /></clipPath>
                  {a.iconUrl
                    ? <image href={a.iconUrl} x={lx} y={slots[i]} width={LOGO} height={LOGO} clipPath={`url(#logo-${i})`} />
                    : <><rect x={lx} y={slots[i]} width={LOGO} height={LOGO} rx={6} fill={a.color} />
                      <text x={lx + LOGO / 2} y={slots[i]! + LOGO / 2} textAnchor="middle" dominantBaseline="central" className="fill-white text-[11px] font-semibold">{a.name.slice(0, 1)}</text></>}
                  <rect x={lx - 1.5} y={slots[i]! - 1.5} width={LOGO + 3} height={LOGO + 3} rx={7.5} fill="none" stroke={a.color} strokeWidth={2} />
                </g>
              ));
            })()}
            {runs(conversion).map((run) => (
              <g key={`c${run.start}`}>
                <path d={`M${run.values.map((v, k) => `${x(run.start + k)},${yConv(v)}`).join("L")}`} fill="none" stroke="var(--series-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {run.values.length === 1 && <circle cx={x(run.start)} cy={yConv(run.values[0]!)} r={4} fill="var(--series-3)" stroke="var(--card)" strokeWidth={2} />}
              </g>
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--ink-3)" strokeWidth={1} />
                {impressions[hover] !== null && <circle cx={x(hover)} cy={yImp(impressions[hover]!)} r={5} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />}
                {conversion[hover] !== null && <circle cx={x(hover)} cy={yConv(conversion[hover]!)} r={5} fill="var(--series-3)" stroke="var(--card)" strokeWidth={2} />}
              </g>
            )}
          </svg>
          <div className="relative mt-2 h-5" style={{ marginLeft: MARGIN.left, marginRight: right }}>
            {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) && (
              <span key={p.label} className="absolute -translate-x-1/2 whitespace-nowrap text-[12px] text-ink-3" style={{ left: points.length <= 1 ? "50%" : `${(i / (points.length - 1)) * 100}%` }}>
                {label(p.label)}
              </span>
            ))}
          </div>
          {apps.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2" aria-label="Apps">
              {apps.map((a) => (
                <li key={a.name} className="flex items-center gap-2">
                  <span className="h-0.5 w-4 rounded-full" style={{ background: a.color }} aria-hidden />
                  {a.iconUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.iconUrl} alt="" className="size-5 rounded-md" />
                    : <span className="grid size-5 place-items-center rounded-md text-[10px] font-semibold text-white" style={{ background: a.color }} aria-hidden>{a.name.slice(0, 1)}</span>}
                  {a.name}
                </li>
              ))}
            </ul>
          )}
          {hovered && hover !== null && (
            <div
              className={`pointer-events-none absolute top-6 z-10 ${apps.length ? "w-64" : "w-52"} rounded-xl border border-line bg-card p-3 text-sm shadow-lg`}
              style={{ left: Math.min(Math.max(x(hover) + 14, 0), Math.max(width - (apps.length ? 268 : 220), 0)) }}
              role="status"
            >
              <p className="font-semibold text-ink">{grain === "week" ? `Week of ${label(hovered.label)}` : label(hovered.label)}</p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular text-ink-2">
                <dt className="flex items-center gap-2"><span className="size-2 rounded-full bg-[var(--series-1)]" />Impressions</dt><dd className="text-right text-ink">{hovered.impressions?.toLocaleString() ?? "unknown"}</dd>
                <dt className="flex items-center gap-2"><span className="size-2 rounded-full bg-[var(--series-3)]" />Conversion rate</dt><dd className="text-right text-ink">{hovered.conversion === null ? "—" : percent(hovered.conversion)}</dd>
                <dt className="pl-4">Unique impressions</dt><dd className="text-right text-ink">{hovered.uniqueImpressions?.toLocaleString() ?? "unknown"}</dd>
                <dt className="pl-4">Total downloads</dt><dd className="text-right text-ink">{hovered.firstDownloads === null && hovered.redownloads === null ? "unknown" : ((hovered.firstDownloads ?? 0) + (hovered.redownloads ?? 0)).toLocaleString()}</dd>
                {apps.map((a) => (
                  <Fragment key={a.name}>
                    <dt className="flex min-w-0 items-center gap-2"><span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: a.color }} /><span className="truncate">{a.name}</span></dt>
                    <dd className="text-right text-ink">{a.impressions[hover]?.toLocaleString() ?? "—"}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
