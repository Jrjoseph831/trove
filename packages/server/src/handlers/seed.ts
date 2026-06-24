/**
 * Seed Lambda — creates the Live world once. Safe to invoke repeatedly: it only
 * writes if the world does not yet exist. Wired as a custom-resource on first
 * deploy and also invocable by hand from the console.
 */
import { loadWorld, seedWorld } from "../repo";

export async function handler(): Promise<{ seeded: boolean; cycle: number }> {
  const existing = await loadWorld();
  if (existing) {
    console.log(`world already seeded at cycle ${existing.cycle}`);
    return { seeded: false, cycle: existing.cycle };
  }
  const doc = await seedWorld();
  console.log(`seeded Live world at cycle ${doc.cycle}`);
  return { seeded: true, cycle: doc.cycle };
}
