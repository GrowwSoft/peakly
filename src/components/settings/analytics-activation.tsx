"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import type { AscCredentials } from "@/core/asc/jwt";
import type { AnalyticsActivationPlan } from "@/core/analytics-activation";
import { ascCredentialsSchema } from "@/core/credentials";
import { keyIdFromFileName } from "@/core/key-file";
import type { AppReadiness } from "@/core/readiness";

const input = "mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)]";
type Phase = "closed" | "credentials" | "review" | "done";

/** One-time, on-device Admin-key flow. Credentials only live in this component's memory. */
export function AnalyticsActivation({ app, issuerId: accountIssuerId, preview, activate, onComplete }: {
  app: AppReadiness;
  issuerId: string;
  preview: (credentials: AscCredentials, appId: string) => Promise<AnalyticsActivationPlan>;
  activate: (credentials: AscCredentials, plan: Pick<AnalyticsActivationPlan, "appId" | "appName">) => Promise<"requested" | "already_enabled">;
  onComplete: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [issuerId] = useState(accountIssuerId);
  const [keyId, setKeyId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [plan, setPlan] = useState<AnalyticsActivationPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const discard = () => {
    setPrivateKey("");
    setKeyId("");
    setPlan(null);
    setError("");
    setPhase("closed");
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    if (!text.includes("BEGIN PRIVATE KEY")) {
      setError("That doesn't look like an App Store Connect .p8 key.");
      setPrivateKey("");
      setKeyId("");
      return;
    }
    setError("");
    setPrivateKey(text);
    setKeyId(keyIdFromFileName(file.name) ?? "");
  };

  const credentials = (): AscCredentials | null => {
    const parsed = ascCredentialsSchema.safeParse({ issuerId, keyId, privateKey, vendorNumber: "" });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the Issuer ID and .p8 file.");
      return null;
    }
    return parsed.data;
  };

  const makePreview = async () => {
    const candidate = credentials();
    if (!candidate) return;
    setBusy(true);
    setError("");
    try {
      const result = await preview(candidate, app.id);
      setPlan(result);
      setPhase("review");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message.includes("(403)") || message.includes("HTTP_403")
        ? "Apple denied access. Use an Admin key for this account, then try again."
        : message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const candidate = credentials();
    if (!candidate || !plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await activate(candidate, plan);
      setPhase("done");
      setPrivateKey("");
      setKeyId("");
      setPlan(null);
      setError(result === "requested"
        ? "Request sent to Apple. First reports usually arrive in 24–48 hours."
        : "Analytics reports are already enabled for this app.");
      try {
        await onComplete();
      } catch {
        setError("The request reached Apple, but Peakly couldn't refresh the app list. Reopen Settings to check its status.");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message.includes("(403)") || message.includes("HTTP_403")
        ? "Apple denied the request. Confirm this is an Admin key for the account that owns this app."
        : message);
    } finally {
      setBusy(false);
    }
  };

  if (phase === "closed") {
    return <button type="button" onClick={() => { setError(""); setPhase("credentials"); }}
      className="text-sm font-medium text-accent underline">Enable analytics for {app.name}</button>;
  }

  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-card p-4 text-left">
      {phase === "credentials" && (
        <>
          <p className="font-semibold text-ink">Use an Admin key for this one-time setup</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">Peakly uses it on this Mac to preview the request. It stays in memory for this setup only and is never saved to the Keychain.</p>
          <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line bg-card-muted px-3 py-3 text-sm text-ink hover:border-accent">
            <Upload className="size-4 text-accent" aria-hidden />
            <span>{privateKey ? `AuthKey_${keyId}.p8 selected` : "Choose the Admin .p8 file"}</span>
            <input type="file" accept=".p8,text/plain" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} />
          </label>
          <p className="mt-3 text-xs text-ink-3">Using this account&apos;s Issuer ID <code className="font-mono text-ink-2">{issuerId}</code>.</p>
          {!keyId && privateKey && <label className="mt-3 block text-sm font-medium text-ink">Key ID
            <input value={keyId} onChange={(event) => setKeyId(event.target.value.toUpperCase())} className={input}
              placeholder="Shown next to the key in App Store Connect" autoComplete="off" spellCheck={false} />
          </label>}
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={busy || !privateKey || !issuerId.trim()} onClick={() => void makePreview()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{busy ? "Checking with Apple…" : "Preview request"}
            </button>
            <button type="button" disabled={busy} onClick={discard} className="px-3 py-2 text-sm text-ink-2">Cancel</button>
          </div>
        </>
      )}

      {phase === "review" && plan && (
        <>
          <p className="font-semibold text-ink">Review this App Store Connect change</p>
          <div className="mt-2 rounded-lg bg-card-muted p-3 text-sm text-ink-2">
            <p><span className="text-ink-3">App</span> · {plan.appName} ({plan.appId})</p>
            <p className="mt-1"><span className="text-ink-3">Current status</span> · {plan.status === "already_enabled" ? "An ongoing request already exists" : plan.status === "stopped" ? "An earlier ongoing request was stopped" : "No ongoing request exists"}</p>
            {plan.status !== "already_enabled" && <p className="mt-1 font-medium text-ink">Create an ongoing Analytics Reports request for {plan.appName}.</p>}
          </div>
          <p className="mt-2 text-xs text-ink-3">{plan.status === "already_enabled" ? "Peakly will keep using your saved read-only key." : "Apple starts publishing reports in about 24–48 hours. Peakly will keep using your saved read-only key."}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {plan.status !== "already_enabled" && <button type="button" disabled={busy} onClick={() => void confirm()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{busy ? "Sending request…" : `Create request for ${plan.appName}`}
            </button>}
            <button type="button" disabled={busy} onClick={discard} className="px-3 py-2 text-sm text-ink-2">{plan.status === "already_enabled" ? "Done" : "Cancel"}</button>
          </div>
        </>
      )}

      {phase === "done" && <button type="button" onClick={discard} className="text-sm font-medium text-accent underline">Done</button>}
      {error && <p className={`mt-3 text-sm ${phase === "done" ? "text-good" : "text-bad"}`} role={phase === "done" ? "status" : "alert"}>{error}</p>}
    </div>
  );
}
