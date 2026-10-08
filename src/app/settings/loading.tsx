export default function Loading() {
  return (
    <div className="mx-auto max-w-[880px] animate-pulse" aria-busy="true" aria-label="Loading settings">
      <div className="h-12 w-48 rounded-xl bg-card-muted" />
      <div className="mt-8 h-72 rounded-2xl border border-line bg-card-muted" />
    </div>
  );
}
