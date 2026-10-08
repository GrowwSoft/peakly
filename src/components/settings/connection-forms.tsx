"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, CircleX, KeyRound, Loader2, Upload } from "lucide-react";
import type { CheckResult, SaveAction, SaveState } from "@/core/settings-types";
import { keyIdFromFileName } from "@/core/key-file";

const input = "mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)]";

function Field({ label, name, hint, error, ...rest }: { label: string; name: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input name={name} className={input} aria-invalid={error ? true : undefined} autoComplete="off" spellCheck={false} {...rest} />
      {error ? <span className="mt-1 block text-xs font-normal text-bad">{error}</span> : hint && <span className="mt-1 block text-xs font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

/** Two-step connection form. `save` is a Server Action on the web and a Keychain-backed function in the Mac app. */
export function AscConnectionForm({ save }: { save: SaveAction }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(save, { ok: false, message: "" });
  const e = state.fieldErrors ?? {};
  const [keyText, setKeyText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [keyId, setKeyId] = useState("");
  const [editKeyId, setEditKeyId] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [issuerId, setIssuerId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (!text.includes("BEGIN PRIVATE KEY")) {
      setFileError("That doesn't look like an App Store Connect .p8 key.");
      return;
    }
    setFileError(null);
    setKeyText(text);
    setFileName(file.name);
    const detected = keyIdFromFileName(file.name);
    setKeyId(detected ?? "");
    setEditKeyId(!detected);
  };

  const hasKey = keyText.trim().length > 0;
  const showKeyId = editKeyId || pasting || Boolean(e.keyId);

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="privateKey" value={keyText} />
      {!showKeyId && <input type="hidden" name="keyId" value={keyId} />}

      {/* Step 1: the key file */}
      <div>
        <p className="text-sm font-medium text-ink"><span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">1</span>Your API key file</p>
        {pasting ? (
          <textarea rows={5} value={keyText} onChange={(ev) => setKeyText(ev.target.value)}
            className={`${input} font-mono text-xs`} placeholder="-----BEGIN PRIVATE KEY-----" autoComplete="off" spellCheck={false}
            aria-label="Private key contents" aria-invalid={e.privateKey ? true : undefined} />
        ) : hasKey && fileName ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-[var(--tone-green-bg)] px-4 py-3 text-sm">
            <CheckCircle2 className="size-5 text-good" aria-hidden />
            <span className="font-medium text-ink">{fileName}</span>
            {keyId && !editKeyId && (
              <span className="text-ink-2">Key ID <span className="font-mono text-ink">{keyId}</span>
                <button type="button" onClick={() => setEditKeyId(true)} className="ml-2 text-accent hover:underline">edit</button>
              </span>
            )}
            <button type="button" onClick={() => { setKeyText(""); setFileName(null); setKeyId(""); setEditKeyId(false); }} className="ml-auto text-ink-3 hover:text-ink">Replace</button>
          </div>
        ) : (
          <label
            onDragOver={(ev) => { ev.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(ev) => { ev.preventDefault(); setDragging(false); void loadFile(ev.dataTransfer.files[0]); }}
            className={`mt-1.5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-accent bg-accent-soft" : "border-line bg-card-muted hover:border-accent"}`}
          >
            <Upload className="size-6 text-accent" aria-hidden />
            <span className="text-[15px] font-medium text-ink">Drop your <span className="font-mono text-sm">AuthKey_….p8</span> here</span>
            <span className="text-sm text-ink-3">or click to choose it</span>
            <input type="file" accept=".p8,text/plain" className="sr-only" onChange={(ev) => void loadFile(ev.target.files?.[0])} />
          </label>
        )}
        {(fileError || e.privateKey) && <p className="mt-1.5 text-xs text-bad">{fileError ?? e.privateKey}</p>}
        <button type="button" onClick={() => { setPasting((p) => !p); setKeyText(""); setFileName(null); setFileError(null); }} className="mt-2 text-xs text-accent hover:underline">
          {pasting ? "Upload the file instead" : "Paste the key text instead"}
        </button>
        {showKeyId && (
          <div className="mt-3 max-w-xs">
            <Field label="Key ID" name="keyId" placeholder="2X9R4HXF34" error={e.keyId} value={keyId}
              onChange={(ev) => setKeyId(ev.target.value.toUpperCase())} hint="Shown next to the key in App Store Connect." />
          </div>
        )}
      </div>

      {/* Step 2: issuer */}
      <div className="max-w-xl">
        <label className="block text-sm font-medium text-ink">
          <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">2</span>Issuer ID
          <input name="issuerId" value={issuerId} onChange={(ev) => setIssuerId(ev.target.value)} placeholder="57246542-96fe-1a63-e053-0824d011072a"
            className={input} aria-invalid={e.issuerId ? true : undefined} autoComplete="off" spellCheck={false} />
        </label>
        <p className={`mt-1 text-xs ${e.issuerId ? "text-bad" : "text-ink-3"}`}>{e.issuerId ?? "Shown above the keys list on the same App Store Connect page."}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending || !hasKey || !issuerId.trim()} className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          {pending ? "Verifying with Apple…" : "Connect"}
        </button>
        <span className="text-xs text-ink-3">Read-only. Apple verifies the key before it&apos;s saved. Sales can be added after.</span>
      </div>
      {state.message && !state.ok && <p className="text-sm text-bad" role="alert">{state.message}</p>}
      {state.message && state.ok && <p className="text-sm text-good" role="status">{state.message}</p>}
    </form>
  );
}

const ICON = { pass: CheckCircle2, warn: CircleAlert, fail: CircleX };
const COLOR = { pass: "text-good", warn: "text-[var(--tone-amber-ink)]", fail: "text-bad" };

export function ConnectedAsc({ keyId, vendorTail, savedAt, check, remove, saveVendor, removeConfirm }: {
  keyId: string; vendorTail: string; savedAt: string;
  check: () => Promise<CheckResult[]>; remove: () => Promise<void>; saveVendor: SaveAction; removeConfirm: string;
}) {
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [removing, startRemove] = useTransition();

  return (
    <div className="mt-6">
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-ink-3">Key ID</dt><dd className="mt-0.5 font-mono text-ink">{keyId}</dd></div>
        <div><dt className="text-ink-3">Vendor number</dt><dd className="mt-0.5 font-mono text-ink">{vendorTail ? `•••${vendorTail}` : <span className="font-sans text-ink-3">Not set · sales off</span>}</dd></div>
        <div><dt className="text-ink-3">Saved</dt><dd className="mt-0.5 text-ink">{new Date(savedAt).toLocaleString()}</dd></div>
      </dl>
      {!vendorTail && <VendorNumberForm save={saveVendor} />}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" disabled={checking}
          onClick={() => startCheck(async () => { setError(null); try { setChecks(await check()); } catch (e) { setError((e as Error).message); } })}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-card-muted disabled:opacity-60">
          {checking && <Loader2 className="size-4 animate-spin" aria-hidden />}Test connection
        </button>
        <button type="button" disabled={removing}
          onClick={() => { if (confirm(removeConfirm)) startRemove(async () => { try { await remove(); } catch (e) { setError((e as Error).message); } }); }}
          className="rounded-xl px-4 py-2 text-sm font-medium text-bad hover:bg-card-muted disabled:opacity-60">
          Remove key
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
      {checks && (
        <ul className="mt-5 space-y-2" aria-live="polite">
          {checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <li key={c.label} className="flex gap-3 rounded-xl bg-card-muted px-4 py-3 text-sm">
                <Icon className={`mt-0.5 size-4 shrink-0 ${COLOR[c.status]}`} aria-hidden />
                <span><span className="font-medium text-ink">{c.label}</span> <span className="text-ink-2">— {c.detail}</span></span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VendorNumberForm({ save }: { save: SaveAction }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(save, { ok: false, message: "" });
  return (
    <form action={action} className="mt-5 flex flex-wrap items-end gap-3 rounded-xl bg-card-muted p-4">
      <label className="block text-sm font-medium text-ink">
        Add a vendor number to include sales
        <input name="vendorNumber" inputMode="numeric" placeholder="88123456" autoComplete="off" className={`${input} w-56`} />
      </label>
      <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? "Checking…" : "Save"}
      </button>
      {state.message && <p className={`w-full text-sm ${state.ok ? "text-good" : "text-bad"}`} role="status">{state.message}</p>}
    </form>
  );
}
