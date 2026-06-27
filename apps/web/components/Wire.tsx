"use client";

import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import { news as newsBank } from "@trove/data";
import { netWorth } from "@trove/engine";
import { breakingBeat } from "@/lib/breaking";
import { money } from "@/lib/format";
import { tnnLive } from "@/lib/ui";
import { useTrove } from "@/lib/trove";
import type { WireStory } from "./Broadcast";
import { Newsreel, Wheel } from "./Newsreel";

export function Wire() {
  const { state, desk } = useTrove();
  const [studioOpen, setStudioOpen] = useState(false);
  // The telegraphed market-event Breaking beat — refreshed on its own clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const beat = breakingBeat(now);

  // Build the rundown once per cycle (front + recent archive, with bodies).
  const stories = useMemo<WireStory[]>(() => {
    const out: WireStory[] = [];
    if (state.front) {
      out.push({
        kick: state.front.kick,
        head: state.front.head,
        body: state.front.body,
        current: true,
      });
    }
    for (const a of state.archive) {
      if (state.front && a.head === state.front.head) continue;
      const n = newsBank.find((x) => x.head === a.head);
      out.push({ kick: a.kick, head: a.head, body: n?.body });
      if (out.length >= 9) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.cycle]);

  const live = tnnLive(state);
  const upNext = stories.slice(1, 6);
  const cards = stories.slice(1, 9);
  const tape = cards.length ? cards : stories;

  // The player's own row shows their Holding name (not "YOU"); the internal id
  // stays "YOU" for the net-worth lookup and the highlight.
  const myLabel = desk?.name?.trim() || "Your Holding";
  const board = [
    { id: "YOU", label: myLabel, w: netWorth(state, "YOU") },
    ...state.traders.map((t) => ({ id: t.name, label: t.name, w: netWorth(state, t.name) })),
  ].sort((a, b) => b.w - a.w);

  return (
    <div className="view wire">
      <div className="tnn-head-bar">
        <span className="tnn-logo">
          TNN <em>Trove News Network</em>
        </span>
        <div className="tnn-head-right">
          <button className="watch-btn" onClick={() => setStudioOpen(true)}>
            <Radio size={14} /> Watch the news wheel
          </button>
          <span className={`tnn-on ${live ? "live" : "offpeak"}`}>
            {live ? "Live now" : "Off-peak"}
          </span>
        </div>
      </div>

      {beat && (
        <article className={`brk-card ${beat.phase}`}>
          <span className="brk-card-kick">⚡ {beat.kicker}</span>
          <h3 className="brk-card-head">{beat.head}</h3>
          <p className="brk-card-body">{beat.body}</p>
        </article>
      )}

      {state.front && (
        <div className="breaking">
          <span className="breaking-lab">Breaking</span>
          <div className="breaking-run">
            <span>{state.front.head}</span>
          </div>
        </div>
      )}

      <div className="tnn-grid">
        <Wheel embedded mode={live ? "news" : "filler"} />

        <aside className="tnn-rail">
          <div className="tnn-panel">
            <div className="tnn-panel-h">Up Next</div>
            {upNext.length ? (
              upNext.map((s, i) => (
                <div className="upnext" key={s.head + i}>
                  <span className="upnext-kick">{s.kick}</span>
                  <span className="upnext-head">{s.head}</span>
                </div>
              ))
            ) : (
              <div className="empty">Quiet on the wire.</div>
            )}
          </div>

          <div className="tnn-panel">
            <div className="tnn-panel-h">Leaderboard</div>
            {board.map((e, i) => (
              <div className={`lb ${e.id === "YOU" ? "me" : ""}`} key={e.id}>
                <span>
                  <span className="rk">{i + 1}</span>
                  {e.label}
                </span>
                <span>{money(e.w)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="tnn-tape">
        <div className="tnn-tape-run">
          {[...tape, ...tape].map((s, i) => (
            <span key={i}>
              <b>{s.kick}</b>
              {s.head}
            </span>
          ))}
        </div>
      </div>

      <div className="wire-more">
        <div className="railrow-h">
          <span className="t">More from the Wire</span>
          <span className="why">today&apos;s rundown</span>
        </div>
        <div className="wire-cards">
          {cards.map((s, i) => (
            <article className="wcard" key={s.head + i}>
              <div className="wcard-kick">{s.kick}</div>
              <h4>{s.head}</h4>
              {s.body && <p>{s.body}</p>}
            </article>
          ))}
        </div>
      </div>

      {studioOpen && <Newsreel onClose={() => setStudioOpen(false)} />}
    </div>
  );
}
