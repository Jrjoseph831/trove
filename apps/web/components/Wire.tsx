"use client";

import { news as newsBank } from "@trove/data";
import { netWorth } from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";
import { SectorBars } from "./SectorBars";

export function Wire() {
  const { state } = useTrove();

  const feed = (
    state.front
      ? [
          state.front,
          ...state.archive
            .slice(0, 8)
            .map((a) => newsBank.find((n) => n.head === a.head) ?? a),
        ]
      : state.archive
  )
    .filter(Boolean)
    .slice(0, 9);

  const board = [
    { name: "YOU", w: netWorth(state, "YOU") },
    ...state.traders.map((t) => ({ name: t.name, w: netWorth(state, t.name) })),
  ].sort((a, b) => b.w - a.w);

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">The Wire</h2>
      </div>
      <div className="wire-grid">
        <div className="wire-archive">
          {feed.map((n, i) => {
            const kick = "kick" in n ? n.kick : "Markets";
            const body = "body" in n ? n.body : undefined;
            return (
              <div className="a" key={i}>
                <div className="kick">
                  {kick}
                  {i === 0 ? " · current" : ""}
                </div>
                <h4>{n.head}</h4>
                {body && <p>{body}</p>}
              </div>
            );
          })}
        </div>
        <div className="stack">
          <div className="glasspanel">
            <div className="panel-h">Sector Demand</div>
            <SectorBars />
          </div>
          <div className="glasspanel">
            <div className="panel-h">Leaderboard</div>
            {board.map((e, i) => (
              <div className={`lb ${e.name === "YOU" ? "me" : ""}`} key={e.name}>
                <span>
                  <span className="rk">{i + 1}</span>
                  {e.name}
                </span>
                <span>{money(e.w)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
