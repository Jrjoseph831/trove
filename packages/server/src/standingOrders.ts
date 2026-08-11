/**
 * Standing-order settlement planning — pure, DynamoDB-free logic for the
 * production Lambda's pre-step (see handlers/production.ts). Computes which
 * standing-sourced factory inputs are short this tick and, for sellers who
 * have opted in (`site.autoSupply`), settles the draw directly against their
 * live storefront price and available stock — no PvpOrder, no human accept
 * needed (there's nothing to negotiate: the seller already priced it via
 * their own listing).
 *
 * Callers own all I/O: this module never touches ddb. `sellers` must already
 * be loaded (e.g. via repo.ts's getPlayers) before calling planStandingSettlements.
 */
import { previewFactoryNeeds } from "@trove/engine";
import type { WorldState } from "@trove/engine";
import { storefrontOf, type Player, type WorldDoc } from "./repo";

export interface StandingFill {
  buyerId: string;
  lineId: string;
  itemId: number;
  sellerId: string;
  qty: number;
  unitPrice: number;
  cost: number;
}

/** Cash/holdings deltas for a seller who is NOT a producer this tick (so they
 *  have no `pv` in `pvById` for the caller to fold automatically) — the
 *  caller applies these as a standalone patch when building `updated`. */
export interface SellerPatch {
  cashDelta: number;
  /** itemId → signed delta (always negative here — goods leaving the seller). */
  producedDelta: Record<number, number>;
}

export interface StandingSettlementResult {
  fills: StandingFill[];
  sellerPatches: Map<string, SellerPatch>;
}

interface Shortfall {
  buyerId: string;
  lineId: string;
  itemId: number;
  sellerId: string;
  qty: number;
}

/**
 * Plan (and directly apply to the given `pvById` player-views) this tick's
 * standing-order settlements.
 *
 * NOTE on cadence: this only tops up ONE cycle's worth of need per invocation
 * (not a full multi-cycle catch-up total), even if a buyer's factory is about
 * to catch up several missed production ticks in the same Lambda run. This is
 * a deliberate simplification — it can only ever under-fill, never over-spend
 * against a possibly-shifting multi-cycle projection — and any shortfall left
 * over just idles the line and is retried next tick, the same graceful
 * degradation every other input-shortage path in this codebase already uses.
 *
 * `pvById` entries MUST already have `.cycle` set to the tick this settlement
 * should evaluate lines' online/offline status against (production.ts's
 * FAST production-tick basis, not the slow 6h world cycle `playerView`
 * defaults to) — see handlers/production.ts for how this is set before calling.
 */
