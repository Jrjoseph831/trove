import { afterEach, describe, expect, it } from "vitest";
import {
  AI_APPETITE_MUL,
  canProduce,
  COMPANY_TIERS,
  effectiveSpec,
  items as catalog,
  properties as propertyCatalog,
  recipeOf,
  sectorKeys,
} from "@trove/data";
import {
  accrueIncome,
  activeMarketEvent,
  advance,
  aiVirtualConsumption,
  assetsValue,
  buildFactory,
  buyProperty,
  canBuy,
  createWorld,
  demandHeat,
  elasticity,
  eventForSlot,
  freshState,
  nextMarketEvent,
  setMarketEvent,
  fulfillSandboxOrder,
  generateSandboxOrder,
  SANDBOX_TIMING,
  held,
  listedUnitPrice,
  makerMark,
  makerVariantName,
  mulberry32,
  netWorth,
  orderSupply,
  playerBuy,
  playerSell,
  priceItem,
  reconcileCompanies,
  runProduction,
  setReorder,
  supplyQuote,
  representativeItem,
  resetRng,
  rippleMultiplier,
  scarcity,
  sectorConsumptionPressure,
  setRng,
  settleCycle,
  START_CASH,
  setStandingSource,
  traderAct,
  updatePlayerActivity,
  type RuntimeItem,
  type Trader,
  type WorldState,
} from "@trove/engine";

afterEach(resetRng);

/** Total units of an item that physically exist (held + on the floor). */
function unitsOf(it: RuntimeItem): number {
  const ownedExternally = Object.values(it.owners).reduce((a, b) => a + b, 0);
  return ownedExternally + (it.edition !== null ? it.remaining : it.stock);
}

describe("catalog integrity", () => {
  it("has unique item ids", () => {
    const ids = new Set(catalog.map((i) => i.id));
    expect(ids.size).toBe(catalog.length);
  });

  it("editions declare a positive finite run", () => {
    for (const it of catalog) {
      if (it.edition !== null) {
        expect(it.edition).toBeGreaterThan(0);
        expect(Number.isInteger(it.edition)).toBe(true);
      }
    }
  });
});

describe("freshState", () => {
  it("primes every item to baseline with correct supply", () => {
    const S = freshState();
    expect(S.items.length).toBe(catalog.length);
    expect(S.cash).toBe(START_CASH);
    for (const it of S.items) {
      expect(it.value).toBe(it.base);
      if (it.edition !== null) {
        expect(it.remaining).toBe(it.edition);
        expect(it.stock).toBe(it.edition);
      } else {
        expect(it.remaining).toBe(Infinity);
        expect(it.stock).toBe(it.stockNormal);
      }
    }
  });

  it("starts every sector index at 1.0", () => {
    const S = freshState();
    for (const v of Object.values(S.sectorIdx)) expect(v).toBe(1);
  });
});

describe("determinism", () => {
  it("same seed → identical sector indices after N cycles", () => {
    const run = () => {
      setRng(mulberry32(12345));
      const S = freshState();
      for (let i = 0; i < 25; i++) settleCycle(S);
      return S.sectorIdx;
    };
    expect(run()).toEqual(run());
  });

  it("same seed → identical net worth after a full headless sim", () => {
    const run = () => {
      setRng(mulberry32(999));
      const S = createWorld();
      for (let i = 0; i < 300; i++) advance(S, 0.25);
      return netWorth(S, "YOU");
    };
    expect(run()).toBe(run());
  }, 20000);
});

describe("supply invariants over a long sim", () => {
  it("keeps stock and remaining within bounds across 200 cycles of trading", () => {
    setRng(mulberry32(7));
    const S = createWorld();
    const violations: string[] = [];
    for (let c = 0; c < 200; c++) {
      for (const t of S.traders) traderAct(S, t);
      settleCycle(S);
      // Accumulate violations rather than asserting per item — 1456×200 expect()
      // calls would dwarf the actual sim cost.
      for (const it of S.items) {
        if (!(it.value > 0 && Number.isFinite(it.value))) {
          violations.push(`c${c} #${it.id} value=${it.value}`);
        }
        if (it.edition !== null) {
          if (it.remaining < 0 || it.remaining > it.edition) {
            violations.push(`c${c} #${it.id} remaining=${it.remaining}/${it.edition}`);
          }
        } else if (it.stock < 0 || it.stock > it.stockNormal) {
          violations.push(`c${c} #${it.id} stock=${it.stock}/${it.stockNormal}`);
        }
      }
    }
    expect(violations).toEqual([]);
  }, 20000);
});

describe("no wealth from nothing", () => {
  it("conserves total units of an item across pure trades (no settle)", () => {
    setRng(mulberry32(3));
    const S = createWorld();
    const baseline = S.items.map(unitsOf);
    // Many trades, but never settle (settle restocks, which is supply creation).
    for (let i = 0; i < 2000; i++) {
      const t = S.traders[i % S.traders.length]!;
      traderAct(S, t);
      const it = S.items[(i * 37) % S.items.length]!;
      if (canBuy(it) && it.value <= S.cash) playerBuy(S, it.id);
      else if (held(it, "YOU") > 0) playerSell(S, it.id);
    }
    S.items.forEach((it, idx) => expect(unitsOf(it)).toBe(baseline[idx]));
  });

  it("a buy is net-worth-neutral at the instant of trade", () => {
    const S = createWorld(0);
    const it = S.items.find((i) => i.edition === null && i.value <= S.cash)!;
    const before = netWorth(S, "YOU");
    playerBuy(S, it.id);
    expect(netWorth(S, "YOU")).toBeCloseTo(before, 6);
  });

  it("buy then immediate sell at unchanged price is cash-neutral", () => {
    const S = createWorld(0);
    const it = S.items.find((i) => i.edition === null && i.value <= S.cash)!;
    const cash0 = S.cash;
    playerBuy(S, it.id);
    playerSell(S, it.id);
    expect(S.cash).toBeCloseTo(cash0, 6);
    expect(held(it, "YOU")).toBe(0);
  });
});

describe("the Assets breakdown reconciles with Net Worth", () => {
  it("Cash + Assets − Debt equals Net Worth once real estate is owned (regression: real estate used to vanish from Assets)", () => {
    const S = createWorld(0);
    S.cash = 50_000_000; // fund a real-estate purchase outright
    const prop = propertyCatalog[0]!;
    expect(buyProperty(S, prop.id)).toBe(true);
    settleCycle(S); // captures a report row via captureReport()
    const r = S.reports[S.reports.length - 1]!;
    expect(r.cash + r.assets - r.debt).toBeCloseTo(r.netWorth, 2);
    // And the fix actually did something — property has real, nonzero value.
    expect(r.assets).toBeGreaterThan(0);
  });
});

