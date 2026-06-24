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

export interface PublicWorld {
  cycle: number;
  items: PublicItem[];
  front: PublicFront | null;
  archive: WorldDoc["archive"];
}

export function publicView(doc: WorldDoc): PublicWorld {
  return {
    cycle: doc.cycle,
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
  };
}
