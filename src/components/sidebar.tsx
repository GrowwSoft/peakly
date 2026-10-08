"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppSwitcherView, SidebarFrame, SidebarNav, type Screen, type SidebarApp } from "./sidebar-view";

const HREF: Record<Screen, string> = { insights: "/", mcp: "/mcp", tables: "/tables", feedback: "/feedback", settings: "/settings" };

function WebSidebarContent({ apps, mode }: { apps: SidebarApp[]; mode: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = params.get("app") ? `?app=${params.get("app")}` : "";
  const active = (Object.entries(HREF).find(([, href]) => href === pathname)?.[0] ?? "insights") as Screen;
  return (
    <>
      <AppSwitcherView apps={apps} mode={mode} selectedId={params.get("app")}
        onSelect={(id) => { const next = new URLSearchParams(params); next.set("app", id); router.push(`/?${next}`); }} />
      <SidebarNav active={active} renderItem={(screen, { className, current, children }) => (
        <Link key={screen} href={`${HREF[screen]}${query}`} aria-current={current ? "page" : undefined} className={className}>{children}</Link>
      )} />
    </>
  );
}

export function Sidebar({ apps, mode }: { apps: SidebarApp[]; mode: string }) {
  return (
    <SidebarFrame>
      <Suspense fallback={<div className="h-16" />}>
        <WebSidebarContent apps={apps} mode={mode} />
      </Suspense>
    </SidebarFrame>
  );
}
