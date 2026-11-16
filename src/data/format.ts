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
