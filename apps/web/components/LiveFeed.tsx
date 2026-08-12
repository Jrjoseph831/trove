"use client";

import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@trove/engine";
import { useTrove } from "@/lib/trove";

const WINDOW = 9; // rows on screen at once
const STREAM_MS = 1500; // pace one new row arrives

/** The floor, streaming. Every row is a real event the world actually
 *  produced (production credits, trades, named company-to-company deals) —
 *  but the underlying log only refreshes when the server ticks, so simply
 *  rendering it renders a static list. This walks that log continuously
 *  instead, pushing one real event onto the top every beat, so the screen
 *  reads the way the world actually behaves: something is always happening.
 *  No fabricated events and no fake timestamps — just paced reveal of real
 *  activity, and genuinely new events fold in as soon as they arrive. */
export function LiveFeed() {
  const { state } = useTrove();
  const source = state.log;
  const [rows, setRows] = useState<LogEntry[]>([]);
  const cursor = useRef(0);

  // Seed as soon as there's data (and reseed if the world's log is replaced
  // wholesale, e.g. the very first poll landing after an empty initial state).
  useEffect(() => {
    if (source.length === 0) return;
    setRows((cur) => (cur.length > 0 ? cur : source.slice(0, WINDOW)));
    cursor.current = Math.min(WINDOW, source.length);
  }, [source]);

  useEffect(() => {
    if (source.length === 0) return;
    const t = setInterval(() => {
      const next = source[cursor.current % source.length];
      cursor.current += 1;
      if (!next) return;
      setRows((cur) => [next, ...cur].slice(0, WINDOW));
    }, STREAM_MS);
    return () => clearInterval(t);
  }, [source]);

  if (rows.length === 0) return null;

  return (
    <div className="feed-list">
      {rows.map((e, i) => (
        <div
          className={`feed-row ${e.verb === "sold" ? "dn" : "up"} ${i === 0 ? "entering" : ""}`}
          // Index-free key so React animates the SHIFT rather than reusing
          // row 0's DOM node for whatever text just replaced it.
          key={`${e.who}|${e.verb}|${e.it}|${rows.length - i}`}
          style={{ opacity: Math.max(0.22, 1 - i * 0.085) }}
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
