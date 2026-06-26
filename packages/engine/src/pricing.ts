/**
 * Canonical price math — the SINGLE source for what a produced unit lists/sells
 * for. Everything that shows or charges a listed price (the storefront on a
 * company website, passive listing sales, order anchoring, the order endpoint's
 * validation) must go through `listedUnitPrice` so the numbers always line up.
 * Kept dependency-free so both index.ts and orders.ts can import it (no cycle).
 */

/** QC Hub upgrade premium on everything you sell. */
export const QC_PREMIUM = 0.06;

/** What one unit of a produced good lists/sells for: market value × your markup
 *  × the QC premium (if the QC Hub is installed). The one true formula. */
export function listedUnitPrice(value: number, mult: number, qcOn: boolean): number {
  return value * mult * (qcOn ? 1 + QC_PREMIUM : 1);
}
