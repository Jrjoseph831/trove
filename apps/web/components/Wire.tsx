"use client";

import { useMemo, useState } from "react";
import { Radio } from "lucide-react";
import { news as newsBank } from "@trove/data";
import { netWorth } from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";
import { Broadcast, type WireStory } from "./Broadcast";
import { SectorBars } from "./SectorBars";
import { Studio } from "./Studio";

export function Wire() {
  const { state } = useTrove();
  const [studioOpen, setStudioOpen] = useState(false);

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

  const broadcast = stories.slice(0, 6);
  const upNext = broadcast.slice(1);
  const cards = stories.slice(1, 9);
  const tape = cards.length ? cards : stories;

  const board = [
    { name: "YOU", w: netWorth(state, "YOU") },
    ...state.traders.map((t) => ({ name: t.name, w: netWorth(state, t.name) })),
  ].sort((a, b) => b.w - a.w);

  return (
    <div className="view wire">
      <div className="tnn-head-bar">
        <span className="tnn-logo">
          TNN <em>Trove News Network</em>
        </span>
        <div className="tnn-head-right">
          <button className="watch-btn" onClick={() => setStudioOpen(true)}>
            <Radio size={14} /> Watch the broadcast
          </button>
          <span className="tnn-on">On Air</span>
        </div>
      </div>

      {state.front && (
        <div className="breaking">
          <span className="breaking-lab">Breaking</span>
          <div className="breaking-run">
            <span>{state.front.head}</span>
          </div>
        </div>
      )}

      <div className="tnn-grid">
        <Broadcast stories={broadcast} />

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
            <div className="tnn-panel-h">Sector Demand</div>
            <SectorBars />
          </div>

          <div className="tnn-panel">
            <div className="tnn-panel-h">Leaderboard</div>
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

      {studioOpen && <Studio onClose={() => setStudioOpen(false)} />}
    </div>
  );
}
