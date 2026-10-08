/** Wilson score interval for a proportion. Honest at small samples, unlike a raw ratio. */
export function wilsonInterval(successes: number, trials: number, z = 1.96): { low: number; high: number } | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0 || successes < 0) return null;
  const k = Math.min(successes, trials);
  const p = k / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Relative change; null when the base is unknown or zero (a change from nothing is not a percentage). */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}
