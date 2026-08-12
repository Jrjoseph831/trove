"use client";

import { useEffect, useRef, useState } from "react";
import { useTrove } from "@/lib/trove";

const SHOWN = 10;
const REVEAL_MS = 380; // pace between rows cascading in

/** "While you were reading this pitch, here's what just happened" — real
 *  floor activity (production credits, trades, named AI-to-AI deals),
 *  already generated server-side, never shown anywhere before. Highlights
 *  the newest row when it actually changes on the next poll — a real
 *  signal, not a decorative pulse — and cascades the rows in one at a time
 *  whenever this screen scrolls into view, instead of dumping the whole
 *  list at once, so it reads as things actively happening. */
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

  const [revealed, setRevealed] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setRevealed(0); // restart the cascade each time it scrolls into view
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (revealed >= entries.length) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed, entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="feed-list" ref={rootRef}>
      {entries.map((e, i) => (
        <div
          className={`feed-row ${e.verb === "sold" ? "dn" : "up"} ${i === 0 && flash ? "fresh" : ""} ${
            i < revealed ? "shown" : ""
          }`}
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