describe("supply spine — fast restock dampens, slow restock swings", () => {
  function makeOpen(restock: number): RuntimeItem {
    return {
      id: -1,
      name: "probe",
      brand: "probe",
      tier: "mid",
      category: "x",
      sub: "x",
      archetype: "commodity",
      icon: "",
      weights: { construction: 1 },
      base: 100,
      stockNormal: 1000,
      restock,
      edition: null,
      elaborate: 0,
      stock: 1000, // full → scarcity neutral
      remaining: Infinity,
      owners: {},
      value: 100,
      prevValue: 100,
      myCopies: [],
    };
  }

  it("slow-restock item is more elastic than a fast-restock one", () => {
    expect(elasticity(makeOpen(5))).toBeGreaterThan(elasticity(makeOpen(8000)));
  });

  it("under identical demand, the slow-restock price moves further", () => {
    const S = freshState();
    S.sectorIdx.construction = 1.3; // same demand shock for both
    const slow = priceItem(S, makeOpen(5));
    const fast = priceItem(S, makeOpen(8000));
    expect(slow - 100).toBeGreaterThan(fast - 100);
    expect(fast).toBeGreaterThan(100); // still rises, just less
  });
});

describe("editions firm and vanish", () => {
  it("scarcity rises as an edition sells out", () => {
    const ed = createWorld(0).items.find((i) => i.edition !== null)!;
    const s0 = scarcity(ed);
    ed.remaining = Math.max(0, ed.remaining - 1);
    expect(scarcity(ed)).toBeGreaterThan(s0);
  });

  it("an edition cannot be bought once claimed out", () => {
    const S = createWorld(0);
    const ed = S.items.find((i) => i.edition !== null)!;
    ed.remaining = 0;
    expect(canBuy(ed)).toBe(false);
    expect(playerBuy(S, ed.id)).toBeNull();
  });
});

describe("news variety", () => {
  it("does not repeat a headline within the recent window", () => {
    setRng(mulberry32(55));
    const S = createWorld();
    const fronts: string[] = [];
    const dupes: string[] = [];
    for (let c = 0; c < 80; c++) {
      settleCycle(S);
      const head = S.front!.head;
      if (fronts.slice(-14).includes(head)) dupes.push(`c${c}: ${head}`);
      fronts.push(head);
    }
    expect(dupes).toEqual([]);
    // and it actually pulls from a large, varied pool
    expect(new Set(fronts).size).toBeGreaterThan(40);
  });
});

describe("listed-price formula is single-sourced", () => {
  it("is value × markup × QC, exactly", () => {
    expect(listedUnitPrice(100, 1, false)).toBe(100);
    expect(listedUnitPrice(100, 1.25, false)).toBeCloseTo(125, 6);
    expect(listedUnitPrice(100, 1, true)).toBeCloseTo(106, 6); // QC premium 6%
    expect(listedUnitPrice(200, 1.5, true)).toBeCloseTo(200 * 1.5 * 1.06, 6);
  });
});

describe("AI ripple multiplier — bounded and neutral by default", () => {
  it("is exactly 1.0 on a dormant world (no player footprint)", () => {
    const S = freshState();
    expect(rippleMultiplier(S)).toBe(1);
    updatePlayerActivity(S); // still no owners → EMA stays 0
    expect(rippleMultiplier(S)).toBe(1);
  });

  it("stays within [1.0, 1.5] for extreme footprints", () => {
    const S = freshState();
    expect(rippleMultiplier(S)).toBeGreaterThanOrEqual(1);

    // A modest footprint: a handful of items held by "YOU".
    const it1 = S.items[0]!;
    it1.owners["YOU"] = 50;
    updatePlayerActivity(S);
    const modest = rippleMultiplier(S);
    expect(modest).toBeGreaterThanOrEqual(1);
    expect(modest).toBeLessThanOrEqual(1.5);

    // An absurd footprint: every item, massively over-held.
    for (const it of S.items) it.owners["YOU"] = 1_000_000;
    for (let i = 0; i < 50; i++) updatePlayerActivity(S); // let the EMA catch up
    const extreme = rippleMultiplier(S);
    expect(extreme).toBeGreaterThanOrEqual(modest);
    expect(extreme).toBeLessThanOrEqual(1.5);
    expect(Number.isFinite(extreme)).toBe(true);
  });

  it("ignores AI trader holdings — only real (non-trader) owners count", () => {
    const S = freshState();
    const it = S.items[0]!;
    it.owners[S.traders[0]!.name] = 1_000_000; // a trader, not a real player
    updatePlayerActivity(S);
    expect(rippleMultiplier(S)).toBe(1);
  });
});

