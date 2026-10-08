import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

export function Notice({ tone, title, children }: { tone: "info" | "warn" | "error"; title: string; children: ReactNode }) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  const color = tone === "info" ? "var(--tone-blue-ink)" : tone === "warn" ? "var(--tone-amber-ink)" : "var(--bad)";
  return (
    <div className="mt-6 flex gap-3 rounded-2xl border border-line bg-card-muted px-5 py-4 text-sm" role={tone === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-5 shrink-0" style={{ color }} aria-hidden />
      <div><p className="font-semibold text-ink">{title}</p><div className="mt-0.5 text-ink-2">{children}</div></div>
    </div>
  );
}
