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

/**
 * One unified standings board: YOU + the AI houses + every other real holding.
 *
 * In LIVE this is the server's ranking verbatim, because the server is the only
 * place that can rank anything correctly. The board used to be stitched from
 * three sources — your own row computed on the client, the AI houses computed
 * from the client's own drifting copy of them, and other players from
 * /standings — so two accounts looking at the SAME world disagreed about it:
 * your firm was scored from your browser while everyone else saw the server's
 * figure for you, and each client had privately simulated the AI houses
 * somewhere different. (/world syncs prices, never trader treasuries.)
 *
 * `serverNet` is the server's valuation of YOUR firm, used only to place you
 * when you rank below the window /standings returns, or are too new to rank.
 */
export function useLeaderboard(
  state: WorldState,
  mode: "live" | "sandbox",
  myLabel: string,
  serverNet?: number | null,
): BoardRow[] {
  const [rows, setRows] = useState<ApiStanding[]>([]);

  useEffect(() => {
    if (mode !== "live") {
      setRows([]);
      return;
    }
    let alive = true;
    fetchStandings()
      .then((s) => alive && setRows(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // refresh as the world advances
  }, [mode, state.cycle]);

  const me = myShortId();

  if (mode === "live") {
    const board = rows.map((r) => ({
      id: r.id === me ? "YOU" : r.isAI ? r.handle : `p:${r.id}`,
      label: r.id === me ? myLabel : r.handle,
      w: r.net,
      live: !r.isAI,
    }));
    // Ranked below the window the server returns, or too new to appear at all —
    // still show your own row rather than dropping you off your own board.
    if (me && !board.some((b) => b.id === "YOU")) {
      board.push({
        id: "YOU",
        label: myLabel,
        w: serverNet ?? netWorth(state, "YOU"),
        live: true,
      });
    }
    return board.sort((a, b) => b.w - a.w).map((e, i) => ({ ...e, rank: i + 1 }));
  }

  // Sandbox is a private world with no server behind it, so the local engine IS
  // the truth there — and every client running one sees only its own.
  return [
    { id: "YOU", label: myLabel, w: netWorth(state, "YOU"), live: true },
    ...state.traders.map((t) => ({
      id: t.name,
      label: t.name,
      w: netWorth(state, t.name),
      live: false,
    })),
  ]
    .sort((a, b) => b.w - a.w)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
