"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { RANGES } from "@/core/ranges";

export function RangeSelectView({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <label className="relative inline-flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5 text-[15px] text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <CalendarDays className="size-[18px] text-ink-2" aria-hidden />
      <span>Last {value} days</span>
      <ChevronDown className="size-4 text-ink-2" aria-hidden />
      <select aria-label="Date range" className="absolute inset-0 cursor-pointer opacity-0" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {RANGES.map((r) => <option key={r} value={r}>Last {r} days</option>)}
      </select>
    </label>
  );
}
