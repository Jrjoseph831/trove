/**
 * Reset Lambda — wipe the world back to opening day. DESTRUCTIVE AND FINAL.
 *
 * Overwrites the world document and deletes EVERY player record: cash, goods,
 * factories, properties, stakes, reputation, reports, websites, holding names.
 * There is no undo and no backup taken here — DynamoDB point-in-time recovery
 * on the tables is the only way back, and restoring it is a manual operation.
 *
 * Deliberately NOT wired to any HTTP route and not on a schedule. It is
 * invoked by hand, and it refuses unless the caller passes the exact
 * confirmation phrase, so nothing can trigger it by accident or by fat finger:
 *
 *   aws lambda invoke --function-name <ResetFn> \
 *     --payload '{"confirm":"RESET THE WORLD"}' --cli-binary-format raw-in-base64-out out.json
 *
 * Every player signs in to a world that has never seen them: no name, so the
 * onboarding gate fires and they choose one, exactly like first light.
 */
import { COMPANY_TIERS, companyRoster } from "@trove/data";
import { createWorld, wallCycle } from "@trove/engine";
import { allPlayers, deletePlayer, forceSeedWorld } from "../repo";

const PHRASE = "RESET THE WORLD";

/**
 * Opening treasuries, spread rather than identical. Every house starting on
 * exactly its tier's number makes the first hours read as a spreadsheet; a
 * spread means the board has a shape on day one and the early ordering isn't
 * the same in every world. Deterministic per name, so a reset is reproducible.
 */
function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

export async function handler(event: {
  confirm?: string;
}): Promise<{ ok: boolean; players?: number; firms?: number; error?: string }> {
  if (event?.confirm !== PHRASE) {
    return {
      ok: false,
      error: `refusing: pass {"confirm":"${PHRASE}"} to run this. It deletes every player.`,
    };
  }

  // 1. A brand-new world, with the AI roster spread across a plausible range
  //    of opening treasuries instead of all starting on the same number.
  const state = createWorld();
  state.cycle = wallCycle();
  const tierOf = new Map(companyRoster.map((c) => [c.name, c.tier]));
  for (const t of state.traders) {
    const tier = tierOf.get(t.name) ?? t.tier ?? "mid";
    const base = COMPANY_TIERS[tier].cash;
    // 0.45x to 2.2x of the tier's figure — a boutique can be scrappy or
    // unusually well funded, and a titan is never quite where you left it.
    const spread = 0.45 + hash01(`${t.name}:open`) * 1.75;
    t.cash = Math.round(base * spread);
    t.tier = tier;
    t.income = COMPANY_TIERS[tier].income;
  }

  const doc = await forceSeedWorld(state);

  // 2. Every player record goes. No name means the onboarding gate fires on
  //    their next sign-in and they choose a holding name from scratch.
  const players = await allPlayers();
  for (const p of players) await deletePlayer(p.playerId);

  console.warn(
    `WORLD RESET: wiped ${players.length} player record(s); ` +
      `${state.traders.length} firms reopened at cycle ${doc.cycle}`,
  );
  return { ok: true, players: players.length, firms: state.traders.length };
}
