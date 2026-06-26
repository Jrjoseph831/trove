import { sectorKeys, sectorLabel } from "@trove/data";
import {
  activeMarketEvent,
  nextMarketEvent,
  type MarketEvent,
} from "@trove/engine";

/** How long before a surge fires that the Breaking story drops on the Wire. */
const LEAD_MS = 5 * 60 * 1000;

export interface BreakingBeat {
  /** Stable key for this beat (the event slot) — so we only flash once. */
  slot: number;
  phase: "incoming" | "live";
  sector: string;
  kicker: string;
  head: string;
  body: string;
}

/** Per-sector cause flavour for a demand surge — names the sector and the
 *  direction, never the number. The player reads it and infers; the magnitude
 *  only shows up in the tape once it fires. */
const SURGE_CAUSE: Record<string, string> = {
  agriculture:
    "Gulf-port grain shipments are snarled and processors are scrambling to lock down supply",
  energy:
    "A cold snap and grid strain have utilities and buyers racing for fuel and parts",
  technology:
    "Chip-supply rumours have technology buyers front-running a shortage",
  construction:
    "A wave of permits just cleared and builders are stocking up fast",
  manufacturing:
    "Plants are restocking hard ahead of a rumoured input crunch",
  medical:
    "Hospital systems are placing emergency orders across the board",
  logistics:
    "Freight bottlenecks have shippers buying capacity at almost any price",
  automotive:
    "A parts squeeze has assembly lines bidding up components",
  luxury:
    "Collectors are circling and dealers can't keep marquee pieces on the floor",
  textiles:
    "Mills are oversold and converters are chasing every bolt they can find",
};

function cause(sector: string): string {
  return (
    SURGE_CAUSE[sector] ??
    `Buyers are moving fast on ${sectorLabel(sector)} and supply is tightening`
  );
}

function toBeat(ev: MarketEvent, phase: "incoming" | "live"): BreakingBeat {
  const L = sectorLabel(ev.sector);
  return {
    slot: ev.slot,
    phase,
    sector: ev.sector,
    kicker: phase === "incoming" ? "Breaking" : "Developing",
    head:
      phase === "incoming"
        ? `${L} braces for a demand surge`
        : `${L} demand is surging now`,
    body:
      phase === "incoming"
        ? `${cause(ev.sector)}. The floor is bracing for a move — watch the ${L} tape.`
        : `${cause(ev.sector)}. Orders are pouring in across ${L}. The tape will show how far it runs.`,
  };
}

/** The market-event Breaking beat to surface right now, or null. Derived purely
 *  from the deterministic schedule — no number is ever quoted. */
export function breakingBeat(now: number = Date.now()): BreakingBeat | null {
  const live = activeMarketEvent(now, sectorKeys);
  if (live) return toBeat(live, "live");
  const next = nextMarketEvent(now, sectorKeys);
  if (now >= next.fireAt - LEAD_MS) return toBeat(next, "incoming");
  return null;
}
