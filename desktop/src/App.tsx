import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataExplorer } from "@/components/data-explorer";
import { Dashboard, type Freshness } from "@/components/dashboard";
import { FeedbackView } from "@/components/feedback-view";
import { feedbackBoardUrl } from "@/core/links";
import { McpView } from "@/components/mcp-view";
import { Notice } from "@/components/notice";
import { AnalyticsActivation } from "@/components/settings/analytics-activation";
import { RangeSelectView } from "@/components/range-select-view";
import { AscConnectionForm, ConnectedAsc } from "@/components/settings/connection-forms";
import { ReadinessView } from "@/components/settings/readiness-view";
import { READINESS_FALLBACK, SettingsScreen } from "@/components/settings/settings-screen";
import { AppSwitcherView, PageTopBar, SidebarFrame, SidebarNav, type Screen } from "@/components/sidebar-view";
import { checkConnection, parseConnectionForm, parseVendorNumber, verifyKey, verifyVendor } from "@/core/connection";
import { isDue, listApps, refreshDataset, storedDataset, type StoredDataset } from "@/core/dataset";
import { ALL_APPS, buildPortfolio, storedPortfolio } from "@/core/portfolio";
import { loadReportTable, REPORT_TABLES, REPORT_TABS } from "@/core/report-tables";
import { demoDataset } from "@/core/demo";
import { buildExplorerTables, demoReadiness } from "@/core/explorer";
import type { Grain } from "@/core/insights/metrics";
import type { AppDataset, AppSummary } from "@/core/insights/types";
import { getReadiness, type ReadinessResult } from "@/core/readiness";
import { createAnalyticsActivation, previewAnalyticsActivation } from "@/core/analytics-activation";
import type { SaveState } from "@/core/settings-types";
import {
  candidateAuth, connectionStatus, desktopPlatform, inDesktopApp, keychainAuth,
  openInBrowser, removeCredentials, saveCredentials, setVendorNumber, unlockCredentials, type DesktopStatus,
} from "./platform";
import { UnlockPanel } from "./unlock-panel";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong.");

type AppsState = { mode: "demo" } | { mode: "loading" } | { mode: "locked" } | { mode: "live"; apps: AppSummary[] } | { mode: "error"; message: string };
type DataState =
  | { status: "loading" }
  | { status: "ready"; dataset: AppDataset; freshness?: Freshness }
  | { status: "error"; message: string };
type Connection = { status: DesktopStatus | null; apps: AppsState };

