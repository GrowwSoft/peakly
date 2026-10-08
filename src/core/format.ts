export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  if (Math.abs(value) >= 1_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return value.toLocaleString("en-US");
}

export function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

export function signedPercent(value: number): string {
  const p = Math.round(value * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

export function signedPoints(value: number): string {
  const p = value * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1).replace(/\.0$/, "")} pp`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

export function shortMonth(iso: string): string {
  return MONTHS[Number(iso.split("-")[1]) - 1]!;
}
