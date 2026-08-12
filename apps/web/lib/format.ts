/** Money: whole dollars with commas ("$1,234"), but cents for sub-dollar
 *  prices so cheap items show "$0.12" instead of rounding to "$0". */
export function money(n: number): string {
  const sign = n < 0 ? "-$" : "$";
  const a = Math.abs(n);
  if (a > 0 && a < 1) return sign + a.toFixed(2);
  return sign + Math.round(a).toLocaleString();
}

/** Money, but collapsed to "$1.24B" / "$3.40T" once it reaches ten figures —
 *  for net worth, cash, assets, debt, and company valuations shown at a
 *  glance (sidebar, standings, Deal Room). Below a billion, identical to
 *  money(). The Reports page keeps exact money() throughout — that's where
 *  the real digits matter. */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-$" : "$";
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + "B";
  return money(n);
}

/** Signed percentage to one decimal, e.g. "+2.4%". */
export function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Percent change between a previous and current value. */
export function pctChange(value: number, prev: number): number {
  return prev ? ((value - prev) / prev) * 100 : 0;
}

const FIRM_TAIL =
  /\s+(holdings?|capital|group|trading|partners|house|ventures|industries|works|syndicate|trust|llc|inc\.?|firm|exchange|traders|mfg\.?|corp\.?|company|associates|bros\.?|sons|co\.?)$/i;

/** Your production division's name: "G&H Holdings" → "G&H Manufacturing".
 *  Goods you produce are branded under this, not the original catalog maker. */
export function manufacturingName(holding: string | null | undefined): string {
  if (!holding) return "Trove Manufacturing";
  const base = holding.replace(/\s+/g, " ").trim().replace(FIRM_TAIL, "").trim();
  return `${base || holding} Manufacturing`;
}