async function loadConnection(): Promise<Connection> {
  let status: DesktopStatus | null = null;
  try {
    status = await connectionStatus();
    if (!status.configured) return { status, apps: { mode: "demo" } };
    if (status.locked) {
      // A signed Peakly reads its own Keychain item silently, so it unlocks by itself.
      // Unsigned builds would prompt, so they wait for the Unlock button.
      if (!status.autoUnlock) return { status, apps: { mode: "locked" } };
      try {
        status = await unlockCredentials();
        if (!status.configured) return { status, apps: { mode: "demo" } };
      } catch {
        return { status, apps: { mode: "locked" } };
      }
    }
    return { status, apps: { mode: "live", apps: await listApps(desktopPlatform, keychainAuth(status.vendorNumber)) } };
  } catch (e) {
    return { status, apps: { mode: "error", message: messageOf(e) } };
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>("insights");
  const [connection, setConnection] = useState<Connection>({ status: null, apps: { mode: "loading" } });
  const { status, apps } = connection;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState(28);
  const [grain, setGrain] = useState<Grain>("day");
  const [loaded, setLoaded] = useState<{ key: string; state: DataState } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refreshed = useRef(0);

  // Connection status and app list: loaded once at launch, and again after Settings changes the key.
  useEffect(() => {
    let cancelled = false;
    void loadConnection().then((c) => { if (!cancelled) setConnection(c); });
    return () => { cancelled = true; };
  }, []);
  const refreshConnection = useCallback(async () => {
    setConnection((c) => ({ ...c, apps: { mode: "loading" } }));
    setConnection(await loadConnection());
  }, []);
  // The only path that reads the Keychain. Unlocking once unlocks every screen.
  const unlock = useCallback(async () => {
    await unlockCredentials();
    await refreshConnection();
  }, [refreshConnection]);
  const locked = apps.mode === "locked" && status?.configured ? <UnlockPanel keyId={status.keyId} onUnlock={unlock} /> : null;

  // Dataset for the selected app and range. The copy saved on this Mac shows at once;
  // Apple is asked again only when it could have published something new (or on Refresh now).
  // No app chosen means all apps together, the default.
  const liveApps = apps.mode === "live" ? apps.apps : null;
  const app = liveApps?.find((a) => a.id === selectedId);
  const vendorNumber = status?.configured ? status.vendorNumber : "";
  const requestKey = liveApps?.length && status?.configured ? `${app?.id ?? ALL_APPS}|${range}|${vendorNumber}|${status.savedAt}` : null;
  useEffect(() => {
    if (!requestKey || !liveApps) return;
    let cancelled = false;
    const auth = keychainAuth(vendorNumber);
    const forced = reloadKey > 0 && refreshed.current !== reloadKey;
    refreshed.current = reloadKey;
    const show = (stored: StoredDataset, checking: boolean, error?: string) =>
      setLoaded({ key: requestKey, state: { status: "ready", dataset: stored.dataset, freshness: { checkedAt: stored.checkedAt, nextCheckAt: stored.nextCheckAt, now: Date.now(), checking, error } } });
    void (async () => {
      const saved = await (app ? storedDataset(desktopPlatform, auth, app, range) : storedPortfolio(desktopPlatform, auth, liveApps, range)).catch(() => null);
      if (cancelled) return;
      if (saved && !forced && !isDue(saved)) return show(saved, false);
      if (saved) show(saved, true);
      try {
        const fresh = app ? await refreshDataset(desktopPlatform, auth, app, range) : await buildPortfolio(desktopPlatform, auth, liveApps, range, { refresh: forced });
        if (!cancelled) show(fresh, false);
      } catch (e) {
        if (cancelled) return;
        if (saved) show(saved, false, messageOf(e));
        else setLoaded({ key: requestKey, state: { status: "error", message: messageOf(e) } });
      }
    })();
    return () => { cancelled = true; };
  }, [requestKey, app, liveApps, vendorNumber, range, reloadKey]);

  // Analytics readiness for the Table viewer (live accounts only).
  const readinessKey = apps.mode === "live" && status?.configured && !status.locked ? `${status.savedAt}|${vendorNumber}` : null;
  const [loadedReadiness, setLoadedReadiness] = useState<{ key: string; result: ReadinessResult } | null>(null);
  useEffect(() => {
    if (!readinessKey || screen !== "tables") return;
    let cancelled = false;
    void getReadiness(desktopPlatform, keychainAuth(vendorNumber)).then((result) => { if (!cancelled) setLoadedReadiness({ key: readinessKey, result }); });
    return () => { cancelled = true; };
  }, [readinessKey, vendorNumber, screen]);
  const readiness = loadedReadiness?.key === readinessKey ? loadedReadiness.result : null;

  const demo = useMemo(() => demoDataset(range), [range]);
  const data: DataState =
    apps.mode === "loading" ? { status: "loading" }
    : apps.mode !== "live" ? { status: "ready", dataset: demo }
    : !liveApps?.length ? { status: "error", message: "This key can't see any apps. Check its access in App Store Connect." }
    : loaded?.key === requestKey ? loaded.state
    : { status: "loading" };

  // Check again when Apple could have published, or as soon as Peakly is back in front after that time.
  const nextCheck = data.status === "ready" && !data.freshness?.checking ? data.freshness?.nextCheckAt ?? null : null;
  useEffect(() => {
    if (!nextCheck) return;
    const checkIfDue = () => { if (Date.now() >= nextCheck) setReloadKey((key) => key + 1); };
    const timer = window.setTimeout(checkIfDue, Math.min(Math.max(nextCheck - Date.now(), 60_000), 6 * 3_600_000));
    window.addEventListener("focus", checkIfDue);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", checkIfDue); };
  }, [nextCheck]);

  const sidebarApps = apps.mode === "live" ? apps.apps.map((a) => ({ id: a.id, name: a.name, iconUrl: a.iconUrl })) : [];

  return (
    <div className="flex h-full">
      <SidebarFrame>
        <AppSwitcherView apps={sidebarApps} mode={apps.mode === "live" || apps.mode === "error" || apps.mode === "locked" ? apps.mode : "demo"}
          selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setScreen("insights"); }} />
        <SidebarNav active={screen} renderItem={(s, { className, current, children }) => (
          <button key={s} type="button" onClick={() => setScreen(s)} aria-current={current ? "page" : undefined} className={className}>{children}</button>
        )} />
      </SidebarFrame>
      <main className="min-w-0 flex-1 overflow-y-auto bg-card px-10 pb-10 pt-5">
        <PageTopBar openExternal={openInBrowser} className="mb-3" />
        {(screen === "insights" || screen === "tables") && locked}
        {screen === "insights" && !locked && (
          <InsightsScreen apps={apps} data={data} range={range} grain={grain}
            onRange={setRange} onGrain={setGrain} onSettings={() => setScreen("settings")} onRetry={() => setReloadKey((k) => k + 1)} />
        )}
        {screen === "mcp" && <McpView />}
        {screen === "tables" && !locked && (
          data.status === "ready" ? (
            <DataExplorer
              key={`${app?.id ?? ALL_APPS}|${range}|${status?.configured ? status.savedAt : ""}`}
              lazy={REPORT_TABS}
              loadLazy={liveApps && !data.dataset.demo ? (id) => {
                const spec = REPORT_TABLES.find((t) => t.id === id)!;
                return loadReportTable(desktopPlatform, keychainAuth(vendorNumber), app ? [app] : liveApps, spec, range);
              } : undefined}
              appName={data.dataset.demo ? "the sample app" : data.dataset.app.id === ALL_APPS ? "all apps" : data.dataset.app.name}
              tables={buildExplorerTables({
                apps: apps.mode === "live" ? apps.apps : [data.dataset.app],
                dataset: data.dataset,
                readiness: data.dataset.demo ? demoReadiness(data.dataset) : readiness,
              })}
              controls={<RangeSelectView value={range} onChange={setRange} />}
            />
          ) : (
            <InsightsScreen apps={apps} data={data} range={range} grain={grain}
              onRange={setRange} onGrain={setGrain} onSettings={() => setScreen("settings")} onRetry={() => setReloadKey((k) => k + 1)} />
          )
        )}
        {screen === "feedback" && <FeedbackView boardUrl={feedbackBoardUrl(import.meta.env.VITE_VOTEWANT_BOARD)} openExternal={openInBrowser} />}
        {screen === "settings" && <DesktopSettings status={status} onUnlock={unlock}
          onChanged={async () => { await refreshConnection(); setReloadKey((k) => k + 1); }} />}
      </main>
    </div>
  );
}

