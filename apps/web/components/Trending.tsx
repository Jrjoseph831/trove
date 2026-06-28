"use client";

import { useEffect, useState } from "react";
import { held } from "@trove/engine";
import { breakingBeat } from "@/lib/breaking";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
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

  const mine = state.items.filter((i) => held(i, "YOU") > 0);

  // Standings beside the headline — competitive context (observable), not a
  // give-away sector readout. Top firms + you.
  const myLabel = desk?.name?.trim() || "Your Holding";
  const ranked = useLeaderboard(state, mode, myLabel);
  const standTop = ranked.slice(0, 9);
  const meRow = ranked.find((e) => e.id === "YOU");
  const standings =
    standTop.some((e) => e.id === "YOU") || !meRow ? standTop : [...standTop, meRow];

  return (
    <div className="view">
      {beat && (
        <article className={`brk-card ${beat.phase}`}>
          <span className="brk-card-kick">⚡ {beat.kicker}</span>
          <h3 className="brk-card-head">{beat.head}</h3>
          <p className="brk-card-body">{beat.body}</p>
        </article>
      )}

      <div className="trend-hero">
        <article className="lead">
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

        <aside className="pulse">
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
      </div>

      <div className="railrow">
        <div className="railrow-h">
          <span className="t">On the Move</span>
          <span className="why">biggest shifts since the page turned</span>
        </div>
        <Movers />
      </div>

      <div className="railrow">
        <div className="railrow-h">
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
      </div>

      <div className="twoup">
        <div className="glasspanel">
          <div className="panel-h">
            Your Vault{" "}
            <span className="sub">{mine.length ? `${mine.length} holdings` : ""}</span>
          </div>
          {mine.length ? (
            mine.slice(0, 6).map((it) => {
              const q = held(it, "YOU");
              const pl = it.value - (it.buyAt ?? it.value);
              return (
                <div className="crow" key={it.id}>
                  <ItemIcon it={it} size={18} className="ic" />
                  <span className="nm">
                    <span className="bd">{it.brand}</span>
                    {it.name}
                    {q > 1 ? ` ×${q}` : ""}
                  </span>
                  <span className="pr">{money(it.value * q)}</span>
                  <span className={`chg ${pl >= 0 ? "pos" : "neg"}`}>
                    {pl >= 0 ? "+" : ""}
                    {money(pl)}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="empty">Empty. Read the page, then acquire something.</div>
          )}
        </div>

        <div className="glasspanel">
          <div className="panel-h">Market Activity</div>
          <div className="log">
            {state.log.length ? (
              state.log.slice(0, 9).map((l, i) => (
                <div key={i}>
                  <span className="who">{l.who}</span> {l.verb}{" "}
                  <span className="it">{l.it}</span>
                </div>
              ))
            ) : (
              <div className="empty">Quiet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
