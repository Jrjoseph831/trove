/** Money: whole dollars with commas ("$1,234"), but cents for sub-dollar
 *  prices so cheap items show "$0.12" instead of rounding to "$0". */
export function money(n: number): string {
  const sign = n < 0 ? "-$" : "$";
  const a = Math.abs(n);
  if (a > 0 && a < 1) return sign + a.toFixed(2);
  return sign + Math.round(a).toLocaleString();
}

/** Money, collapsed to "$12.48M" / "$1.24B" / "$3.40T" from a MILLION up —
 *  for net worth, cash, assets, debt, and company valuations shown at a glance
 *  (sidebar, standings, Deal Room, Supply, Order Desk). Seven-plus digits read
 *  as a shape rather than a figure: "$12,481,930" takes a beat to place,
 *  "$12.48M" doesn't, and the trailing digits churn constantly without ever
 *  mattering at a glance. Below a million the exact number still earns its
 *  space. The Reports page keeps exact money() throughout — that's where the
 *  real digits matter. */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-$" : "$";
  // Boundaries sit just below each round number because the value is shown to
  // two decimals: $999,999,999 is under a billion but renders as "1000.00M",
  // which is a four-digit mantissa nobody wants to read. Promote it instead.
  if (a >= 999.995e9) return sign + (a / 1e12).toFixed(2) + "T";
  if (a >= 999.995e6) return sign + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + "M";
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