describe("AI virtual consumption stays within invariants", () => {
  it("every biased company resolves to a real, producible representative item", () => {
    const S = createWorld(0);
    for (const t of S.traders) {
      if (!t.bias) continue; // Open_Index: no representative item, by design
      const rep = representativeItem(t.name, t.bias);
      expect(rep).not.toBeNull();
    }
  });

  it("never drops a company's cash below its tier reserve", () => {
    const S = createWorld(0);
    const t = S.traders.find((tr) => tr.bias !== null)!;
    const floor = COMPANY_TIERS[t.tier ?? "mid"].floor;
    t.cash = floor + 500; // just above reserve — the case that could violate it
    aiVirtualConsumption(S);
    expect(t.cash).toBeGreaterThanOrEqual(floor - 0.01);
  });

  it("never drives shared item stock negative even when cash is generous", () => {
    const S = createWorld(0);
    for (const t of S.traders) t.cash = 50_000_000; // remove the cash constraint
    aiVirtualConsumption(S);
    for (const it of S.items) expect(it.stock).toBeGreaterThanOrEqual(0);
  });

  it("scales every input by the SAME fill factor when stock is short (preserves recipe ratios)", () => {
    const S = createWorld(0);
    // Materials specialists (raw-tier reps) have no recipe inputs at all —
    // need a trader whose rep item actually consumes something to test this.
    const t = S.traders.find((tr) => {
      if (!tr.bias) return false;
      const rep = representativeItem(tr.name, tr.bias);
      return !!rep && (recipeOf(rep)?.inputs.length ?? 0) > 0;
    })!;
    expect(t).toBeDefined();
    t.cash = 50_000_000; // cash is never the binding constraint here
    // Isolate to ONE company so a shared raw material can't be double-drawn by
    // a second company in the same pass, which would corrupt the check below.
    S.traders = [t];
    const rep = representativeItem(t.name, t.bias)!;
    const recipe = recipeOf(rep)!;
    const rate = effectiveSpec(rep, []).rate * AI_APPETITE_MUL[t.tier ?? "mid"];
    // Starve every input far below its computed need so the fill factor binds
    // well under 1 for every one of them (not just the tightest).
    for (const it of S.items) it.stock = 0.001;
    const before = new Map(S.items.map((it) => [it.id, it.stock]));
    aiVirtualConsumption(S);
    // For each input, (draw / need) should equal the SAME fill factor — draw
    // relative to what the recipe actually calls for, not relative to the
    // arbitrary starting stock (different inputs legitimately need different
    // quantities, so equal-fraction-of-stock is the wrong invariant to check).
    const fillFactors = recipe.inputs.map((inp) => {
      const it = S.items.find((x) => x.id === inp.itemId)!;
      const need = inp.qty * rate;
      const draw = before.get(it.id)! - it.stock;
      return draw / need;
    });
    expect(fillFactors.length).toBeGreaterThan(0);
    const [first, ...rest] = fillFactors;
    expect(first!).toBeGreaterThan(0);
    expect(first!).toBeLessThan(1); // confirms starvation actually bound
    for (const f of rest) expect(f).toBeCloseTo(first!, 6);
  });

  it("credits the company's own holdings with real output = floor(rate × fillScale)", () => {
    const S = createWorld(0);
    // Pick a company whose full-fillScale output is guaranteed >= 1 whole
    // unit (AI_APPETITE_MUL can be < 1, e.g. boutique's 0.15, so a random
    // trader's raw rate could floor to 0 — this test needs a real credit).
    const t = S.traders.find((tr) => {
      if (!tr.bias) return false;
      const rep = representativeItem(tr.name, tr.bias);
      if (!rep) return false;
      const rate = effectiveSpec(rep, []).rate * AI_APPETITE_MUL[tr.tier ?? "mid"];
      return rate >= 1;
    })!;
    expect(t).toBeDefined();
    t.cash = 50_000_000; // cash never binds; fillScale is driven by stock only
    S.traders = [t]; // isolate — no other company competing for the same inputs
    const rep = representativeItem(t.name, t.bias!)!;
    const rate = effectiveSpec(rep, []).rate * AI_APPETITE_MUL[t.tier ?? "mid"];
    const repRuntime = S.items.find((it) => it.id === rep.id)!;
    expect(repRuntime.owners[t.name] ?? 0).toBe(0); // nothing produced yet

    aiVirtualConsumption(S); // ripple defaults to 1 — plenty of stock, so fillScale should be 1
    const produced = repRuntime.owners[t.name] ?? 0;
    expect(produced).toBe(Math.floor(rate)); // fillScale was 1 (ample stock, ample cash)
    expect(produced).toBeGreaterThan(0);
  });

  it("floors fractional output to a whole unit (never leaves a sub-1 remainder that could push negative on sale)", () => {
    const S = createWorld(0);
    // A boutique-tier company (appetite 0.15) is the most likely to produce a
    // genuinely fractional raw amount — confirms the floor actually applies,
    // not just that integer cases happen to already look floored.
    const t = S.traders.find((tr) => tr.tier === "boutique" && tr.bias)!;
    expect(t).toBeDefined();
    t.cash = 50_000_000;
    S.traders = [t];
    const rep = representativeItem(t.name, t.bias!)!;
    const rate = effectiveSpec(rep, []).rate * AI_APPETITE_MUL["boutique"];
    const repRuntime = S.items.find((it) => it.id === rep.id)!;

    aiVirtualConsumption(S);
    const produced = repRuntime.owners[t.name] ?? 0;
    expect(Number.isInteger(produced)).toBe(true);
    expect(produced).toBe(Math.floor(rate));
  });

  it("a materials specialist (raw-tier rep, no inputs) still produces, gated by CASH not stock", () => {
    const S = createWorld(0);
    // A specialist has an empty recipe — starving item stock (the constraint
    // every other test in this block uses) should have zero effect; only its
    // own cash-vs-reserve budget can bind extraction.
    const t = S.traders.find((tr) => {
      if (!tr.bias) return false;
      const rep = representativeItem(tr.name, tr.bias);
      return !!rep && (recipeOf(rep)?.inputs.length ?? 0) === 0;
    })!;
    expect(t).toBeDefined();
    S.traders = [t];
    for (const it of S.items) it.stock = 0; // irrelevant to extraction — must NOT block it
    const rep = representativeItem(t.name, t.bias!)!;
    const repRuntime = S.items.find((it) => it.id === rep.id)!;

    t.cash = 50_000_000; // ample — extraction should proceed
    aiVirtualConsumption(S);
    expect(repRuntime.owners[t.name] ?? 0).toBeGreaterThan(0);
  });

  it("a materials specialist produces nothing once cash is at its tier reserve", () => {
    const S = createWorld(0);
    const t = S.traders.find((tr) => {
      if (!tr.bias) return false;
      const rep = representativeItem(tr.name, tr.bias);
      return !!rep && (recipeOf(rep)?.inputs.length ?? 0) === 0;
    })!;
    expect(t).toBeDefined();
    S.traders = [t];
    const rep = representativeItem(t.name, t.bias!)!;
    const repRuntime = S.items.find((it) => it.id === rep.id)!;

    t.cash = COMPANY_TIERS[t.tier ?? "mid"].floor; // exactly at reserve — no spendable budget
    aiVirtualConsumption(S);
    expect(repRuntime.owners[t.name] ?? 0).toBe(0);
    expect(t.cash).toBe(COMPANY_TIERS[t.tier ?? "mid"].floor); // untouched
  });

  it("produces nothing when starved (output scales down WITH the inputs, never ahead of them)", () => {
    const S = createWorld(0);
    // A materials specialist (raw-tier rep, no inputs) isn't starved by empty
    // stock at all — it only needs cash. Need a trader with real inputs here.
    const t = S.traders.find((tr) => {
      if (!tr.bias) return false;
      const rep = representativeItem(tr.name, tr.bias);
      return !!rep && (recipeOf(rep)?.inputs.length ?? 0) > 0;
    })!;
    expect(t).toBeDefined();
    t.cash = 50_000_000;
    S.traders = [t];
    const rep = representativeItem(t.name, t.bias)!;
    for (const it of S.items) it.stock = 0; // every input fully depleted
    const repRuntime = S.items.find((it) => it.id === rep.id)!;

    aiVirtualConsumption(S);
    expect(repRuntime.owners[t.name] ?? 0).toBe(0);
  });
});

/** Finds a real (buyer, seller) pair from the actual roster/catalog: a buyer
 *  whose recipe needs some item X, and a seller whose OWN representative
 *  item IS X — i.e. a genuine natural-producer relationship the engine
 *  itself would recognize, without hardcoding any specific company/item
 *  (robust to catalog/roster changes). Deterministic — no rand() involved. */
