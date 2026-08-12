/**
 * The PUBLIC view of the world — what anonymous browsers are allowed to see.
 *
 * Deliberately omits the hidden signal: `sectorIdx` (sector demand) and news
 * `effects` never leave the server. Players observe prices and headlines moving
 * and infer the rest. This is the "infer, don't be told" rule from spec 04.
 */
import type { WorldDoc } from "./repo";

export interface PublicItem {
  id: number;
  value: number;
  prevValue: number;
  stock: number;
  /** null = open commodity; a number = copies still claimable. */
  remaining: number | null;
}

export interface PublicFront {
  kick: string;
  head: string;
  body: string;
  cycle: number;
}

/** One AI house, valued the way the server values it. Cash and holdings live
 *  only in the world doc, so a client that tried to price a firm itself was
 *  guessing off a copy it had been drifting since page load. */
export interface PublicTrader {
  name: string;
  /** cash + the market value of everything it holds. */
  value: number;
}

export interface PublicWorld {
  cycle: number;
  items: PublicItem[];
  /** Every AI house and what it is worth RIGHT NOW. */
  traders: PublicTrader[];
  front: PublicFront | null;
  archive: WorldDoc["archive"];
  /** Recent floor activity ("X sold Y", "X bought Y from Z") — already
   *  generated server-side (traderAct, named AI-to-AI trades), just never
   *  exposed to a client before. No hidden signal in it (who/verb/it are
   *  all already-public actions), safe for the anonymous read path. */
  log: WorldDoc["log"];
}

export function publicView(doc: WorldDoc): PublicWorld {
  // Every owner's holdings summed in ONE pass, rather than re-scanning the
  // catalog once per company.
  const assets: Record<string, number> = {};
  for (const it of doc.items) {
    for (const [owner, qty] of Object.entries(it.owners ?? {})) {
      assets[owner] = (assets[owner] ?? 0) + qty * it.value;
    }
  }
  return {
    cycle: doc.cycle,
    // Valuations, not treasuries. What a firm is worth is already public — it's
    // what the Deal Room charges for a stake — and the client cannot derive it,
    // because it never sees who owns what. Sending the total only also keeps
    // the hidden signal hidden.
    traders: (doc.traders ?? []).map((t) => ({
      name: t.name,
      value: Math.round(t.cash + (assets[t.name] ?? 0)),
    })),
    items: doc.items.map((si) => ({
      id: si.id,
      value: si.value,
      prevValue: si.prevValue,
      stock: si.stock,
      remaining: si.remaining,
    })),
    front: doc.front
      ? {
          kick: doc.front.kick,
          head: doc.front.head,
          body: doc.front.body,
          cycle: doc.front.cycle,
        }
      : null,
    archive: doc.archive,
    // "YOU" is the engine's SELF label — only meaningful inside one player's
    // own client, never in the shared world. A now-fixed aliasing bug let it
    // reach the stored doc, and those entries persist there until the 30-cap
    // rotates them out, so strip them on the way out too: the public feed
    // must never show a visitor an action attributed to themselves.
    log: (doc.log ?? []).filter((e) => e.who !== "YOU"),
  };
}
