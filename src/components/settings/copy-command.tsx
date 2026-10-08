"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--ink)] p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-white">{command}</code>
      <button
        type="button"
        onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}
        className="shrink-0 rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        aria-label={copied ? "Copied" : "Copy command"}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
