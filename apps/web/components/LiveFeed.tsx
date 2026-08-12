"use client";

import { useEffect, useRef, useState } from "react";
import { useTrove } from "@/lib/trove";

const SHOWN = 8;

/** "While you were reading this pitch, here's what just happened" — real
 *  floor activity (traderAct's sold/acquired, named AI-to-AI trades),
 *  already generated server-side every 15min-6h, never shown anywhere
 *  before. Pulses the newest row when it changes on the next poll, so the
 *  feed reads as continuously alive rather than a static list. */
export function LiveFeed() {
  const { state } = useTrove();
  const entries = state.log.slice(0, SHOWN);
  const topKey = entries[0] ? `${entries[0].who}|${entries[0].verb}|${entries[0].it}` : null;
  const [pulse, setPulse] = useState(false);
  const prevTop = useRef<string | null>(null);

  useEffect(() => {
    const isFirstSighting = prevTop.current === null;
    const changed = topKey !== prevTop.current;
    prevTop.current = topKey;
    if (isFirstSighting || !changed) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1400);
    return () => clearTimeout(t);
  }, [topKey]);

  if (entries.length === 0) return null;

  return (
    <section className="landing-section landing-feed">
      <div className="landing-feed-h">
        <span className="landing-section-h" style={{ marginBottom: 0 }}>
          Live on the floor
        </span>
        <span className="landing-feed-live">
          <i /> live
        </span>
      </div>
      <div className="feed-list">
        {entries.map((e, i) => (
          <div
            className={`feed-row ${e.verb === "sold" ? "dn" : "up"} ${i === 0 && pulse ? "fresh" : ""}`}
            key={i}
          >
            <i className="feed-dot" />
            <span>
              <b>{e.who}</b> {e.verb} {e.it}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
