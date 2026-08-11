import { emptyLedger, wallCycle, type ArchiveEntry, type Ledger, type Report } from "@trove/engine";

export interface Recap {
  awayMs: number;
  cyclesAway: number;
  netWorthNow: number;
  netWorthDelta: number;
  flows: Ledger;
  headline: ArchiveEntry | null;
}

/** Build the "While You Were Away" recap from the player's previous
 *  lastSeenAt watermark + their report history. Returns null when there's
 *  nothing worth surfacing — either the player has never been seen before,
 *  or not even one 6h settlement has happened since they last were (most
 *  routine refreshes/tab-switches land here, which is correct: a 20-minute
 *  break isn't "away"). */
export function buildRecap(
  awaySince: number | null | undefined,
  now: number,
  reports: Report[],
  archive: ArchiveEntry[],
  netWorthNow: number,
): Recap | null {
  if (awaySince == null) return null;
  if (wallCycle(now) - wallCycle(awaySince) < 1) return null;

  const matched = reports.filter((r) => r.at > awaySince);
  if (matched.length === 0) return null;

  const before = [...reports].filter((r) => r.at <= awaySince).pop();
  const baseline = before ? before.netWorth : matched[0]!.netWorth;

  const flows = emptyLedger();
  for (const r of matched) {
    flows.produced += r.flows.produced;
    flows.listingUnits += r.flows.listingUnits;
    flows.listingRev += r.flows.listingRev;
    flows.orderUnits += r.flows.orderUnits;
    flows.orderRev += r.flows.orderRev;
    flows.bought += r.flows.bought;
    flows.spent += r.flows.spent;
    flows.soldUnits += r.flows.soldUnits;
    flows.soldRev += r.flows.soldRev;
    flows.upkeep += r.flows.upkeep;
  }

  const loCycle = wallCycle(awaySince);
  const hiCycle = wallCycle(now);
  let headline: ArchiveEntry | null = null;
  for (const a of archive) {
    if (a.cycle < loCycle || a.cycle > hiCycle) continue;
    if (!headline || a.cycle > headline.cycle) headline = a;
  }

  return {
    awayMs: now - awaySince,
    cyclesAway: matched.length,
    netWorthNow,
    netWorthDelta: netWorthNow - baseline,
    flows,
    headline,
  };
}

/** "14h" / "1d 3h" — coarse, matches the card's tone. */
export function humanizeAway(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}
