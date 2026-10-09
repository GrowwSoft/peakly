import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Logo } from "@/components/logo";
import { Sidebar } from "@/components/sidebar";
import { DonateLink, PageTopBar, SidebarFrame } from "@/components/sidebar-view";
import { getApps } from "@/lib/server/apps";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growth Insights",
  description: "Open-source growth insights for App Store apps, from your own read-only keys.",
};

/** The connected account's apps are request-time data, so they stream into the static shell. */
async function SidebarWithApps() {
  await connection();
  const apps = await getApps();
  const list = apps.mode === "live" ? apps.apps.map((a) => ({ id: a.id, name: a.name, iconUrl: a.iconUrl })) : [];
  return <Sidebar apps={list} mode={apps.mode} />;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <Suspense fallback={<SidebarFrame />}>
            <SidebarWithApps />
          </Suspense>
          <div className="min-w-0 flex-1 bg-card">
            <nav className="flex items-center gap-4 border-b border-line px-4 py-3 text-sm md:hidden" aria-label="Main">
              <span className="flex items-center gap-2 font-semibold"><Logo size={22} />Growth Insights</span>
              <Link href="/" className="text-ink-2">Insights</Link>
              <Link href="/mcp" className="text-ink-2">MCP</Link>
              <Link href="/tables" className="text-ink-2">Tables</Link>
              <Link href="/feedback" className="text-ink-2">Feedback</Link>
              <Link href="/settings" className="text-ink-2">Settings</Link>
              <DonateLink className="ml-auto flex items-center gap-1.5 font-medium text-accent" />
            </nav>
            <PageTopBar className="hidden px-10 pt-5 md:flex" />
            <main className="px-4 py-8 sm:px-10 sm:py-10 md:pt-3">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
