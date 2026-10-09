"use client";

import { BarChart3, Bot, ChevronsUpDown, Heart, Megaphone, Settings, Sparkles, Table2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { ALL_APPS } from "@/core/all-apps";
import { DONATE_URL } from "@/core/links";

export interface SidebarApp { id: string; name: string; iconUrl: string | null }

export type Screen = "insights" | "mcp" | "tables" | "feedback" | "settings";

export const NAV_ITEMS: { screen: Screen; label: string; icon: LucideIcon }[] = [
  { screen: "insights", label: "Growth insights", icon: BarChart3 },
  { screen: "mcp", label: "MCP", icon: Bot },
  { screen: "tables", label: "Table viewer", icon: Table2 },
  { screen: "feedback", label: "Feedback", icon: Megaphone },
  { screen: "settings", label: "Settings", icon: Settings },
];

/** App picker at the top of the sidebar: "All apps" (the default) or one app. Shows the Peakly brand when no account is connected. */
export function AppSwitcherView({ apps, selectedId, mode, onSelect }: {
  apps: SidebarApp[]; selectedId: string | null; mode: string; onSelect: (id: string) => void;
}) {
  const one = apps.find((a) => a.id === selectedId);
  const selected = one ?? { id: ALL_APPS, name: "All apps", iconUrl: null };
  if (mode !== "live" || apps.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl px-2 py-2">
        <Logo size={48} />
        <div>
          <p className="font-semibold text-ink">{mode === "error" ? "Connection issue" : "Peakly"}</p>
          <p className="text-sm text-ink-3">{mode === "error" ? "Check Settings" : mode === "locked" ? "Key locked" : "App Insights"}</p>
        </div>
      </div>
    );
  }
  return (
    <label className="relative flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-card-muted">
      {selected.iconUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={selected.iconUrl} alt="" className="size-12 rounded-2xl shadow-sm" />
        : one
          ? <div className="grid size-12 place-items-center rounded-2xl bg-accent text-white"><Sparkles className="size-6" aria-hidden /></div>
          : <Logo size={48} />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{selected.name}</p>
        <p className="text-sm text-ink-3">{one ? "iOS App" : `${apps.length} app${apps.length === 1 ? "" : "s"} combined`}</p>
      </div>
      <ChevronsUpDown className="size-4 text-ink-3" aria-hidden />
      <select aria-label="Choose app" className="absolute inset-0 cursor-pointer opacity-0" value={selected.id} onChange={(e) => onSelect(e.target.value)}>
        <option value={ALL_APPS}>All apps</option>
        {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

/** Main navigation. Each host renders the actual link or button via `renderItem`. */
export function SidebarNav({ active, renderItem }: {
  active: Screen;
  renderItem: (screen: Screen, props: { className: string; current: boolean; children: ReactNode }) => ReactNode;
}) {
  return (
    <nav className="mt-8 space-y-1" aria-label="Main">
      {NAV_ITEMS.map(({ screen, label, icon: Icon }) => {
        const current = screen === active;
        return renderItem(screen, {
          current,
          className: `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] transition-colors ${current ? "bg-nav-active font-semibold text-accent" : "text-ink-2 hover:bg-card-muted hover:text-ink"}`,
          children: <><Icon className="size-[18px]" aria-hidden />{label}</>,
        });
      })}
    </nav>
  );
}

/**
 * Opens the Peakly website's donate page. A plain link on the web; the Mac app passes
 * `openExternal` so the page opens in the default browser instead of the app window.
 */
export function DonateLink({ openExternal, className }: { openExternal?: (url: string) => void; className?: string }) {
  return (
    <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className={className}
      onClick={openExternal ? (e) => { e.preventDefault(); openExternal(DONATE_URL); } : undefined}>
      <Heart className="size-4" fill="currentColor" aria-hidden />Donate
    </a>
  );
}

/** The sidebar shell: the host supplies the app switcher and navigation; Peakly's name sits at the bottom. */
export function SidebarFrame({ children }: { children?: ReactNode }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-sidebar px-4 py-6 md:flex">
      {children ?? <div className="h-16 animate-pulse rounded-2xl bg-card-muted" aria-hidden />}
      <div className="mt-auto flex items-center gap-3 px-3 text-xs leading-relaxed text-ink-3" aria-label="About Peakly" role="contentinfo">
        <Logo size={24} />
        <div>
          <p className="font-medium text-ink-2">Peakly</p>
          <p>Open source</p>
        </div>
      </div>
    </aside>
  );
}

/** A slim bar above every page with Donate on the right. Its own row, so it never collides with page headers. */
export function PageTopBar({ openExternal, className = "" }: { openExternal?: (url: string) => void; className?: string }) {
  return (
    <div className={`mx-auto flex max-w-[1240px] justify-end ${className}`} role="region" aria-label="Page actions">
      <DonateLink openExternal={openExternal}
        className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90" />
    </div>
  );
}
