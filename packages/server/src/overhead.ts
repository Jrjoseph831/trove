/**
 * Structural overhead — the costs that apply to scale and wealth, not to risk.
 * Unlike heat (erratic, punishing) these are predictable and boring by design:
 * they're the tax on building big, not a mechanic for making bold moves dangerous.
 *
 * applyPayroll   — charged per production tick per active factory line
 * applyFlipOverhead — charged per 6h market flip (warehousing + progressive tax)
 */
import { emptyLedger, type WorldState } from "@trove/engine";

/** Flat labor cost per active (running or idle) factory line per production tick. */
export const PAYROLL_PER_LINE = 20; // $20/tick → at 5 lines: $100/tick, $1,200/hr

/**
 * Deduct payroll for `ticks` production cycles. Only fires when ticks > 0, so
 * a zero-production run (already caught up) charges nothing. Overflow to debt
 * keeps cash from going negative — the player is implicitly leveraging to cover
 * their workforce. Engine's existing lineUpkeep covers capital/machinery; this
 * is purely the labor line.
 */
export function applyPayroll(pv: WorldState, ticks: number): void {
  if (ticks <= 0) return;
  // "running" = produced this tick; "idle" = live but short on inputs.
  // Both still employ workers — only "mothballed" lines have laid off their crew.
  const activeLines = pv.factories.filter(
    (f) => f.status === "running" || f.status === "idle",
  ).length;
  if (activeLines === 0) return;
  const amount = activeLines * PAYROLL_PER_LINE * ticks;
  pv.ledger ??= emptyLedger();
  pv.ledger.payroll = (pv.ledger.payroll ?? 0) + amount;
  pv.cash -= amount;
  if (pv.cash < 0) {
    pv.debt += -pv.cash;
    pv.cash = 0;
  }
}

/** Marginal progressive tax on net-of-debt net worth, per 6h flip.
 *  Bands are 1/4 of the intended daily rates (4 settlements per real day):
 *    $0–$50k       →  0%
 *    $50k–$250k    →  0.75%/flip  (3%/day)
 *    $250k–$1M     →  1.50%/flip  (6%/day)
 *    $1M+          →  2.50%/flip  (10%/day)
 *
 * Net-of-debt so leverage doesn't inflate the bracket — a player with $1M in
 * goods and $600k in debt sits in the $400k bracket, not the $1M one.
 */
function progressiveTax(netWorth: number): number {
  if (netWorth <= 50_000) return 0;
  // Marginal: charge the rate only on the amount inside each band.
  const b1 = Math.min(Math.max(0, netWorth - 50_000), 200_000); // 50k–250k
  const b2 = Math.min(Math.max(0, netWorth - 250_000), 750_000); // 250k–1M
  const b3 = Math.max(0, netWorth - 1_000_000);                  // 1M+
  return Math.round(b1 * 0.0075 + b2 * 0.015 + b3 * 0.025);
}

/**
 * Per-flip overhead: warehousing + progressive tax. Called once inside the
 * captureFlip loop in production.ts — after captureFlip() so the report
 * snapshot reflects pre-overhead net worth, then overhead is deducted.
 *
 * Warehousing: 0.75%/flip of held inventory market value. Proportional so a
 * scandal that craters your sector also (slightly) relieves storage burden —
 * the overhead is part of the same market-reactive fabric as everything else.
 *
 * Tax: marginal on net-of-debt net worth. Overflow to debt on cash shortfall.
 */
export function applyFlipOverhead(pv: WorldState): void {
  const holdingsValue = pv.items.reduce(
    (s, it) => s + (it.owners["YOU"] ?? 0) * it.value,
    0,
  );
  const propValue = pv.properties.reduce((s, p) => s + p.value, 0);
  const netWorth = pv.cash - pv.debt + holdingsValue + propValue;

  const storage = Math.round(holdingsValue * 0.0075);
  const tax = progressiveTax(netWorth);
  const total = storage + tax;

  if (total > 0) {
    pv.ledger ??= emptyLedger();
    pv.ledger.fees = (pv.ledger.fees ?? 0) + total;
    pv.cash -= total;
    if (pv.cash < 0) {
      pv.debt += -pv.cash;
      pv.cash = 0;
    }
  }
}
