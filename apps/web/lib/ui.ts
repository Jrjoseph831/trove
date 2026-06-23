import { sectorLabel } from "@trove/data";
import type { RuntimeItem, WorldState } from "@trove/engine";

/** Qualitative supply state for open items ("scarce" | "low" | null=normal). */
export function stockState(it: RuntimeItem): "scarce" | "low" | null {
  if (it.edition !== null) return null;
  if (it.stockNormal <= 0) return null;
  const r = it.stock / it.stockNormal;
  if (r < 0.25) return "scarce";
  if (r < 0.6) return "low";
  return null;
}

/** The sector an item leans into most (highest weight). */
export function primarySector(it: RuntimeItem): string {
  let best = "";
  let bw = -1;
  for (const s in it.weights) {
    const w = it.weights[s] ?? 0;
    if (w > bw) {
      bw = w;
      best = s;
    }
  }
  return best;
}

export function primarySectorLabel(it: RuntimeItem): string {
  return sectorLabel(primarySector(it));
}

/**
 * What the front story implies, as plain *reading* — names affected sectors,
 * never "buy X". Hidden effect magnitudes are never shown.
 */
export function impliedSectors(
  front: WorldState["front"],
): { ups: string[]; dns: string[] } {
  const ups: string[] = [];
  const dns: string[] = [];
  if (front?.effects) {
    for (const s in front.effects) {
      const v = front.effects[s] ?? 0;
      if (v > 0) ups.push(sectorLabel(s));
      else if (v < 0) dns.push(sectorLabel(s));
    }
  }
  return { ups, dns };
}

export interface Mover {
  it: RuntimeItem;
  dp: number;
}

/** Items sorted by absolute % move since the last cycle. */
export function moversByAbsMove(state: WorldState): Mover[] {
  return state.items
    .map((it) => ({
      it,
      dp: it.prevValue ? ((it.value - it.prevValue) / it.prevValue) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp));
}