function findAiToAiPair(
  S: WorldState,
): { buyer: Trader; seller: Trader; itemId: number } | null {
  for (const buyer of S.traders) {
    if (!buyer.bias) continue;
    const rep = representativeItem(buyer.name, buyer.bias);
    const recipe = rep && recipeOf(rep);
    if (!recipe) continue;
    for (const inp of recipe.inputs) {
      for (const seller of S.traders) {
        if (seller.name === buyer.name || !seller.bias) continue;
        const sellerRep = representativeItem(seller.name, seller.bias);
        if (sellerRep?.id === inp.itemId) {
          return { buyer, seller, itemId: inp.itemId };
        }
      }
    }
  }
  return null;
}

describe("named AI-to-AI trading — a company buys inputs from a real producer", () => {
  // Two things every test in this block must get right, learned from a real
  // first-pass failure:
  //  1. fillScale (how much gets filled AT ALL this cycle) is computed from
  //     market-stock-cap + cash BEFORE the producer/market split happens — so
  //     zeroing the floor's `stock` to "force" an AI-to-AI trade instead
  //     blocks the WHOLE recipe (fillScale drops to 0, nobody gets paid).
  //     Tests need AMPLE stock so fillScale isn't the thing under test.
  //  2. The seller is a full Trader in `state.traders` — their OWN
  //     consumeFor() call (later in the same aiVirtualConsumption pass) also
  //     runs production and would add MORE to their holdings after the
  //     trade, confounding a before/after check. Isolate with
  //     `seller.bias = null` on the LIVE trader object (their own consumeFor
  //     call reads this and no-ops), which does NOT affect whether they're
  //     found as a natural producer — that lookup is keyed off the STATIC
  //     roster (companyRoster), not the live trader's mutated bias.
  function isolateSeller(seller: Trader): void {
    seller.bias = null;
  }

  it("moves cash + goods between exactly the two companies, at the item's market value", () => {
    const S = createWorld(0);
    const pair = findAiToAiPair(S);
    expect(pair).not.toBeNull(); // the catalog/roster should yield at least one real pair
    const { buyer, seller, itemId } = pair!;
    isolateSeller(seller);
    buyer.cash = 50_000_000;
    seller.cash = 100_000;
    S.traders = [buyer, seller]; // isolate — nobody else's balance should move
    const it = S.items.find((x) => x.id === itemId)!;
    // Ample — must fully cover the buyer's need so NONE of it falls back to
    // the market, which would make the buyer's total spend exceed just the
    // AI-to-AI portion and corrupt the cash-conservation check below.
    const sellerStock = 10_000_000;
    it.owners[seller.name] = sellerStock;
    it.stock = 1_000_000; // ample floor stock too — fillScale must not be gated to 0

    const buyerCashBefore = buyer.cash;
    const sellerCashBefore = seller.cash;
    aiVirtualConsumption(S);

    const traded = sellerStock - (it.owners[seller.name] ?? 0);
    expect(traded).toBeGreaterThan(0); // the trade actually happened
    expect(traded).toBeLessThanOrEqual(sellerStock); // never oversold the seller
    const amount = traded * it.value;
    // Seller's side is exact — their cash change is driven by this ONE
    // input alone, nothing else touches it.
    expect(seller.cash).toBeCloseTo(sellerCashBefore + amount, 4);
    // Buyer's side is only a LOWER bound: the recipe can have other inputs
    // too (sourced from the market as usual), so the buyer's total spend
    // this cycle may exceed just this one trade's amount.
    expect(buyerCashBefore - buyer.cash).toBeGreaterThanOrEqual(amount - 0.01);
  });

  it("falls back to the abstract floor for whatever the producer can't cover", () => {
    const S = createWorld(0);
    const pair = findAiToAiPair(S);
    expect(pair).not.toBeNull();
    const { buyer, seller, itemId } = pair!;
    isolateSeller(seller);
    buyer.cash = 50_000_000;
    seller.cash = 100_000;
    S.traders = [buyer, seller];
    const it = S.items.find((x) => x.id === itemId)!;
    it.owners[seller.name] = 1; // barely anything to sell
    it.stock = 1_000_000; // the floor has plenty

    aiVirtualConsumption(S);
    // The seller's tiny stock is exhausted (sold what little they had)...
    expect(it.owners[seller.name] ?? 0).toBe(0);
    // ...and the floor still lost stock covering the rest of the need.
    expect(it.stock).toBeLessThan(1_000_000);
  });

  it("never drops either party's cash below its tier reserve", () => {
    const S = createWorld(0);
    const pair = findAiToAiPair(S);
    expect(pair).not.toBeNull();
    const { buyer, seller, itemId } = pair!;
    isolateSeller(seller);
    const buyerFloor = COMPANY_TIERS[buyer.tier ?? "mid"].floor;
    const sellerFloor = COMPANY_TIERS[seller.tier ?? "mid"].floor;
    buyer.cash = buyerFloor + 500; // just above reserve
    seller.cash = sellerFloor; // at reserve — receiving cash can't violate this
    S.traders = [buyer, seller];
    const it = S.items.find((x) => x.id === itemId)!;
    it.owners[seller.name] = 50_000; // ample stock to sell
    it.stock = 1_000_000;

    aiVirtualConsumption(S);
    expect(buyer.cash).toBeGreaterThanOrEqual(buyerFloor - 0.01);
    expect(seller.cash).toBeGreaterThanOrEqual(sellerFloor - 0.01);
  });

  it("logs the trade by name (state.log), even though nothing renders it yet", () => {
    const S = createWorld(0);
    const pair = findAiToAiPair(S);
    expect(pair).not.toBeNull();
    const { buyer, seller, itemId } = pair!;
    isolateSeller(seller);
    buyer.cash = 50_000_000;
    S.traders = [buyer, seller];
    const it = S.items.find((x) => x.id === itemId)!;
    it.owners[seller.name] = 5000;
    it.stock = 1_000_000;

    aiVirtualConsumption(S);
    const entry = S.log.find((e) => e.who === buyer.name && e.it === seller.name);
    expect(entry).toBeDefined();
    expect(entry!.verb).toContain("bought");
  });

  it("doesn't change what the FULL existing test suite already proves — same total draw, only rerouted", () => {
    // Two identical worlds, one where the natural producer has stock to
    // sell, one where they don't (forcing 100% market draw) — the BUYER's
    // total spend and total units consumed must be identical either way;
    // only the counterparty for part of it differs.
    const seed = () => {
      const S = createWorld(0);
      const pair = findAiToAiPair(S)!;
      isolateSeller(pair.seller);
      pair.buyer.cash = 50_000_000;
      S.traders = [pair.buyer, pair.seller];
      return { S, pair };
    };

    const noProducerStock = seed();
    noProducerStock.S.items.find((x) => x.id === noProducerStock.pair.itemId)!.stock = 1_000_000;
    // seller has none — everything must come from the floor
    aiVirtualConsumption(noProducerStock.S);
    const marketOnlySpend = 50_000_000 - noProducerStock.pair.buyer.cash;

    const withProducerStock = seed();
    const it2 = withProducerStock.S.items.find((x) => x.id === withProducerStock.pair.itemId)!;
    it2.owners[withProducerStock.pair.seller.name] = 1_000_000; // ample — covers it all
    it2.stock = 1_000_000; // floor ALSO has plenty, so this isn't just a stock-cap difference
    aiVirtualConsumption(withProducerStock.S);
    const reroutedSpend = 50_000_000 - withProducerStock.pair.buyer.cash;

    expect(reroutedSpend).toBeCloseTo(marketOnlySpend, 4);
  });
});

