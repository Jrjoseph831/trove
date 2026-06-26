import { floorBays, type WorldState } from "@trove/engine";
import { primarySector } from "@/lib/ui";

/** Phase 2 — Goals/Achievements. Concrete objectives that give a run direction
 *  and a dopamine pop when earned. All checks derive from live state, so they
 *  light up the moment the condition is true. */
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  done: (s: WorldState) => boolean;
}

const heldYou = (it: { owners: Record<string, number> }) =>
  (it.owners["YOU"] ?? 0) > 0;

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-line",
    name: "First Line",
    desc: "Build a production line.",
    done: (s) => (s.factories?.length ?? 0) >= 1,
  },
  {
    id: "engineer",
    name: "Engineer",
    desc: "Install a module on a line.",
    done: (s) => s.factories.some((f) => f.modules.length > 0),
  },
  {
    id: "loaded",
    name: "Fully Loaded",
    desc: "Run a line with 4 or more modules.",
    done: (s) => s.factories.some((f) => f.modules.length >= 4),
  },
  {
    id: "break-ground",
    name: "Break Ground",
    desc: "Expand the floor past one dock.",
    done: (s) => floorBays(s.floorSlots) > 1,
  },
  {
    id: "diversified",
    name: "Diversified",
    desc: "Produce in two different industries.",
    done: (s) =>
      new Set(
        s.factories
          .map((f) => {
            const it = s.items.find((x) => x.id === f.itemId);
            return it ? primarySector(it) : "";
          })
          .filter(Boolean),
      ).size >= 2,
  },
  {
    id: "vertical",
    name: "Vertical Integration",
    desc: "Feed a line from your own line.",
    done: (s) =>
      s.factories.some((f) => !!f.sources && Object.keys(f.sources).length > 0),
  },
  {
    id: "quality",
    name: "Quality Control",
    desc: "Run QC — a QC module or the QC Hub.",
    done: (s) =>
      Boolean(s.infra?.qc) || s.factories.some((f) => f.modules.includes("qc")),
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    desc: "Install a floor-wide upgrade.",
    done: (s) => Boolean(s.infra?.power || s.infra?.router || s.infra?.qc),
  },
  {
    id: "collector",
    name: "Collector",
    desc: "Own a numbered edition piece.",
    done: (s) => s.items.some((it) => it.edition !== null && heldYou(it)),
  },
  {
    id: "stocked",
    name: "Well Stocked",
    desc: "Hold 12 different products at once.",
    done: (s) => s.items.filter(heldYou).length >= 12,
  },
];

export function completedIds(s: WorldState): string[] {
  return ACHIEVEMENTS.filter((a) => a.done(s)).map((a) => a.id);
}
export function goalsProgress(s: WorldState): { done: number; total: number } {
  return { done: completedIds(s).length, total: ACHIEVEMENTS.length };
}
