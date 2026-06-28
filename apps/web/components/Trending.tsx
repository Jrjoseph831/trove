"use client";

import { useEffect, useState } from "react";
import { breakingBeat } from "@/lib/breaking";
import { money } from "@/lib/format";
import { impliedSectors } from "@/lib/ui";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { useTrove } from "@/lib/trove";
import { Movers } from "./Movers";
import { Tile } from "./Tile";

export function Trending() {
  const { state, desk, mode } = useTrove();
  const f = state.front;
  const { ups, dns } = impliedSectors(f);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const beat = breakingBeat(now);

  const watching = state.items
    .filter((i) => i.edition !== null && i.remaining > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  // Standings beside the headline — competitive context (observable), not a
  // give-away sector readout. Top firms + you.
  const myLabel = desk?.name?.trim() || "Your Holding";
  const ranked = useLeaderboard(state, mode, myLabel);
  const standTop = ranked.slice(0, 9);
  const meRow = ranked.find((e) => e.id === "YOU");
  const standings =
    standTop.some((e) => e.id === "YOU") || !meRow ? standTop : [...standTop, meRow];

  return (
    <div className="view trend">
      <div className="bento">
        {beat && (
          <article className={`brk-card col-12 ${beat.phase}`}>
            <span className="brk-card-kick">⚡ {beat.kicker}</span>
            <h3 className="brk-card-head">{beat.head}</h3>
            <p className="brk-card-body">{beat.body}</p>
          </article>
        )}

        <article className="lead col-8">
          {f && (
            <>
              <div className="paper">
                <span className="name">The Trove Wire</span>
                <span className="edition">No. {1000 + state.cycle} · evening edition</span>
              </div>
              <div className="kick">{f.kick}</div>
              <h1>{f.head}</h1>
              <p>{f.body}</p>
              <div className="implied">
                On the market:{" "}
                {ups.length === 0 && dns.length === 0 ? (
                  "A quiet session. Prices drift on their own."
                ) : (
                  <>
                    {ups.length > 0 && (
                      <>
                        <b>{ups.join(", ")}</b> in focus
                      </>
                    )}
                    {ups.length > 0 && dns.length > 0 && " · "}
                    {dns.length > 0 && (
                      <>
                        pressure on <b>{dns.join(", ")}</b>
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </article>

        <aside className="pulse col-4">
          <div className="pulse-h">
            Standings <span className="sub">top firms · net worth</span>
          </div>
          <div className="pulse-list">
            {standings.map((e) => (
              <div className={`stand-row ${e.id === "YOU" ? "me" : ""}`} key={e.id}>
                <span className="stand-rk">{e.rank}</span>
                <span className="stand-nm">
                  {e.live && e.id !== "YOU" && <span className="lb-live">●</span>}
                  {e.label}
                </span>
                <span className="stand-w">{money(e.w)}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className="col-12 trend-sec">
          <div className="bc-h">
            <span className="t">On the Move</span>
            <span className="why">biggest shifts since the page turned</span>
          </div>
          <Movers />
        </section>

        <section className="col-12 trend-sec">
          <div className="bc-h">
            <span className="t">Worth Watching</span>
            <span className="why">marquee pieces still on the market</span>
          </div>
          {watching.length ? (
            <div className="tiles">
              {watching.map((it) => (
                <Tile key={it.id} it={it} />
              ))}
            </div>
          ) : (
            <div className="empty">
              Every marquee piece has been claimed. Watch for a relisting.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
