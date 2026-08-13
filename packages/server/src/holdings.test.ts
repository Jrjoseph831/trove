/**
 * Holdings survive a trade.
 *
 * Goods moved off the world doc onto the player record, so any path that runs
 * the engine on a doc-derived world MUST put them back first. Miss it and the
 * world says the player owns nothing, the engine agrees, and the sync writes
 * that back as the truth — every purchase quietly erasing everything else they
 * held. Nothing errors; the goods are simply gone.
 */
import { describe, expect, it } from "vitest";
import { createWorld, START_CASH } from "@trove/engine";
import {
  docToWorld,
  hydrateHoldings,
  syncHoldings,
  worldToDoc,
  type Player,
} from "./repo";

/** A doc with player ownership stripped, exactly as it is persisted now. */
function strippedDoc() {
  const doc = worldToDoc(createWorld(0), 1);
  for (const it of doc.items) it.owners = {};
  return doc;
}

describe("holdings across a trade", () => {
  it("keeps everything else you own when you buy one more thing", () => {
    const doc = strippedDoc();
    const open = doc.items.filter((i) => i.remaining === null).slice(0, 3);
    const [a, b, c] = open as [typeof open[0], typeof open[0], typeof open[0]];
    const player: Player = {
      playerId: "p1",
      cash: START_CASH,
      debt: 0,
      holdings: { [a.id]: 40, [b.id]: 7 },
    };

    const state = docToWorld(doc);
    hydrateHoldings(state, player);
    // Buy a third item, as serverBuy would.
    const bought = state.items.find((i) => i.id === c.id)!;
    bought.owners[player.playerId] = (bought.owners[player.playerId] ?? 0) + 5;
    syncHoldings(state, player);

    expect(player.holdings).toEqual({ [a.id]: 40, [b.id]: 7, [c.id]: 5 });
  });

  it("can sell something bought in an earlier session", () => {
    // Without hydration the engine sees zero held and the sell has nothing to
    // take — goods you own become unsellable the moment the doc is stripped.
    const doc = strippedDoc();
    const item = doc.items.find((i) => i.remaining === null)!;
    const player: Player = {
      playerId: "p1",
      cash: START_CASH,
      debt: 0,
      holdings: { [item.id]: 12 },
    };

    const state = docToWorld(doc);
    hydrateHoldings(state, player);
    const live = state.items.find((i) => i.id === item.id)!;
    expect(live.owners[player.playerId]).toBe(12); // visible to the engine

    live.owners[player.playerId] = 12 - 5; // sell 5
    syncHoldings(state, player);
    expect(player.holdings).toEqual({ [item.id]: 7 });
  });

  it("leaves a pre-migration record alone, so the doc still speaks for it", () => {
    const doc = worldToDoc(createWorld(0), 1);
    const item = doc.items.find((i) => i.remaining === null)!;
    item.owners = { p1: 30 };
    const legacy: Player = { playerId: "p1", cash: START_CASH, debt: 0 };

    const state = docToWorld(doc);
    hydrateHoldings(state, legacy); // no holdings field — must not wipe the doc
    expect(state.items.find((i) => i.id === item.id)!.owners["p1"]).toBe(30);
  });
});