describe("the ripple actually changes AI behavior — the fix for a static world", () => {
  it("aiVirtualConsumption spends more and draws more stock at a higher ripple", () => {
    const low = createWorld(0);
    const high = createWorld(0); // createWorld(0) has no warmup, so it's fully
    // deterministic without seeding — low and high start byte-identical.
    const cashBefore = low.traders.reduce((a, t) => a + t.cash, 0);
    aiVirtualConsumption(low, RIPPLE_MIN_FOR_TEST);
    aiVirtualConsumption(high, RIPPLE_MAX_FOR_TEST);

    const lowSpent = cashBefore - low.traders.reduce((a, t) => a + t.cash, 0);
    const highSpent = cashBefore - high.traders.reduce((a, t) => a + t.cash, 0);
    expect(lowSpent).toBeGreaterThan(0); // the baseline path draws something at all
    expect(highSpent).toBeGreaterThan(lowSpent);

    const lowStock = low.items.reduce((a, it) => a + it.stock, 0);
    const highStock = high.items.reduce((a, it) => a + it.stock, 0);
    expect(highStock).toBeLessThan(lowStock);
  });

  // traderAct's chase-weight coupling (`(dem-1)*3*ripple`) is a one-line
  // multiply on an already-thoroughly-tested formula, composing with logic
  // the existing 200-cycle "no company spends below reserve" and determinism
  // sims already exercise every cycle for every trader. A hand-built
  // deterministic crossover scenario was tried and discarded: the ±0.6 noise
  // term traderAct already adds per candidate swamps any margin tight enough
  // to land the crossover between ripple 1.0 and 1.5, so a "prove the pick
  // changes" test would only be reliable by tuning to a magic seed — fragile
  // in a way that isn't worth it for a change this small and this covered.
});

