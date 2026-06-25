/**
 * Server-side trade logic — the multiplayer analogue of the engine's
 * playerBuy/playerSell. Operates on a rehydrated WorldState and a named Player
 * (holdings live in item.owners[playerId], cash on the player record). Throws
 * TradeError to reject; the caller's atomic commit guarantees no two players
 * claim the last edition copy.
 */
import { lotSize } from "@trove/data";
import { canBuy, held, type RuntimeItem, type WorldState } from "@trove/engine";
import { TradeError, type Player } from "./repo";

export interface TradeOutcome {
  action: "buy" | "sell";
  itemId: number;
  /** Units actually traded (bulk goods trade in cases). */
  qty: number;
  /** Per-unit price at execution. */
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

export function serverBuy(
  state: WorldState,
  player: Player,
  id: number,
  qty = 1,
): TradeOutcome {
  const it = findItem(state, id);
  const isEd = it.edition !== null;
  const lot = lotSize(it);
  const n = isEd ? 1 : Math.floor(qty);
  if (n < 1) throw new TradeError("bad quantity");
  if (!isEd && (n % lot !== 0 || n < lot))
    throw new TradeError(`sold in cases of ${lot}`);
  if (!canBuy(it)) throw new TradeError("sold out");
  if (!isEd && it.stock < n) throw new TradeError("not enough stock");
  const cost = it.value * n;
  if (cost > player.cash) throw new TradeError("insufficient funds");

  it.owners[player.playerId] = (it.owners[player.playerId] ?? 0) + n;
  let copyNo: number | null = null;
  if (isEd) {
    copyNo = (it.edition as number) - it.remaining + 1; // the copy being claimed
    it.remaining--;
  } else {
    it.stock -= n;
  }
  player.cash -= cost;
  return {
    action: "buy",
    itemId: id,
    qty: n,
    value: it.value,
    copyNo,
    cash: player.cash,
    held: it.owners[player.playerId]!,
  };
}

export function serverSell(
  state: WorldState,
  player: Player,
  id: number,
  qty = 1,
): TradeOutcome {
  const it = findItem(state, id);
  const have = held(it, player.playerId);
  if (have <= 0) throw new TradeError("you don't own this");
  const isEd = it.edition !== null;
  const n = isEd ? 1 : Math.min(Math.max(1, Math.floor(qty)), have);

  it.owners[player.playerId] = have - n;
  const left = it.owners[player.playerId]!;
  if (left <= 0) delete it.owners[player.playerId];
  if (isEd) it.remaining++;
  else it.stock += n;
  player.cash += it.value * n;
  return {
    action: "sell",
    itemId: id,
    qty: n,
    value: it.value,
    copyNo: null,
    cash: player.cash,
    held: left,
  };
}
