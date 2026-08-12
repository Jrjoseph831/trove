/**
 * Guards on whole-record player writes.
 *
 * Every Lambda that touches a player does read → mutate → write, and the
 * settlement and production paths write the WHOLE record. Without a per-player
 * guard, a write built from a snapshot taken seconds earlier silently reverts
 * anything that landed in between — which is how a player's cash, factories or
 * purchases can disappear with no error anywhere. These pin the guard that
 * makes that impossible.
 */
import { describe, expect, it } from "vitest";
import { guardedPut, type Player } from "./repo";

const player = (over: Partial<Player> = {}): Player => ({
  playerId: "p1",
  cash: 1000,
  debt: 0,
  ...over,
});

describe("guarded player writes", () => {
  it("only overwrites a record still carrying the rev we read", () => {
    const { Item, ConditionExpression, ExpressionAttributeValues } = guardedPut(
      player({ rev: 7 }),
    );
    expect(ConditionExpression).toBe("rev = :rev");
    expect(ExpressionAttributeValues).toEqual({ ":rev": 7 });
    // And the write moves the record on, so the next stale writer loses too.
    expect(Item.rev).toBe(8);
  });

  it("accepts records written before rev existed, without a backfill", () => {
    const { Item, ConditionExpression, ExpressionAttributeValues } = guardedPut(player());
    // Matches a brand-new record OR a legacy one; the write itself migrates it.
    expect(ConditionExpression).toBe(
      "attribute_not_exists(playerId) OR attribute_not_exists(rev)",
    );
    expect(ExpressionAttributeValues).toBeUndefined();
    expect(Item.rev).toBe(1);
  });

  it("does not mutate the caller's record", () => {
    const p = player({ rev: 3 });
    guardedPut(p);
    expect(p.rev).toBe(3);
  });

  it("keeps every other field intact", () => {
    const p = player({ rev: 1, cash: 42, name: "Shore Holdings", floorSlots: 4 });
    const { Item } = guardedPut(p);
    expect(Item.cash).toBe(42);
    expect(Item.name).toBe("Shore Holdings");
    expect(Item.floorSlots).toBe(4);
  });

  it("names its value slot per player, so one transaction can guard many", () => {
    // A settlement commit writes up to 99 players in ONE transaction; sharing
    // a value key across them would make every guard check the same rev.
    const a = guardedPut(player({ playerId: "a", rev: 1 }), "p0");
    const b = guardedPut(player({ playerId: "b", rev: 5 }), "p1");
    expect(a.ConditionExpression).toBe("rev = :revp0");
    expect(b.ConditionExpression).toBe("rev = :revp1");
    expect(a.ExpressionAttributeValues).toEqual({ ":revp0": 1 });
    expect(b.ExpressionAttributeValues).toEqual({ ":revp1": 5 });
  });
});
