"use client";

import { useEffect, useRef, useState } from "react";
import { useTrove } from "@/lib/trove";

const SHOWN = 10;

/** "While you were reading this pitch, here's what just happened" — real
 *  floor activity (production credits, trades, named AI-to-AI deals),
 *  already generated server-side, never shown anywhere before. Highlights
 *  the newest row when it actually changes on the next poll — a real
 *  signal, not a decorative pulse. */
export function LiveFeed() {
  const { state } = useTrove();
  const entries = state.log.slice(0, SHOWN);
  const topKey = entries[0] ? `${entries[0].who}|${entries[0].verb}|${entries[0].it}` : null;
  const [flash, setFlash] = useState(false);
  const prevTop = useRef<string | null>(null);

  useEffect(() => {
    const isFirstSighting = prevTop.current === null;
    const changed = topKey !== prevTop.current;
    prevTop.current = topKey;
    if (isFirstSighting || !changed) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [topKey]);

  if (entries.length === 0) return null;

  return (
    <div className="feed-list">
      {entries.map((e, i) => (
        <div
          className={`feed-row ${e.verb === "sold" ? "dn" : "up"} ${i === 0 && flash ? "fresh" : ""}`}
          key={i}
        >
          <i className="feed-dot" />
          <span>
            <b>{e.who}</b> {e.verb} {e.it}
          </span>
        </div>
      ))}
    </div>
  );
}
