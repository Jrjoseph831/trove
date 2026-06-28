import { useEffect, useState } from "react";
import { netWorth, type WorldState } from "@trove/engine";
import { fetchStandings, type ApiStanding } from "./api";
import { myShortId } from "./auth";

export interface BoardRow {
  id: string;
  label: string;
  w: number;
  live: boolean; // a real player's firm
  rank: number;
}

/** One unified standings board: YOU + the AI firms + (in live mode) every other
 *  real player, ranked by net worth. Live players are pulled from /standings and
 *  merged in so the board shows all firms together, live or not. */
export function useLeaderboard(
  state: WorldState,
  mode: "live" | "sandbox",
  myLabel: string,
): BoardRow[] {
  const [players, setPlayers] = useState<ApiStanding[]>([]);

  useEffect(() => {
    if (mode !== "live") {
      setPlayers([]);
      return;
    }
    let alive = true;
    fetchStandings()
      .then((s) => alive && setPlayers(s.filter((x) => !x.isAI)))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // refresh as the world advances
  }, [mode, state.cycle]);

  const me = myShortId();
  return [
    { id: "YOU", label: myLabel, w: netWorth(state, "YOU"), live: true },
    ...state.traders.map((t) => ({
      id: t.name,
      label: t.name,
      w: netWorth(state, t.name),
      live: false,
    })),
    ...players
      .filter((p) => p.id !== me)
      .map((p) => ({ id: `p:${p.id}`, label: p.handle, w: p.net, live: true })),
  ]
    .sort((a, b) => b.w - a.w)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
