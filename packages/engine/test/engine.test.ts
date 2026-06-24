import { afterEach, describe, expect, it } from "vitest";
import { items as catalog } from "@trove/data";
import {
  advance,
  assetsValue,
  canBuy,
  createWorld,
  elasticity,
  freshState,
  held,
  mulberry32,
  netWorth,
  playerBuy,
  playerSell,
  priceItem,
  resetRng,
  scarcity,
  setRng,
  settleCycle,
  traderAct,
  type RuntimeItem,
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
    expect(S.cash).toBe(25000);
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
  });
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

describe("headless sim smoke", () => {
  it("runs a warmed world forward and stays sane", () => {
    setRng(mulberry32(2024));
    const S: WorldState = createWorld();
    expect(S.front).not.toBeNull();
    for (let i = 0; i < 400; i++) advance(S, 0.3);
    expect(Number.isFinite(netWorth(S, "YOU"))).toBe(true);
    expect(assetsValue(S, "YOU")).toBeGreaterThanOrEqual(0);
    expect(S.front).not.toBeNull();
  });
});
