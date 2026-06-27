import { type WorldState } from "@trove/engine";
import { money } from "@/lib/format";

/** Your firm in the news. Players don't appear on the Wire at random — your
 *  house only breaks into the news when you EARN it: the latest settled period
 *  is a personal record (your biggest contract haul, or the most units you've
 *  ever produced) and clears an absolute floor so it's genuinely notable.
 *
 *  Pure + deterministic from the report history — no randomness, no API, no
 *  localStorage to drift. A quiet period shows nothing (so a fresh holding sees
 *  none), and the card rolls off the Wire on its own once a later period isn't a
 *  record. Each player runs this against their OWN state, so everyone sees only
 *  their own firm. */
export interface FirmBeat {
  kind: "contract" | "production";
  kicker: string;
  head: string;
  body: string;
}

const FLOOR_ORDER_REV = 5_000; // a contract period must clear this to be news
const FLOOR_PRODUCED = 500; // a production period must clear this to be news

export function firmBeat(state: WorldState, name: string | null): FirmBeat | null {
  const who = name?.trim();
  if (!who) return null;
  const reports = state.reports;
  if (!reports || reports.length < 2) return null; // need history to set a record

  const latest = reports[reports.length - 1]!;
  const prev = reports.slice(0, -1);

  // Contract record (priority): biggest order revenue of any period so far.
  const orderRev = latest.flows.orderRev;
  const bestPrevOrder = Math.max(0, ...prev.map((r) => r.flows.orderRev));
  if (orderRev >= FLOOR_ORDER_REV && orderRev > bestPrevOrder) {
    return {
      kind: "contract",
      kicker: "Your firm in the news",
      head: `${who} lands its biggest contract haul yet`,
      body: `${who} cleared ${money(orderRev)} in client orders this period — a new high for the house.`,
    };
  }

  // Production record: most units off the floor in any period so far.
  const produced = latest.flows.produced;
  const bestPrevProd = Math.max(0, ...prev.map((r) => r.flows.produced));
  if (produced >= FLOOR_PRODUCED && produced > bestPrevProd) {
    return {
      kind: "production",
      kicker: "Your firm in the news",
      head: `${who} posts a record production run`,
      body: `${who}'s floor turned out ${produced.toLocaleString()} units this period — the most it has ever shipped in one go.`,
    };
  }

  return null;
}
