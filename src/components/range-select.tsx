"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { RangeSelectView } from "./range-select-view";

export function RangeSelect({ value }: { value: number }) {
  const router = useRouter();
  const params = useSearchParams();
  return <RangeSelectView value={value} onChange={(days) => { const next = new URLSearchParams(params); next.set("range", String(days)); router.push(`?${next}`); }} />;
}
