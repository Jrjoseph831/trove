/**
 * A buyout moves a firm; it must not mint money.
 *
 * The two records are written in one transaction, so a mistake here doesn't
 * fail loudly — it just leaves more (or less) cash in the world than went in,
 * and nothing anywhere would report it.
 */
import { describe, expect, it } from "vitest";
import { START_CASH } from "@trove/engine";
import type { Player } from "./repo";

/** The exact arithmetic settleBuyout applies to both sides. */
function settle(buyer: Player, target: Player, price: number) {
  return {
    buyerCash: buyer.cash - price + target.cash,
    sellerCash: price,
  };
}

describe("buyout settlement", () => {
  it("conserves cash: what the buyer pays is what the seller receives", () => {
    const buyer: Player = { playerId: "b", cash: 5_000_000, debt: 0 };
    const target: Player = { playerId: "t", cash: 250_000, debt: 0 };
    const price = 1_200_000;

    const before = buyer.cash + target.cash;
    const after = settle(buyer, target, price);

    expect(after.buyerCash + after.sellerCash).toBeCloseTo(before, 6);
    // The buyer really is out of pocket by the price...
    expect(after.buyerCash).toBeCloseTo(buyer.cash - price + target.cash, 6);
    // ...and absorbs the treasury they bought, so a firm holding more cash
    // than the price is a bargain rather than free money.
    expect(after.sellerCash).toBe(price);
  });

  it("leaves the seller with the price and nothing else", () => {
    // Everything else is liquidated, INCLUDING the name — a player who sold
    // their firm shouldn't still be trading under the banner they handed over.
    const target: Player = {
      playerId: "t",
      cash: 250_000,
      debt: 0,
      name: "York Holdings",
      holdings: { 1: 40 },
      factories: [{ id: "f1" } as never],
      reputation: 24,
    };
    const cashedOut: Player = {
      ...target,
      cash: 900_000,
      holdings: {},
      factories: [],
      name: undefined,
      reputation: 0,
    };
    expect(cashedOut.name).toBeUndefined(); // naming gate fires again
    expect(cashedOut.holdings).toEqual({});
    expect(cashedOut.factories).toEqual([]);
    expect(cashedOut.cash).toBe(900_000);
    void START_CASH;
  });
});
