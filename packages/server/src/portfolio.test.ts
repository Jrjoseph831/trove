/**
 * What a player is told they own.
 *
 * Holdings live in the WORLD DOC keyed by player id — the player record holds
 * cash and factory state, not goods. So the two can exist independently, and
 * anything that reports a portfolio has to read the doc rather than assume a
 * missing record means an empty account. Getting this wrong is invisible from
 * the outside: the endpoint answers 200 with a plausible starting balance, and
 * trades keep committing against a doc nobody is reading back.
 */
import { describe, expect, it } from "vitest";
import { createWorld, START_CASH } from "@trove/engine";
import {
  buildPortfolio,
  holdingsOf,
  propertyValueOf,
  stakeValueOf,
  worldToDoc,
  type Player,
  type WorldDoc,
} from "./repo";

const ME = "player-1";

/** A world doc where `owner` holds `qty` of the first open item. */
function docHolding(owner: string, qty: number): { doc: WorldDoc; itemId: number } {
  const doc = worldToDoc(createWorld(0), 1);
  const it = doc.items.find((x) => x.remaining === null)!;
  it.owners = { ...(it.owners ?? {}), [owner]: qty };
  return { doc, itemId: it.id };
}

describe("portfolio reporting", () => {
  it("reports goods held in the world doc even with no player record yet", () => {
    // The exact shape that made buying look like it did nothing: the trade
    // committed ownership to the doc, but the portfolio was served from a
    // hardcoded empty account and never looked.
    const { doc, itemId } = docHolding(ME, 12);
    const shell: Player = { playerId: ME, cash: START_CASH, debt: 0 };

    const view = buildPortfolio(doc, shell);

    expect(view.holdings.find((h) => h.id === itemId)?.qty).toBe(12);
    expect(view.netWorth).toBeGreaterThan(START_CASH); // goods counted as assets
  });

  it("keeps one player's goods out of another's portfolio", () => {
    const { doc, itemId } = docHolding("someone-else", 40);
    const view = buildPortfolio(doc, { playerId: ME, cash: START_CASH, debt: 0 });
    expect(view.holdings.find((h) => h.id === itemId)).toBeUndefined();
    expect(view.netWorth).toBe(START_CASH);
  });

  it("values a firm the same way the leaderboard does", () => {
    // These are two endpoints answering one question: what is this firm worth?
    // /standings counted only cash and goods, so anyone holding real estate or
    // equity was ranked below what their own screen told them — with nothing to
    // say which figure was lying. Both must sum the same four terms.
    const { doc, itemId } = docHolding(ME, 6);
    const house = doc.traders[0]!;
    const player: Player = {
      playerId: ME,
      cash: 100_000,
      debt: 10_000,
      properties: [{ id: 1, name: "A yard", value: 250_000 } as never],
      stakes: { [house.name]: 0.25 },
    };

    const view = buildPortfolio(doc, player);

    // Rebuild the leaderboard's sum from its own parts, as standings does.
    const goods =
      (doc.items.find((i) => i.id === itemId)!.owners![ME] ?? 0) *
      doc.items.find((i) => i.id === itemId)!.value;
    const board =
      player.cash -
      player.debt +
      goods +
      propertyValueOf(player) +
      stakeValueOf(doc, player);

    expect(board).toBeCloseTo(view.netWorth, 6);
    // And the extra terms are actually material — otherwise this passes for
    // the wrong reason on a firm that owns neither.
    expect(propertyValueOf(player)).toBe(250_000);
    expect(stakeValueOf(doc, player)).toBeGreaterThan(0);
  });

  it("reads goods off the player's own record once they've moved there", () => {
    // The whole point of the split: the world doc no longer has to carry a
    // player's goods, so it stops growing with the player count.
    const { doc, itemId } = docHolding("nobody", 0);
    const player: Player = {
      playerId: ME,
      cash: START_CASH,
      debt: 0,
      holdings: { [itemId]: 30 },
    };
    const view = buildPortfolio(doc, player);
    expect(view.holdings.find((h) => h.id === itemId)?.qty).toBe(30);
    // ...priced off the doc, which still owns the market value.
    const price = doc.items.find((i) => i.id === itemId)!.value;
    expect(view.netWorth).toBeCloseTo(START_CASH + 30 * price, 4);
  });

  it("still finds goods in the world doc for a record not yet migrated", () => {
    // An existing account's goods live only in the doc until the backfill runs.
    // Reading them has to keep working in the meantime, or the split would blank
    // every account the moment it deployed.
    const { doc, itemId } = docHolding(ME, 9);
    const notMigrated: Player = { playerId: ME, cash: START_CASH, debt: 0 };
    expect(holdingsOf(doc, notMigrated)).toEqual({ [itemId]: 9 });
    expect(buildPortfolio(doc, notMigrated).holdings[0]?.qty).toBe(9);
  });

  it("prefers the record over the doc, so a migrated account can't double-count", () => {
    // Both populated: mid-migration, or a doc entry not yet stripped. The
    // record is authoritative — reading both would inflate the account.
    const { doc, itemId } = docHolding(ME, 9);
    const migrated: Player = {
      playerId: ME,
      cash: START_CASH,
      debt: 0,
      holdings: { [itemId]: 4 },
    };
    expect(holdingsOf(doc, migrated)).toEqual({ [itemId]: 4 });
  });

  it("treats a migrated-but-empty account as empty, not as unmigrated", () => {
    // A player who sold everything has holdings:{} — which is falsy-looking but
    // very much migrated. Falling back to the doc here would resurrect goods
    // they no longer own.
    const { doc, itemId } = docHolding(ME, 12);
    const soldUp: Player = { playerId: ME, cash: START_CASH, debt: 0, holdings: {} };
    expect(holdingsOf(doc, soldUp)).toEqual({});
    expect(buildPortfolio(doc, soldUp).holdings).toEqual([]);
    void itemId;
  });

  it("never reports NaN money, even from a record missing its cash field", () => {
    // A partial record can be created by an upsert that only sets one
    // attribute; every downstream figure would silently become NaN and
    // serialise to null, blanking the whole UI.
    const { doc } = docHolding(ME, 5);
    const partial = { playerId: ME } as unknown as Player;
    const view = buildPortfolio(doc, partial);
    for (const [k, v] of Object.entries(view)) {
      if (typeof v === "number") expect(Number.isNaN(v), `${k} is NaN`).toBe(false);
    }
  });
});