function InsightsScreen({ apps, data, range, grain, onRange, onGrain, onSettings, onRetry }: {
  apps: AppsState; data: DataState; range: number; grain: Grain;
  onRange: (d: number) => void; onGrain: (g: Grain) => void; onSettings: () => void; onRetry: () => void;
}) {
  const settingsButton = (label: string) => <button type="button" onClick={onSettings} className="font-medium text-accent underline">{label}</button>;
  if (apps.mode === "error") {
    return <Notice tone="error" title="Couldn't load your App Store Connect account">{apps.message} {settingsButton("Check your key in Settings")}.</Notice>;
  }
  if (data.status === "error") {
    return <Notice tone="error" title="Couldn't load reports">{data.message} <button type="button" onClick={onRetry} className="font-medium text-accent underline">Try again</button>.</Notice>;
  }
  if (data.status === "loading") {
    return (
      <div className="mx-auto max-w-[1240px] animate-pulse" aria-busy="true" aria-label="Loading reports">
        <div className="h-12 w-72 rounded-xl bg-card-muted" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-36 rounded-2xl border border-line bg-card-muted" />)}</div>
        <div className="mt-5 h-[420px] rounded-2xl border border-line bg-card-muted" />
        <p className="mt-4 text-sm text-ink-3">Fetching reports from App Store Connect. The first load downloads each report once; later loads use the cache on this Mac.</p>
      </div>
    );
  }
  return (
    <Dashboard
      dataset={data.dataset}
      range={range}
      grain={grain}
      rangeControl={<RangeSelectView value={range} onChange={onRange} />}
      renderGrain={(g, { className, active, children }) => (
        <button key={g} type="button" onClick={() => onGrain(g)} aria-pressed={active} className={className}>{children}</button>
      )}
      settingsLink={(children) => <button type="button" onClick={onSettings} className="font-medium text-accent underline">{children}</button>}
      freshness={data.freshness}
      refreshControl={<button type="button" onClick={onRetry} className="font-medium text-accent underline">Refresh now</button>}
    />
  );
}

