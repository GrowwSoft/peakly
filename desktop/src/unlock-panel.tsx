import { useState, useTransition } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "Couldn't unlock the key.");

/**
 * Shown wherever data needs the saved App Store Connect key before it has been read
 * from the Keychain in this launch. One unlock covers every screen until Peakly quits.
 */
export function UnlockPanel({ keyId, onUnlock, bare = false, children }: { keyId: string; onUnlock: () => Promise<void>; bare?: boolean; children?: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={bare ? "mt-6 text-center" : "mx-auto max-w-[640px] rounded-2xl border border-line bg-card p-8 text-center"} aria-labelledby="unlock-title">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--tone-blue-bg)] text-[var(--tone-blue-ink)]"><LockKeyhole className="size-6" aria-hidden /></span>
      <h2 id="unlock-title" className="mt-4 text-xl font-semibold text-ink">Your App Store Connect key is locked</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        {keyId ? <>Key <span className="font-mono text-ink">{keyId}</span> is saved in this Mac&apos;s Keychain. </> : "A key is saved in this Mac's Keychain. "}
        Peakly reads it only when you unlock. Once unlocked, every screen uses it until you quit Peakly.
      </p>
      <button type="button" disabled={pending}
        onClick={() => start(async () => { setError(null); try { await onUnlock(); } catch (e) { setError(messageOf(e)); } })}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LockKeyhole className="size-4" aria-hidden />}Unlock
      </button>
      {error && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
      {children}
    </section>
  );
}
