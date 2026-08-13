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
 *  their own firm.
 *
 *  The copy is written the way the Wire writes about every other house: a
 *  reporter's sentence with the figure in it, then a line of analysis — not a
 *  congratulation. The point is that the world noticed you, and that only lands
 *  if it sounds like the world rather than like the game. */
export interface FirmBeat {
  kind: "contract" | "production";
  kicker: string;
  head: string;
  body: string;
  /** Pull quote, set beside the copy the way the newsroom beats are. */
  quote: string;
  /** How loudly it runs — a genuinely big record can lead the page on merit. */
  size: "major" | "standard";
}

const FLOOR_ORDER_REV = 5_000; // a contract period must clear this to be news
const FLOOR_PRODUCED = 500; // a production period must clear this to be news
/** Beating the old record by this much is a story rather than a note. */
const MAJOR_MULTIPLE = 1.5;

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
    const major = orderRev >= bestPrevOrder * MAJOR_MULTIPLE;
    return {
      kind: "contract",
      kicker: "Contract win",
      head: `${who} Books Largest Contract Haul in House History`,
      body:
        `${who} closed ${money(orderRev)} in client orders over the period, the ` +
        `biggest single-period haul the house has booked since opening its floor` +
        (bestPrevOrder > 0
          ? `, clearing its own previous best of ${money(bestPrevOrder)}.`
          : `.`) +
        ` The run was filled out of inventory rather than bought in, which leaves ` +
        `the margin with the house.`,
      quote: major
        ? "They are not a small shop any more."
        : "Steady work, and it is starting to show.",
      size: major ? "major" : "standard",
    };
  }

  // Production record: most units off the floor in any period so far.
  const produced = latest.flows.produced;
  const bestPrevProd = Math.max(0, ...prev.map((r) => r.flows.produced));
  if (produced >= FLOOR_PRODUCED && produced > bestPrevProd) {
    const major = produced >= bestPrevProd * MAJOR_MULTIPLE;
    return {
      kind: "production",
      kicker: "Output",
      head: `${who} Posts Record Run as Floor Output Hits New High`,
      body:
        `${who}'s floor turned out ${produced.toLocaleString()} units over the ` +
        `period, the most it has ever shipped in a single run` +
        (bestPrevProd > 0
          ? `, past a previous high of ${bestPrevProd.toLocaleString()}.`
          : `.`) +
        ` The lines ran the stretch without a stoppage, which is the harder half ` +
        `of a number like that.`,
      quote: major
        ? "The floor is finally running the way it was drawn up."
        : "A good stretch, cleanly run.",
      size: major ? "major" : "standard",
    };
  }

  return null;
}
