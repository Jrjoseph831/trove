/** Money: whole dollars with commas ("$1,234"), but cents for sub-dollar
 *  prices so cheap items show "$0.12" instead of rounding to "$0". */
export function money(n: number): string {
  const sign = n < 0 ? "-$" : "$";
  const a = Math.abs(n);
  if (a > 0 && a < 1) return sign + a.toFixed(2);
  return sign + Math.round(a).toLocaleString();
}

/** Signed percentage to one decimal, e.g. "+2.4%". */
export function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Percent change between a previous and current value. */
export function pctChange(value: number, prev: number): number {
  return prev ? ((value - prev) / prev) * 100 : 0;
}
