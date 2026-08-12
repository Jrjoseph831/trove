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
import { buildPortfolio, worldToDoc, type Player, type WorldDoc } from "./repo";

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
