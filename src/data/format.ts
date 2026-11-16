// DSH-2 formatting — null renders 'not recorded', never 0 (a missing
// measurement is not a zero measurement). Mirrors metrics.py _fmt.

export function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'not recorded';
  // Defense-in-depth: non-finite values render 'not recorded' too (DSH-2
  // review FINDING-2). The data layer already guarantees finite-or-null,
  // but fmt is the last line before display.
  if (!Number.isFinite(value)) return 'not recorded';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

// DSH-3 AC 2: cost is tokens-only until a price table exists — a recorded
// 0 is "unknown", not a free run (wall_s zero, by contrast, IS real).
export function costDisplay(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined || costUsd === 0) return 'not recorded';
  if (!Number.isFinite(costUsd)) return 'not recorded';
  return costUsd.toFixed(2);
}