export function planStandingSettlements(
  cur: WorldDoc,
  full: WorldState,
  producers: Player[],
  pvById: Map<string, WorldState>,
  sellers: Player[],
  txBudget: number,
): StandingSettlementResult {
  const fills: StandingFill[] = [];
  const sellerPatches = new Map<string, SellerPatch>();
  const producerIds = new Set(producers.map((p) => p.playerId));
  const sellerById = new Map(sellers.map((s) => [s.playerId, s]));

  // 1. Collect standing-sourced shortfalls, grouped by seller.
  const shortfallsBySeller = new Map<string, Shortfall[]>();
  for (const p of producers) {
    const pv = pvById.get(p.playerId);
    if (!pv) continue;
    for (const need of previewFactoryNeeds(pv)) {
      const line = pv.factories.find((f) => f.id === need.lineId);
      const src = line?.standingSources?.[need.itemId];
      if (!src) continue;
      const shortfall = Math.max(0, need.needPerCycle - need.have);
      if (shortfall <= 0) continue;
      const list = shortfallsBySeller.get(src.sellerId) ?? [];
      list.push({
        buyerId: p.playerId,
        lineId: need.lineId,
        itemId: need.itemId,
        sellerId: src.sellerId,
        qty: shortfall,
      });
      shortfallsBySeller.set(src.sellerId, list);
    }
  }
  if (shortfallsBySeller.size === 0) return { fills, sellerPatches };

  // 2. Reserve transaction-item budget for sellers who AREN'T already
  //    producers this tick (a producer-seller needs no extra transaction
  //    item — they're already in `updated` via the main production loop).
  let newSellerBudget = txBudget;

  for (const [sellerId, shortfalls] of shortfallsBySeller) {
    const seller = sellerById.get(sellerId);
    if (!seller) continue; // couldn't load (deleted/renamed) — skip, self-heals
    if (!seller.site?.published || !seller.site?.autoSupply) continue;

    const isNewSeller = !producerIds.has(sellerId);
    if (isNewSeller) {
      if (newSellerBudget <= 0) continue; // tx-cap backpressure — skip this seller entirely this tick
      newSellerBudget--;
    }

    const store = storefrontOf(cur, seller);

    // A seller can be referenced by multiple lines/buyers for the same item
    // (or different items) — allocate stock per item so one popular item
    // can't be oversold across many buyers in this single pass.
    const byItem = new Map<number, Shortfall[]>();
    for (const sf of shortfalls) {
      const list = byItem.get(sf.itemId) ?? [];
      list.push(sf);
      byItem.set(sf.itemId, list);
    }

    for (const [itemId, sfs] of byItem) {
      const listing = store.find((prod) => prod.id === itemId);
      if (!listing) continue;
      const docItem = full.items.find((it) => it.id === itemId);
      // Cap at the MIN of what the storefront claims and what's actually
      // owned in the doc — the same drift guard the manual-order path needs.
      const actuallyOwned = docItem?.owners[sellerId] ?? 0;
      let remainingStock = Math.min(listing.available, actuallyOwned);
      if (remainingStock <= 0) continue;
      const price = listing.price;
      if (!(price > 0)) continue;

      for (const sf of sfs) {
        if (remainingStock <= 0) break;
        const buyerPv = pvById.get(sf.buyerId);
        if (!buyerPv) continue;
        const affordable = Math.floor(buyerPv.cash / price);
        const qty = Math.max(0, Math.min(sf.qty, remainingStock, affordable));
        if (qty <= 0) continue;
        const cost = qty * price;

        // Apply to the buyer's own player-view — flows into production.ts's
        // existing fold-back + persistence automatically, no extra plumbing.
        buyerPv.cash -= cost;
        const buyerItem = buyerPv.items.find((it) => it.id === itemId);
        if (buyerItem) {
          buyerItem.owners.YOU = (buyerItem.owners.YOU ?? 0) + qty;
        }

        // Apply to the seller: mutate their OWN player-view directly if
        // they're also a producer this tick (same auto-fold as the buyer);
        // otherwise accumulate a standalone patch for the caller to apply,
        // and reflect the depletion on the shared doc directly (their
        // holdings only live there this tick, with no per-player fold-back).
        const sellerPv = pvById.get(sellerId);
        if (sellerPv) {
          sellerPv.cash += cost;
          sellerPv.producedQty[itemId] = Math.max(0, (sellerPv.producedQty[itemId] ?? 0) - qty);
          const sellerItem = sellerPv.items.find((it) => it.id === itemId);
          if (sellerItem) {
            const left = (sellerItem.owners.YOU ?? 0) - qty;
            if (left > 0) sellerItem.owners.YOU = left;
            else delete sellerItem.owners.YOU;
          }
        } else {
          const patch = sellerPatches.get(sellerId) ?? { cashDelta: 0, producedDelta: {} };
          patch.cashDelta += cost;
          patch.producedDelta[itemId] = (patch.producedDelta[itemId] ?? 0) - qty;
          sellerPatches.set(sellerId, patch);
          if (docItem) {
            const left = (docItem.owners[sellerId] ?? 0) - qty;
            if (left > 0) docItem.owners[sellerId] = left;
            else delete docItem.owners[sellerId];
          }
        }

        remainingStock -= qty;
        fills.push({ buyerId: sf.buyerId, lineId: sf.lineId, itemId, sellerId, qty, unitPrice: price, cost });
      }
    }
  }

  return { fills, sellerPatches };
}
