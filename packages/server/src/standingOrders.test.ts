import { describe, expect, it } from "vitest";
import { canProduce, items as catalog, recipeOf } from "@trove/data";
import { createWorld, previewFactoryNeeds, type Factory, type WorldState } from "@trove/engine";
import { docToWorld, playerView, worldToDoc, type Player, type WorldDoc } from "./repo";
import { planStandingSettlements } from "./standingOrders";

/** A real producible item with at least one recipe input, chosen once and
 *  reused — avoids hand-rolling a synthetic recipe/catalog shape. */
const TARGET = catalog.find(
  (i) => canProduce(i as never) && (recipeOf(i as never)?.inputs.length ?? 0) > 0,
)!;
const INPUT_ID = recipeOf(TARGET)!.inputs[0]!.itemId;

/** A fresh world doc (cycle 1, every item at baseline stock/value), with each
 *  given seller's `producedQty` mirrored into item ownership — matching the
 *  real invariant produceFactories() maintains (a player's produced stock is
 *  ALWAYS reflected in both places together; only a test fixture could drift
 *  the two, which is exactly the drift-guard the planner checks for). */
function makeDoc(sellers: Player[] = []): WorldDoc {
  const doc = worldToDoc(createWorld(0), 1);
  for (const seller of sellers) {
    for (const [idStr, qty] of Object.entries(seller.producedQty ?? {})) {
      const it = doc.items.find((x) => x.id === Number(idStr));
      if (it && qty) it.owners[seller.playerId] = qty;
    }
  }
  return doc;
}

function makeBuyer(overrides: Partial<Player> = {}): Player {
  const line: Factory = {
    id: "line1",
    itemId: TARGET.id,
    builtCycle: 0,
    onlineCycle: 0, // online at any cycle >= 0
    modules: [],
    status: "idle",
    standingSources: { [INPUT_ID]: { sellerId: "seller1", sellerHandle: "bobs-holdings" } },
  };
  return {
    playerId: "buyer1",
    cash: 1_000_000,
    debt: 0,
    factories: [line],
    ...overrides,
  };
}

function makeSeller(overrides: Partial<Player> = {}): Player {
  return {
    playerId: "seller1",
    cash: 0,
    debt: 0,
    producedQty: { [INPUT_ID]: 10_000 },
    listed: {},
    listPrices: {},
    site: { handle: "bobs-holdings", published: true, autoSupply: true },
    ...overrides,
  };
}

/** Build a player-view exactly as production.ts does, with `.cycle` pinned so
 *  the standing-sourced line is online for the test (see production.ts for
 *  why this matters: onlineCycle is stamped on the FAST production-tick
 *  basis, not the slow 6h world cycle playerView defaults `.cycle` to). */
function viewOf(doc: WorldDoc, player: Player): WorldState {
  const pv = playerView(doc, player);
  pv.cycle = 1;
  return pv;
}

/** The buyer's per-cycle need for INPUT_ID, independent of any seller's
 *  stock (previewFactoryNeeds only reads the buyer's own factories/vault). */
function wantedQtyFor(buyer: Player): number {
  const pv = viewOf(makeDoc(), buyer);
  const n = previewFactoryNeeds(pv).find((x) => x.itemId === INPUT_ID);
  expect(n).toBeDefined();
  return n!.needPerCycle;
}

describe("planStandingSettlements — happy path", () => {
  it("fills the buyer's shortfall from the seller's live listing, moving real cash and goods", () => {
    const buyer = makeBuyer();
    const seller = makeSeller();
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pv = viewOf(doc, buyer);
    const wantedQty = wantedQtyFor(buyer);
    expect(wantedQty).toBeGreaterThan(0);

    const pvById = new Map([[buyer.playerId, pv]]);
    const r = planStandingSettlements(doc, full, [buyer], pvById, [seller], 10);

    expect(r.fills).toHaveLength(1);
    const f = r.fills[0]!;
    expect(f.buyerId).toBe("buyer1");
    expect(f.sellerId).toBe("seller1");
    expect(f.qty).toBe(wantedQty);
    expect(f.cost).toBeCloseTo(f.qty * f.unitPrice, 6);

    // Buyer's own player-view was mutated directly (production.ts's existing
    // fold-back picks this up automatically — nothing more to do).
    expect(pv.cash).toBeCloseTo(1_000_000 - f.cost, 6);
    expect(pv.items.find((i) => i.id === INPUT_ID)!.owners.YOU).toBe(f.qty);

    // Seller wasn't a producer this tick -> a standalone patch, not a pv mutation.
    expect(r.sellerPatches.get("seller1")).toEqual({
      cashDelta: f.cost,
      producedDelta: { [INPUT_ID]: -f.qty },
    });
    // And the shared doc's ownership was depleted directly (their only
    // representation this tick, since they have no per-player fold-back pass).
    const docItem = full.items.find((i) => i.id === INPUT_ID)!;
    expect(docItem.owners["seller1"]).toBe(10_000 - f.qty);
  });
});