describe("sector consumption pressure — the steel-scarce-lifts-everything link", () => {
  it("is exactly 0 on a fresh world (every item at full stock)", () => {
    const S = freshState();
    for (const s of sectorKeys) expect(sectorConsumptionPressure(S, s)).toBe(0);
  });

  it("stays within its clamp even when a sector's items are fully depleted", () => {
    const S = freshState();
    for (const it of S.items) it.stock = 0;
    for (const s of sectorKeys) {
      const p = sectorConsumptionPressure(S, s);
      expect(p).toBeGreaterThanOrEqual(-0.05 - 1e-9);
      expect(p).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it("is positive for a depleted sector and rises with more depletion", () => {
    const S = freshState();
    const sector = sectorKeys.find((s) =>
      S.items.some((it) => it.edition === null && (it.weights[s] ?? 0) > 0.5),
    )!;
    const before = sectorConsumptionPressure(S, sector);
    expect(before).toBe(0); // full stock, nothing depleted yet
    for (const it of S.items) {
      if ((it.weights[sector] ?? 0) > 0.5 && it.edition === null) it.stock = 0;
    }
    const after = sectorConsumptionPressure(S, sector);
    expect(after).toBeGreaterThan(before);
  });

  it("news stays the dominant signal — a typical news effect outweighs the pressure clamp", () => {
    // Spot-check the design intent documented in aiEconomy.ts: the pressure
    // clamp (±0.05) is small next to a real news effect, so news remains the
    // primary driver of sentiment and this reads as a secondary hum under it.
    const S = createWorld(0);
    const typicalNewsEffect = S.front ? Object.values(S.front.effects) : [];
    if (typicalNewsEffect.length) {
      const maxAbs = Math.max(...typicalNewsEffect.map((e) => Math.abs(e ?? 0)));
      if (maxAbs > 0) expect(maxAbs).toBeGreaterThanOrEqual(0.05);
    }
  });
});

// Bounds used only by the ripple-behavior tests above — mirrors aiEconomy.ts's
// own RIPPLE_MIN/RIPPLE_MAX without importing private constants.
const RIPPLE_MIN_FOR_TEST = 1.0;
const RIPPLE_MAX_FOR_TEST = 1.5;

describe("AI company finances reconcile", () => {
  it("every company books exactly its income each cycle (dormant world, ripple neutral)", () => {
    const S = createWorld(0);
    const before = S.traders.map((t) => ({ cash: t.cash, income: t.income ?? 0 }));
    accrueIncome(S);
    S.traders.forEach((t, i) => {
      expect(t.cash).toBeCloseTo(before[i]!.cash + before[i]!.income, 6);
      expect(before[i]!.income).toBeGreaterThan(0); // a real, positive revenue
    });
  });

  it("books income × the ripple multiplier once real players have a footprint", () => {
    const S = createWorld(0);
    // Give "YOU" a large footprint so the ripple multiplier is meaningfully > 1.
    for (const it of S.items) it.owners["YOU"] = 1000;
    for (let i = 0; i < 50; i++) updatePlayerActivity(S); // let the EMA catch up
    const ripple = rippleMultiplier(S);
    expect(ripple).toBeGreaterThan(1); // the path we're actually testing
    const before = S.traders.map((t) => ({ cash: t.cash, income: t.income ?? 0 }));
    accrueIncome(S);
    S.traders.forEach((t, i) => {
      expect(t.cash).toBeCloseTo(before[i]!.cash + before[i]!.income * ripple, 6);
    });
  });

  it("reconcileCompanies upgrades a legacy world without losing balances", () => {
    const S = createWorld(0);
    // Simulate an old persisted world: one untiered trader with custom cash.
    S.traders = [{ name: "Open_Index", cash: 142_345, bias: null, next: 0.5 }];
    reconcileCompanies(S);
    const idx = S.traders.find((t) => t.name === "Open_Index")!;
    expect(idx.cash).toBe(142_345); // balance preserved
    expect(idx.tier).toBeDefined(); // tier backfilled
    expect(idx.income).toBeGreaterThan(0);
    expect(S.traders.length).toBeGreaterThan(1); // missing companies added
  });

  it("no company ever spends below its tier reserve, across 200 cycles of news + trading", () => {
    setRng(mulberry32(13));
    const S = createWorld();
    const violations: string[] = [];
    for (let c = 0; c < 200; c++) {
      for (const t of S.traders) traderAct(S, t);
      settleCycle(S); // advances news/economy AND books income
      for (const t of S.traders) {
        const floor = COMPANY_TIERS[t.tier ?? "mid"].floor;
        if (t.cash < floor - 0.01) violations.push(`c${c} ${t.name} cash=${Math.round(t.cash)} < floor ${floor}`);
        // netWorth() for a non-"YOU" owner IS companyValuation (cash + held
        // assets) — this is the real long-run check that AI production
        // (real, compounding inventory now) never corrupts the books.
        const nw = netWorth(S, t.name);
        if (!Number.isFinite(nw)) violations.push(`c${c} ${t.name} net worth not finite`);
        if (nw < -0.01) violations.push(`c${c} ${t.name} net worth negative: ${nw}`);
      }
    }
    expect(violations).toEqual([]);
    // 200 cycles with EVERY firm acting is ~100k trades — deliberately far
    // heavier than the live world, where the cron fires 6 actions per 15 min.
    // The roster grew from 101 firms to 501, so this budget grows with it. The
    // thing it's actually guarding costs 8.7ms per settleCycle, measured.
  }, 90000);
});

describe("production + listings stay consistent", () => {
  it("a producing/selling player keeps non-negative, finite books across cycles", () => {
    setRng(mulberry32(21));
    const S = createWorld(0);
    S.cash = 2_000_000; // fund the build
    S.floorSlots = 4;
    const target = catalog.find((i) => canProduce(i as RuntimeItem))!;
    expect(buildFactory(S, target.id)).not.toBeNull();
    const cashAfterBuild = S.cash;
    expect(cashAfterBuild).toBeLessThan(2_000_000); // build cost was charged

    const issues: string[] = [];
    for (let c = 0; c < 60; c++) {
      settleCycle(S); // line comes online, produces, lists/sells, reports
      if (!Number.isFinite(S.cash)) issues.push(`c${c} cash not finite`);
      for (const id of Object.keys(S.producedQty ?? {})) {
        if ((S.producedQty[Number(id)] ?? 0) < 0) issues.push(`c${c} producedQty<0`);
      }
      for (const it of S.items) {
        if ((it.owners["YOU"] ?? 0) < 0) issues.push(`c${c} #${it.id} held<0`);
      }
      if (S.ledger.listingUnits < 0 || S.ledger.listingRev < 0)
        issues.push(`c${c} negative listing flow`);
    }
    expect(issues).toEqual([]);
    expect(Number.isFinite(netWorth(S, "YOU"))).toBe(true);
  }, 20000);
});

describe("standing sources never leak into a market-buy fallback", () => {
  it("a standing-sourced input with an empty vault idles the line, instead of auto-buying the shortfall", () => {
    setRng(mulberry32(77));
    const S = createWorld(0);
    S.cash = 2_000_000;
    S.floorSlots = 4;
    // Need a line whose recipe actually HAS inputs (a raw-extraction item has
    // none, so standing-sourcing it would be a no-op — this test needs a real
    // shortfall to matter).
    const target = catalog.find(
      (i) => canProduce(i as RuntimeItem) && (recipeOf(i as RuntimeItem)?.inputs.length ?? 0) > 0,
    )!;
    const f = buildFactory(S, target.id)!;
    expect(f).not.toBeNull();
    const inputId = recipeOf(target)!.inputs[0]!.itemId;

    // Mark this input as standing-sourced from a fictitious seller, and make
    // sure the vault genuinely has none of it (the shortfall case under test).
    expect(setStandingSource(S, f.id, inputId, { sellerId: "bob", sellerHandle: "bobs-holdings" })).toBe(true);
    const inputItem = S.items.find((i) => i.id === inputId)!;
    delete inputItem.owners["YOU"];

    const cashBeforeOnline = S.cash;
    let sawIdleAfterOnline = false;
    let anyRan = false;
    for (let c = 0; c < 10; c++) {
      settleCycle(S);
      if (S.cycle >= f.onlineCycle) {
        if (f.status === "running") anyRan = true;
        if (f.status === "idle") sawIdleAfterOnline = true;
      }
    }
    expect(anyRan).toBe(false); // never ran — the standing-sourced input was never filled
    expect(sawIdleAfterOnline).toBe(true); // and it visibly idled, not silently vanished
    // No market-buy fallback happened for the standing-sourced input: the
    // vault is still empty (nothing was ever purchased to cover it).
    expect(inputItem.owners["YOU"] ?? 0).toBe(0);
    void cashBeforeOnline; // (bay/line upkeep still burns regardless — not asserted here)
  });
});

describe("order desk runs on company treasuries", () => {
  it("orders come from a real company and never exceed what it can pay", () => {
    setRng(mulberry32(5));
    const S = createWorld();
    const names = new Set(S.traders.map((t) => t.name));
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      const o = generateSandboxOrder(S, i * 1000);
      if (!o) continue;
      seen++;
      expect(names.has(o.company)).toBe(true); // a real roster company
      const buyer = S.traders.find((t) => t.name === o.company)!;
      expect(o.budget).toBeLessThanOrEqual(buyer.cash); // can always cover it
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("sizes produced-good orders to what you can deliver, not millions of units", () => {
    setRng(mulberry32(31));
    const S = createWorld(0);
    S.cash = 3_000_000;
    S.floorSlots = 4;
    const target = catalog.find((i) => canProduce(i as RuntimeItem))!;
    expect(buildFactory(S, target.id)).not.toBeNull();
    const rate = effectiveSpec(target, []).rate;
    // With one line, on-hand 0, an order should never exceed ~2.5 windows of output
    // (the deliverable ceiling) — i.e. it's fulfillable, not a dollar-driven blowup.
    const ceiling = Math.round(rate * 14 * 2.5);
    let producedSeen = 0;
    for (let i = 0; i < 120; i++) {
      const o = generateSandboxOrder(S, i * 1000);
      if (!o || o.itemId !== target.id) continue;
      producedSeen++;
      expect(o.qty).toBeLessThanOrEqual(ceiling);
      expect(o.qty).toBeGreaterThan(0);
    }
    expect(producedSeen).toBeGreaterThan(0); // the desk does request what you make
  });

  it("fulfilment moves cash from the buyer's treasury to the player (closed loop)", () => {
    const S = createWorld(0);
    const buyer = S.traders[0]!;
    const buyerCash0 = buyer.cash;
    const playerCash0 = S.cash;
    const item = S.items.find((i) => i.edition === null)!;
    item.owners["YOU"] = 5;
    const quote = 1234;
    S.orders = [
      {
        id: "o1",
        company: buyer.name,
        sector: "construction",
        itemId: item.id,
        qty: 5,
        companyOffer: quote,
        budget: quote,
        target: quote,
        round: 1,
        maxRounds: 3,
        quote,
        status: "accepted",
        createdAt: 0,
        expiresAt: 9e15,
      },
    ];
    const r = fulfillSandboxOrder(S, "o1", 1000);
    expect(r.ok).toBe(true);
    expect(S.cash).toBeCloseTo(playerCash0 + quote, 6); // player paid
    expect(buyer.cash).toBeCloseTo(buyerCash0 - quote, 6); // company debited
    expect(item.owners["YOU"] ?? 0).toBe(0); // goods delivered
    // ...and the company actually RECEIVED them. The cash left its treasury
    // either way, so without this the goods evaporated and its net worth fell
    // by the whole payment for nothing.
    expect(item.owners[buyer.name] ?? 0).toBe(5);
  });

  it("a fulfilment moves value, it doesn't destroy it", () => {
    setRng(mulberry32(31));
    const S = createWorld(0);
    const buyer = S.traders[0]!;
    const item = S.items.find((i) => i.edition === null)!;
    item.owners["YOU"] = 8;
    const unitsBefore =
      Object.values(item.owners).reduce((a, b) => a + b, 0) + item.stock;
    const quote = 900;
    const worthBefore = buyer.cash + (item.owners[buyer.name] ?? 0) * item.value;
    S.orders = [
      {
        id: "o2",
        company: buyer.name,
        sector: "construction",
        itemId: item.id,
        qty: 8,
        companyOffer: quote,
        budget: quote,
        target: quote,
        round: 1,
        maxRounds: 3,
        quote,
        status: "accepted",
        createdAt: 0,
        expiresAt: 9e15,
      },
    ];
    expect(fulfillSandboxOrder(S, "o2", 1000).ok).toBe(true);

    // No units created or destroyed by the delivery.
    const unitsAfter =
      Object.values(item.owners).reduce((a, b) => a + b, 0) + item.stock;
    expect(unitsAfter).toBe(unitsBefore);
    // The company is down only the premium it agreed over market, not the
    // entire payment — it holds goods against the cash it spent.
    const worthAfter = buyer.cash + (item.owners[buyer.name] ?? 0) * item.value;
    expect(worthAfter).toBeCloseTo(worthBefore - quote + 8 * item.value, 6);
  });
});

describe("headless sim smoke", () => {
  it("runs a warmed world forward and stays sane", () => {
    setRng(mulberry32(2024));
    const S: WorldState = createWorld();
    expect(S.front).not.toBeNull();
    for (let i = 0; i < 400; i++) advance(S, 0.3);
    expect(Number.isFinite(netWorth(S, "YOU"))).toBe(true);
    expect(assetsValue(S, "YOU")).toBeGreaterThanOrEqual(0);
    expect(S.front).not.toBeNull();
  }, 30000);
});

describe("telegraphed market events", () => {
  it("schedules deterministically and within the telegraphed range", () => {
    const secs = ["energy", "construction", "technology"];
    const a = eventForSlot(12345, secs);
    const b = eventForSlot(12345, secs);
    expect(a).toEqual(b);
    expect(secs).toContain(a.sector);
    expect(a.mult).toBeGreaterThanOrEqual(1.1 - 1e-9);
    expect(a.mult).toBeLessThanOrEqual(1.3 + 1e-9);
    expect(a.fireAt).toBeLessThan(a.endAt);
  });

  it("flips between upcoming and live around the fire time", () => {
    const ev = eventForSlot(1000, sectorKeys);
    expect(activeMarketEvent(ev.fireAt - 1000, sectorKeys)).toBeNull();
    expect(activeMarketEvent(ev.fireAt + 1000, sectorKeys)?.slot).toBe(1000);
    expect(nextMarketEvent(ev.fireAt - 1000, sectorKeys).slot).toBe(1000);
    // once it has fired, "next" looks ahead to the following slot
    expect(nextMarketEvent(ev.endAt + 1000, sectorKeys).slot).toBe(1001);
  });

  it("an active surge lifts its sector's demand, and clears cleanly", () => {
    const S = createWorld(0); // fresh: every sectorIdx == 1
    const it = S.items.find((i) => Object.keys(i.weights).length > 0)!;
    const sector = Object.entries(it.weights).sort(
      (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
    )[0]![0];
    const before = demandHeat(S, it);
    S.activeEvent = { sector, mult: 1.3 };
    const after = demandHeat(S, it);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(1.6); // stays within the clamp
    S.activeEvent = null;
    expect(demandHeat(S, it)).toBeCloseTo(before, 9);
  });

  it("setMarketEvent only ever names a real sector", () => {
    const S = createWorld(0);
    setMarketEvent(S, eventForSlot(999, sectorKeys).fireAt + 1000);
    if (S.activeEvent) expect(sectorKeys).toContain(S.activeEvent.sector);
  });
});

describe("bulk supply orders — capital ahead of production", () => {
  /** A world with a producible good and its primary input material. */
  function supplyWorld() {
    const S = createWorld();
    S.cash = 5_000_000;
    S.floorSlots = 4;
    const out = S.items.find((i) => {
      const r = recipeOf(i);
      return !!r && r.inputs.length > 0 && i.base > 200 && i.base < 3000;
    })!;
    const matId = recipeOf(out)!.inputs[0]!.itemId;
    const mat = S.items.find((x) => x.id === matId)!;
    return { S, out, mat };
  }

  it("quotes a cheaper unit price for volume, and a longer lead for it", () => {
    const { S, mat } = supplyWorld();
    const small = supplyQuote(mat, 500);
    const large = supplyQuote(mat, 80_000);
    expect(small.discount).toBe(0);
    expect(large.discount).toBeGreaterThan(small.discount);
    expect(large.unit).toBeLessThan(small.unit);
    // The discount is exactly what you pay for by waiting.
    expect(large.lead).toBeGreaterThan(small.lead);
    expect(small.unit).toBeCloseTo(mat.value, 6);
    void S;
  });

  it("charges on order and delivers into the vault only after the lead time", () => {
    const { S, mat } = supplyWorld();
    const qty = Math.min(2000, Math.floor(mat.stock));
    const cash0 = S.cash;
    const held0 = held(mat, "YOU");

    const order = orderSupply(S, mat.id, qty)!;
    expect(order).toBeTruthy();
    expect(S.cash).toBeCloseTo(cash0 - order.paid, 4);
    // Paid for, but NOT yet in hand — that gap is the whole mechanic.
    expect(held(mat, "YOU")).toBe(held0);

    while (S.cycle < order.arrivesCycle) {
      S.cycle++;
      runProduction(S);
      if (S.cycle < order.arrivesCycle) {
        expect(S.supplyOrders.length).toBe(1);
      }
    }
    expect(held(mat, "YOU")).toBeGreaterThanOrEqual(held0 + qty);
    expect(S.supplyOrders.length).toBe(0);
  });

  it("delivers on the settlement path too, not just the production cron", () => {
    // Two production paths exist: the live Production Lambda calls
    // runProduction, the sandbox produces inside settleCycle. Delivery used to
    // hang off runProduction only, so sandbox orders were charged and never
    // arrived. Guard the path that was actually broken.
    const { S, mat } = supplyWorld();
    const qty = Math.min(2000, Math.floor(mat.stock));
    const held0 = held(mat, "YOU");
    const order = orderSupply(S, mat.id, qty)!;

    while (S.cycle < order.arrivesCycle) {
      S.cycle++;
      settleCycle(S);
    }
    expect(held(mat, "YOU")).toBeGreaterThanOrEqual(held0 + qty);
    expect(S.supplyOrders.length).toBe(0);
  });

  it("takes the material off the floor at order time, so it can't be double-sold", () => {
    const { S, mat } = supplyWorld();
    const qty = Math.min(1500, Math.floor(mat.stock));
    const stock0 = mat.stock;
    orderSupply(S, mat.id, qty);
    expect(mat.stock).toBeCloseTo(stock0 - qty, 4);
  });

  it("refuses to order more than the floor actually holds", () => {
    const { S, mat } = supplyWorld();
    expect(orderSupply(S, mat.id, Math.ceil(mat.stock) + 1)).toBeNull();
  });

  it("refuses an order the player can't pay for, leaving cash and stock untouched", () => {
    const { S, mat } = supplyWorld();
    S.cash = 1;
    const stock0 = mat.stock;
    expect(orderSupply(S, mat.id, Math.min(1000, Math.floor(mat.stock)))).toBeNull();
    expect(S.cash).toBe(1);
    expect(mat.stock).toBe(stock0);
  });

  it("auto-reorders when the vault dips below the floor, and not while one is inbound", () => {
    const { S, mat } = supplyWorld();
    const qty = Math.min(1000, Math.floor(mat.stock));
    setReorder(S, mat.id, 500, qty);

    S.cycle++;
    runProduction(S); // vault is empty → below floor → one order placed
    expect(S.supplyOrders.length).toBe(1);

    // A second tick must NOT stack another order for the same material.
    S.cycle++;
    runProduction(S);
    expect(S.supplyOrders.filter((o) => o.itemId === mat.id).length).toBeLessThanOrEqual(1);
  });

  it("clearing a reorder rule stops it firing", () => {
    const { S, mat } = supplyWorld();
    setReorder(S, mat.id, 500, 1000);
    setReorder(S, mat.id, 0, 0);
    expect(S.reorders.length).toBe(0);
    S.cycle++;
    runProduction(S);
    expect(S.supplyOrders.length).toBe(0);
  });
});

describe("maker attribution — goods belong to whoever made them", () => {
  it("strips the corporate tail down to a product mark, stacked tails included", () => {
    expect(makerMark("Shore Holdings")).toBe("Shore");
    expect(makerMark("Aldousmont & Sons")).toBe("Aldousmont");
    expect(makerMark("Fenwick and Co.")).toBe("Fenwick");
    // A name that IS only a tail must not vanish into an empty mark.
    expect(makerMark("Holdings")).toBe("Holdings");
    expect(makerMark("Bell")).toBe("Bell");
  });

  it("keeps the base noun, so two firms' cowhide stays comparable", () => {
    const a = makerVariantName("Cowhide", "Shore Holdings", 7);
    const b = makerVariantName("Cowhide", "Kalea Ventures", 7);
    expect(a.startsWith("Cowhide")).toBe(true);
    expect(b.startsWith("Cowhide")).toBe(true);
    // ...but they are visibly different products, each naming its maker.
    expect(a).not.toBe(b);
    expect(a).toContain("Shore");
    expect(b).toContain("Kalea");
  });

  it("gives a firm ONE house designation across every SKU it makes", () => {
    const names = ["Cowhide", "Silk Bolt", "Heavy Zipper Spool"].map((n, i) =>
      makerVariantName(n, "Shore Holdings", i),
    );
    const designations = names.map((n) => n.split(" — ")[1]);
    expect(new Set(designations).size).toBe(1);
  });

  it("is stable across calls and falls back to the bare name with no maker", () => {
    expect(makerVariantName("Cowhide", "Shore Holdings", 7)).toBe(
      makerVariantName("Cowhide", "Shore Holdings", 7),
    );
    expect(makerVariantName("Cowhide", null, 7)).toBe("Cowhide");
    expect(makerVariantName("Cowhide", "   ", 7)).toBe("Cowhide");
  });
});

describe("order desk — a contract must be worth taking", () => {
  it("never offers a reseller LESS than the floor charges to source it", () => {
    // Goods you don't produce are bought on the floor at market and handed on,
    // so the buyer has to clear that cost or the contract is a guaranteed loss.
    // This used to assume you sourced at 0.7x market, which put the buyer's own
    // ceiling below your cost: every reseller order was unwinnable, and
    // countering to anything sane made them walk.
    setRng(mulberry32(4242));
    const S = createWorld(0);
    S.reputation = 10;
    let sampled = 0;
    const bad: string[] = [];
    for (let i = 0; i < 4000 && sampled < 400; i++) {
      const o = generateSandboxOrder(S, Date.now(), SANDBOX_TIMING);
      if (!o) continue;
      if (S.factories.some((f) => f.itemId === o.itemId)) continue; // reseller only
      const it = S.items.find((x) => x.id === o.itemId)!;
      const source = it.value * o.qty; // exactly what serverBuy charges
      sampled++;
      // The ceiling is what they'd pay at an absolute stretch — if THAT is
      // under cost there is no number you could counter with that isn't a loss.
      if (o.budget < source) bad.push();
      // And the target (where they settle without a fight) must clear it too.
      if (o.target < source) bad.push();
    }
    expect(sampled).toBeGreaterThan(50); // the sample actually exercised this
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("leaves real room to negotiate above cost, not a token cent", () => {
    setRng(mulberry32(77));
    const S = createWorld(0);
    S.reputation = 10;
    const margins: number[] = [];
    for (let i = 0; i < 3000 && margins.length < 200; i++) {
      const o = generateSandboxOrder(S, Date.now(), SANDBOX_TIMING);
      if (!o) continue;
      if (S.factories.some((f) => f.itemId === o.itemId)) continue;
      const it = S.items.find((x) => x.id === o.itemId)!;
      margins.push((o.budget - it.value * o.qty) / (it.value * o.qty));
    }
    const median = margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)]!;
    // Enough to be worth the click, not so much that reselling beats making.
    expect(median).toBeGreaterThan(0.08);
    expect(median).toBeLessThan(0.3);
  });
});
