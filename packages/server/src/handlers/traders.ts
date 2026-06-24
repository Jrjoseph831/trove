/**
 * AI-trader Lambda (Stage B) — keeps the floor alive between human trades.
 *
 * Runs on a short EventBridge schedule. Each invocation fires a small batch of
 * trader actions using the engine's `traderAct` UNCHANGED — traders read the
 * hidden sector index, never the news text, exactly as in the prototype. Their
 * cash/holdings live in the world doc (state.traders + item.owners[name]), so a
 * single optimistic-locked write persists the batch.
 */
import { rand, traderAct } from "@trove/engine";
import { mutateWorld } from "../repo";

const ACTIONS_PER_RUN = Number(process.env.TRADER_ACTIONS ?? 6);

export async function handler(): Promise<{ actions: number; cycle: number }> {
  let actions = 0;
  const doc = await mutateWorld((state) => {
    if (!state.traders.length) return;
    for (let i = 0; i < ACTIONS_PER_RUN; i++) {
      const t = state.traders[Math.floor(rand() * state.traders.length)]!;
      traderAct(state, t);
      actions++;
    }
  });
  console.log(`traders fired ${actions} action(s) at cycle ${doc.cycle}`);
  return { actions, cycle: doc.cycle };
}