function DesktopSettings({ status, onChanged, onUnlock }: { status: DesktopStatus | null; onChanged: () => Promise<void>; onUnlock: () => Promise<void> }) {
  const [loadedReadiness, setLoadedReadiness] = useState<{ key: string; result: ReadinessResult } | null>(null);
  const [readinessRevision, setReadinessRevision] = useState(0);
  const readinessKey = status?.configured && !status.locked ? `${status.savedAt}|${status.vendorNumber}` : null;
  const vendorNumber = status?.configured ? status.vendorNumber : "";

  useEffect(() => {
    if (!readinessKey) return;
    let cancelled = false;
    void getReadiness(desktopPlatform, keychainAuth(vendorNumber)).then((result) => { if (!cancelled) setLoadedReadiness({ key: readinessKey, result }); });
    return () => { cancelled = true; };
  }, [readinessKey, vendorNumber, readinessRevision]);
  const readiness = loadedReadiness?.key === readinessKey ? loadedReadiness.result : null;
  const hasWaitingApps = readiness?.ok && readiness.apps.some((app) => app.analytics === "waiting");
  useEffect(() => {
    if (!readinessKey || !hasWaitingApps) return;
    const timer = window.setInterval(() => {
      void getReadiness(desktopPlatform, keychainAuth(vendorNumber)).then((result) => {
        setLoadedReadiness({ key: readinessKey, result });
      });
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [readinessKey, vendorNumber, hasWaitingApps]);

  if (!inDesktopApp) {
    return <Notice tone="info" title="Open the Peakly app to connect a key">This preview runs in a browser, which can&apos;t reach the macOS Keychain. Sample data is shown instead.</Notice>;
  }

  const save = async (_prev: SaveState, form: FormData): Promise<SaveState> => {
    const parsed = await parseConnectionForm(form);
    if (!parsed.ok) return parsed.state;
    try {
      const problem = await verifyKey(desktopPlatform, candidateAuth(parsed.credentials));
      if (problem) return { ok: false, message: problem, values: parsed.values };
      await saveCredentials(parsed.credentials);
    } catch (e) {
      return { ok: false, message: messageOf(e), values: parsed.values };
    }
    await onChanged();
    return { ok: true, message: "Connected. The key is stored in this Mac's Keychain." };
  };

  const saveVendor = async (_prev: SaveState, form: FormData): Promise<SaveState> => {
    const vendorNumber = parseVendorNumber(form);
    if (!vendorNumber) return { ok: false, message: "Vendor number is 6–12 digits, from Payments and Financial Reports." };
    try {
      const problem = await verifyVendor(desktopPlatform, keychainAuth(vendorNumber));
      if (problem) return { ok: false, message: problem };
      await setVendorNumber(vendorNumber);
      await onChanged();
      return { ok: true, message: "Vendor number saved. Sales reports are now included." };
    } catch (e) {
      return { ok: false, message: messageOf(e) };
    }
  };

  return (
    <SettingsScreen
      intro="Connect a read-only key. Peakly talks to Apple directly from this Mac; the key is kept in the macOS Keychain and never leaves this computer."
      configured={Boolean(status?.configured)}
      form={<AscConnectionForm save={save} />}
      connected={status?.configured && (status.locked ? (
        <UnlockPanel bare keyId={status.keyId} onUnlock={onUnlock}>
          <button type="button" onClick={() => { if (confirm("Remove this key from the Keychain? Peakly will switch back to sample data.")) void removeCredentials().then(onChanged); }}
            className="mt-3 block w-full text-sm font-medium text-bad hover:underline">Remove key</button>
        </UnlockPanel>
      ) : (
        <ConnectedAsc keyId={status.keyId} vendorTail={status.vendorNumber.slice(-3)} savedAt={status.savedAt}
          check={() => checkConnection(desktopPlatform, keychainAuth(status.vendorNumber))}
          remove={async () => { await removeCredentials(); await onChanged(); }}
          saveVendor={saveVendor}
          removeConfirm="Remove this key from the Keychain? Peakly will switch back to sample data." />
      ))}
      readiness={status?.configured && status.locked ? null : readiness ? <ReadinessView result={readiness} renderActivation={(app) => (
        <AnalyticsActivation
          key={`${status?.configured ? status.issuerId : ""}:${app.id}`}
          app={app}
          issuerId={status?.configured ? status.issuerId : ""}
          preview={(credentials, appId) => previewAnalyticsActivation(desktopPlatform, candidateAuth(credentials), appId)}
          activate={(credentials, plan) => createAnalyticsActivation(desktopPlatform, candidateAuth(credentials), plan)}
          onComplete={async () => { await onChanged(); setReadinessRevision((revision) => revision + 1); }}
        />
      )} /> : READINESS_FALLBACK}
      guideFooter="If an app needs Analytics Reports, use the app-specific setup above. Peakly asks Apple to create anything only after showing you the request and getting your confirmation."
    />
  );
}
