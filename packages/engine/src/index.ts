/**
 * @trove/engine — the economic engine.
 *
 * Pure logic, DOM-free, identical client-side (sandbox) and server-side
 * (Lambda settlement). Behavioral source of truth: prototype/vault-terminal.html.
 * Model spec: specs/02_ENGINE.md.
 *
 * Phase 0 ports the stable core: types, constants, `freshState`, and the three
 * pure pricing functions (`itemDemand`, `scarcity`, `priceItem`). The full
 * simulation loop — `advance`, `settleCycle`, `traderAct`, buy/sell, debt — and
 * the invariant test suite land in Phase 1 (see BUILD_PLAN.md).
 */
import { items as catalog, sectorKeys } from "@trove/data";
import type { RuntimeItem, Trader, WorldState } from "./types";

export * from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

/** 1 cycle = 1 game-day = 12 real hours at 1× speed. */
export const SEC_PER_CYCLE = 43200;
/** Starting player cash. */
export const START_CASH = 25000;
/** Interest accrued on debt per cycle. */
export const DEBT_RATE = 0.0005;

// ── RNG helpers ──────────────────────────────────────────────────────────────

/** Exponential draw with the given mean (for Poisson trader scheduling). */
export function rexp(mean: number): number {
  return -Math.log(1 - Math.random()) * mean;
}

// ── World construction ───────────────────────────────────────────────────────

/** The AI traders that keep the floor alive. */
function freshTraders(): Trader[] {
  const k = sectorKeys;
  return [
    { name: "Bedrock_Capital", cash: 160_000, bias: k.includes("construction") ? "construction" : null, next: rexp(1.1) },
    { name: "Wayfront_Logistics", cash: 120_000, bias: k.includes("logistics") ? "logistics" : null, next: rexp(1.0) },
    { name: "Halcyon_Holdings", cash: 200_000, bias: k.includes("luxury") ? "luxury" : null, next: rexp(1.4) },
    { name: "Open_Index", cash: 140_000, bias: null, next: rexp(1.2) },
  ];
}

/** Build a fresh world: every item primed to its baseline, sectors at 1.0. */
export function freshState(): WorldState {
  const items: RuntimeItem[] = catalog.map((d) => ({
    ...d,
    stock: d.edition === null ? d.stockNormal : d.edition,
    remaining: d.edition === null ? Infinity : d.edition,
    owners: {},
    value: d.base,
    prevValue: d.base,
    myCopies: [],
  }));

  const sectorIdx: Record<string, number> = {};
  for (const s of sectorKeys) sectorIdx[s] = 1;

  return {
    cycle: 1,
    cycleFrac: 0,
    cash: START_CASH,
    debt: 0,
    rate: DEBT_RATE,
    items,
    sectorIdx,
    active: [],
    archive: [],
    front: null,
    traders: freshTraders(),
    log: [],
    lastNewsIdx: -1,
    nwHist: [START_CASH],
  };
}

// ── Pricing (pure) ───────────────────────────────────────────────────────────

/** Item's effective demand = weighted blend of its sectors' indices. */
export function itemDemand(state: WorldState, it: RuntimeItem): number {
  let num = 0;
  let den = 0;
  for (const s in it.weights) {
    const w = it.weights[s] ?? 0;
    num += (state.sectorIdx[s] ?? 1) * w;
    den += w;
  }
  return den ? num / den : 1;
}

/** Scarcity pressure: depleted stock firms price; abundance softens it. */
export function scarcity(it: RuntimeItem): number {
  if (it.edition !== null) {
    // Editions firm as the run sells out.
    return 1 + ((it.edition - it.remaining) / it.edition) * 0.6;
  }
  if (it.stockNormal <= 0) return 1;
  const ratio = it.stock / it.stockNormal; // 1 = normal, <1 = depleted
  return Math.max(0.7, Math.min(2.2, 1 + (1 - ratio) * 0.8));
}

/** Target price for an item given current demand + scarcity. */
export function priceItem(state: WorldState, it: RuntimeItem): number {
  const dem = itemDemand(state, it);
  // Slow-restock items are more elastic — they can't replenish fast.
  const elasticity =
    it.edition !== null ? 1.4 : 0.5 + Math.min(1.2, 1200 / (it.restock + 40));
  const target = it.base * (1 + (dem - 1) * elasticity) * scarcity(it);
  return Math.max(it.base * 0.25, target);
}

// ── Derived totals ───────────────────────────────────────────────────────────

export function held(it: RuntimeItem, owner: string): number {
  return it.owners[owner] ?? 0;
}

export function assetsValue(state: WorldState, owner: string): number {
  let v = 0;
  for (const it of state.items) v += held(it, owner) * it.value;
  return v;
}

export function netWorth(state: WorldState, owner: string): number {
  const base =
    owner === "YOU"
      ? state.cash - state.debt
      : state.traders.find((t) => t.name === owner)?.cash ?? 0;
  return base + assetsValue(state, owner);
}