describe("planStandingSettlements — seller constraints", () => {
  it("partially fills when the seller doesn't have enough stock", () => {
    const buyer = makeBuyer();
    const wantedQty = wantedQtyFor(buyer);
    expect(wantedQty).toBeGreaterThan(1);
    const seller = makeSeller({ producedQty: { [INPUT_ID]: Math.floor(wantedQty / 2) } });
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);

    const pv = viewOf(doc, buyer);
    const pvById = new Map([[buyer.playerId, pv]]);
    const r = planStandingSettlements(doc, full, [buyer], pvById, [seller], 10);

    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]!.qty).toBe(Math.floor(wantedQty / 2));
    expect(r.fills[0]!.qty).toBeLessThan(wantedQty);
  });

  it("does not fill at all when the seller hasn't opted in (autoSupply false)", () => {
    const buyer = makeBuyer();
    const seller = makeSeller({ site: { handle: "bobs-holdings", published: true, autoSupply: false } });
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pv = viewOf(doc, buyer);
    const pvById = new Map([[buyer.playerId, pv]]);

    const r = planStandingSettlements(doc, full, [buyer], pvById, [seller], 10);

    expect(r.fills).toHaveLength(0);
    expect(pv.cash).toBe(1_000_000); // untouched
  });

  it("does not fill when the seller isn't published", () => {
    const buyer = makeBuyer();
    const seller = makeSeller({ site: { handle: "bobs-holdings", published: false, autoSupply: true } });
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pv = viewOf(doc, buyer);
    const pvById = new Map([[buyer.playerId, pv]]);

    const r = planStandingSettlements(doc, full, [buyer], pvById, [seller], 10);
    expect(r.fills).toHaveLength(0);
  });

  it("skips gracefully (no throw) when the referenced seller couldn't be loaded", () => {
    const buyer = makeBuyer();
    const doc = makeDoc();
    const full = docToWorld(doc);
    const pv = viewOf(doc, buyer);
    const pvById = new Map([[buyer.playerId, pv]]);

    const r = planStandingSettlements(doc, full, [buyer], pvById, [], 10); // sellers: []
    expect(r.fills).toHaveLength(0);
  });
});

describe("planStandingSettlements — no overselling across buyers", () => {
  it("two buyers drawing from the same seller in one tick never exceed the seller's stock", () => {
    const buyerA = makeBuyer({ playerId: "buyerA" });
    const buyerB = makeBuyer({ playerId: "buyerB" });
    const wantedQty = wantedQtyFor(buyerA); // same recipe/rate as buyerB (identical factory config)
    // Seller can only cover ~1.5x ONE buyer's want, not two.
    const sellerStock = Math.floor(wantedQty * 1.5);
    const seller = makeSeller({ producedQty: { [INPUT_ID]: sellerStock } });
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pvA = viewOf(doc, buyerA);
    const pvB = viewOf(doc, buyerB);

    const pvById = new Map([
      [buyerA.playerId, pvA],
      [buyerB.playerId, pvB],
    ]);
    const r = planStandingSettlements(doc, full, [buyerA, buyerB], pvById, [seller], 10);

    const totalFilled = r.fills.reduce((s, f) => s + f.qty, 0);
    expect(totalFilled).toBeLessThanOrEqual(sellerStock);
    expect(totalFilled).toBeGreaterThan(0); // at least the first buyer got something
  });
});

describe("planStandingSettlements — seller identity handling", () => {
  it("merges into the seller's OWN player-view when they're also a producer this tick", () => {
    const buyer = makeBuyer();
    const seller = makeSeller();
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pvBuyer = viewOf(doc, buyer);
    const pvSeller = viewOf(doc, seller); // seller has no factories, but IS a producer this tick

    const pvById = new Map([
      [buyer.playerId, pvBuyer],
      [seller.playerId, pvSeller],
    ]);
    const r = planStandingSettlements(doc, full, [buyer, seller], pvById, [seller], 10);

    expect(r.fills).toHaveLength(1);
    const f = r.fills[0]!;
    // No standalone patch — it went straight onto the seller's own pv.
    expect(r.sellerPatches.has("seller1")).toBe(false);
    expect(pvSeller.cash).toBeCloseTo(f.cost, 6);
    expect(pvSeller.producedQty[INPUT_ID]).toBe(10_000 - f.qty);
    expect(pvSeller.items.find((i) => i.id === INPUT_ID)!.owners.YOU ?? 0).toBe(10_000 - f.qty);
  });
});

describe("planStandingSettlements — transaction-item backpressure", () => {
  it("skips a brand-new (non-producer) seller once the tx budget is exhausted", () => {
    const buyer = makeBuyer();
    const seller = makeSeller();
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pv = viewOf(doc, buyer);
    const pvById = new Map([[buyer.playerId, pv]]);

    const r = planStandingSettlements(doc, full, [buyer], pvById, [seller], 0); // no budget
    expect(r.fills).toHaveLength(0);
    expect(pv.cash).toBe(1_000_000); // untouched — the shortfall just stays unmet this tick
  });

  it("does NOT need budget for a seller who's already a producer this tick", () => {
    const buyer = makeBuyer();
    const seller = makeSeller();
    const doc = makeDoc([seller]);
    const full = docToWorld(doc);
    const pvBuyer = viewOf(doc, buyer);
    const pvSeller = viewOf(doc, seller);
    const pvById = new Map([
      [buyer.playerId, pvBuyer],
      [seller.playerId, pvSeller],
    ]);

    // Zero budget for NEW sellers, but this seller is already a producer.
    const r = planStandingSettlements(doc, full, [buyer, seller], pvById, [seller], 0);
    expect(r.fills).toHaveLength(1);
  });
});
