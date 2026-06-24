/**
 * Server-side trade logic — the multiplayer analogue of the engine's
 * playerBuy/playerSell. Operates on a rehydrated WorldState and a named Player
 * (holdings live in item.owners[playerId], cash on the player record). Throws
 * TradeError to reject; the caller's atomic commit guarantees no two players
 * claim the last edition copy.
 */
import { canBuy, held, type RuntimeItem, type WorldState } from "@trove/engine";
import { TradeError, type Player } from "./repo";

export interface TradeOutcome {
  action: "buy" | "sell";
  itemId: number;
  value: number;
  /** Edition copy number claimed on buy (for the reveal), else null. */
  copyNo: number | null;
  /** Player's cash after the trade. */
  cash: number;
  /** Player's remaining quantity of this item after the trade. */
  held: number;
}

function findItem(state: WorldState, id: number): RuntimeItem {
  const it = state.items.find((i) => i.id === id);
  if (!it) throw new TradeError("no such item");
  return it;
}

export function serverBuy(state: WorldState, player: Player, id: number): TradeOutcome {
  const it = findItem(state, id);
  if (!canBuy(it)) throw new TradeError("sold out");
  if (it.value > player.cash) throw new TradeError("insufficient funds");

  it.owners[player.playerId] = (it.owners[player.playerId] ?? 0) + 1;
  let copyNo: number | null = null;
  if (it.edition !== null) {
    copyNo = it.edition - it.remaining + 1; // the copy being claimed
    it.remaining--;
  } else {
    it.stock = Math.max(0, it.stock - 1);
  }
  player.cash -= it.value;
  return {
    action: "buy",
    itemId: id,
    value: it.value,
    copyNo,
    cash: player.cash,
    held: it.owners[player.playerId]!,
  };
}

export function serverSell(state: WorldState, player: Player, id: number): TradeOutcome {
  const it = findItem(state, id);
  if (held(it, player.playerId) <= 0) throw new TradeError("you don't own this");

  it.owners[player.playerId]!--;
  const left = it.owners[player.playerId] ?? 0;
  if (left <= 0) delete it.owners[player.playerId];
  if (it.edition !== null) it.remaining++;
  else it.stock++;
  player.cash += it.value;
  return {
    action: "sell",
    itemId: id,
    value: it.value,
    copyNo: null,
    cash: player.cash,
    held: left,
  };
}
