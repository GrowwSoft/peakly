export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] animate-pulse" aria-busy="true" aria-label="Loading reports">
      <div className="h-12 w-72 rounded-xl bg-card-muted" />
      <div className="mt-3 h-5 w-96 max-w-full rounded-lg bg-card-muted" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-36 rounded-2xl border border-line bg-card-muted" />)}
      </div>
      <div className="mt-5 h-[460px] rounded-2xl border border-line bg-card-muted" />
      <p className="mt-4 text-sm text-ink-3">Fetching reports from App Store Connect. The first load downloads each report once; later loads use the cache.</p>
    </div>
  );
}
