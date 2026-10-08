"use client";

import { useState, type ReactNode } from "react";
import { PROVIDERS, type Cell, type ExplorerTable, type Provider } from "@/core/explorer";

/** A table that's loaded only when its tab is opened (large reports). */
export interface LazyTable { id: string; title: string; call: string; provider: Provider }
type LazyState = { status: "loading" } | { status: "ready"; table: ExplorerTable } | { status: "error"; message: string };

/** Column tint by the credential that provides the data. Same hues as the dashboard's KPI icons. */
const TINT: Record<Provider, { head: string; cell: string; dot: string; ink: string }> = {
  asc: { head: "bg-[#e8f1fd]", cell: "bg-[#f5f9fe]", dot: "bg-[#2a78d6]", ink: "text-[#1c5cab]" },
  vendor: { head: "bg-[#eeebfc]", cell: "bg-[#f8f7fe]", dot: "bg-[#4a3aa7]", ink: "text-[#4a3aa7]" },
  public: { head: "bg-[#e3f6ee]", cell: "bg-[#f4fbf8]", dot: "bg-[#14865d]", ink: "text-[#14865d]" },
  derived: { head: "bg-[#f1f3f6]", cell: "bg-[#fafbfc]", dot: "bg-[#6b7484]", ink: "text-[#4b5363]" },
};

const show = (v: Cell) => (v === null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-US") : v);

/** Every readable table for the selected app, one tab per type of call, colored by which key provides each column. */
export function DataExplorer({ tables, appName, controls, lazy = [], loadLazy }: {
  tables: ExplorerTable[];
  appName: string;
  controls?: ReactNode;
  /** More tables, fetched from Apple when first opened. Remount (change `key`) when the app or range changes. */
  lazy?: LazyTable[];
  loadLazy?: (id: string) => Promise<ExplorerTable>;
}) {
  const [activeId, setActiveId] = useState(tables[0]?.id ?? "");
  const [lazyState, setLazyState] = useState<Record<string, LazyState>>({});
  const open = (id: string) => {
    setActiveId(id);
    if (!lazy.some((t) => t.id === id) || lazyState[id] || !loadLazy) return;
    setLazyState((s) => ({ ...s, [id]: { status: "loading" } }));
    loadLazy(id).then(
      (table) => setLazyState((s) => ({ ...s, [id]: { status: "ready", table } })),
      (e) => setLazyState((s) => ({ ...s, [id]: { status: "error", message: e instanceof Error ? e.message : String(e) } })),
    );
  };
  const activeLazy = lazy.find((t) => t.id === activeId);
  const lazyEntry = activeLazy ? lazyState[activeLazy.id] : undefined;
  const table: ExplorerTable | undefined = activeLazy
    ? lazyEntry?.status === "ready" ? lazyEntry.table : { id: activeLazy.id, title: activeLazy.title, call: activeLazy.call, columns: [], rows: [],
      unavailable: !loadLazy ? "Connect a key in Settings to load this report." : lazyEntry?.status === "error" ? `Couldn't load this report: ${lazyEntry.message}` : "Loading from Apple…" }
    : tables.find((t) => t.id === activeId) ?? tables[0];
  const providersInTable = (t: ExplorerTable) => [...new Set(t.columns.map((c) => c.provider))];

  return (
    <div className="mx-auto max-w-[1240px]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink sm:text-[44px]">Table viewer</h1>
          <p className="mt-2 text-[17px] text-ink-2">All the data Peakly can read for {appName}, one table per type of call.</p>
        </div>
        {controls}
      </header>

      <ul className="mt-6 flex flex-wrap gap-3" aria-label="Color key">
        {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
          <li key={p} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${TINT[p].head}`}>
            <span className={`size-2.5 rounded-full ${TINT[p].dot}`} aria-hidden />
            <span className="font-medium text-ink">{PROVIDERS[p].label}</span>
            <span className="text-ink-3">· {PROVIDERS[p].detail}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Tables">
        {tables.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === table?.id} onClick={() => setActiveId(t.id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm ring-1 transition-colors ${t.id === table?.id ? "bg-card font-semibold text-ink ring-accent" : "bg-card-muted text-ink-2 ring-line hover:text-ink"}`}>
            <span className="flex gap-1" aria-hidden>{providersInTable(t).map((p) => <span key={p} className={`size-2 rounded-full ${TINT[p].dot}`} />)}</span>
            {t.title}
            <span className="tabular text-ink-3">{t.rows.length}</span>
          </button>
        ))}
        {lazy.map((t) => {
          const state = lazyState[t.id];
          return (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === table?.id} onClick={() => open(t.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm ring-1 transition-colors ${t.id === table?.id ? "bg-card font-semibold text-ink ring-accent" : "bg-card-muted text-ink-2 ring-line hover:text-ink"}`}>
              <span className={`size-2 rounded-full ${TINT[t.provider].dot}`} aria-hidden />
              {t.title}
              <span className="tabular text-ink-3">{state?.status === "ready" ? state.table.rows.length : state?.status === "loading" ? "…" : ""}</span>
            </button>
          );
        })}
      </div>

      {table && (
        <section className="mt-4 rounded-2xl border border-line bg-card p-6" role="tabpanel" aria-label={table.title}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold text-ink">{table.title}</h2>
            <code className="font-mono text-xs text-ink-3">{table.call}</code>
          </div>
          {table.unavailable && <p className="mt-3 rounded-xl bg-card-muted px-4 py-3 text-sm text-ink-2" role="status">{table.unavailable}</p>}
          {table.note && <p className="mt-3 text-sm text-ink-3">{table.note}</p>}
          {table.rows.length > 0 && (
            <div className="mt-4 max-h-[560px] overflow-auto rounded-xl border border-line">
              <table className="w-full text-sm tabular">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c.key} scope="col" data-provider={c.provider}
                        className={`whitespace-nowrap px-3 py-2 font-medium ${TINT[c.provider].head} ${TINT[c.provider].ink} ${c.numeric ? "text-right" : "text-left"}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={i} className="border-t border-line">
                      {table.columns.map((c) => (
                        <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 text-ink ${TINT[c.provider].cell} ${c.numeric ? "text-right" : ""}`}>{show(row[c.key] ?? null)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
