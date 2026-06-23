/** Money like the prototype: "$1,234" / "-$1,234". */
export function money(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();
}

/** Signed percentage to one decimal, e.g. "+2.4%". */
export function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Percent change between a previous and current value. */
export function pctChange(value: number, prev: number): number {
  return prev ? ((value - prev) / prev) * 100 : 0;
}
