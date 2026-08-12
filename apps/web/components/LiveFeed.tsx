"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "@trove/engine";
import { useTrove } from "@/lib/trove";

const WINDOW = 8; // rows on screen at once
const STREAM_MS = 1800; // pace one new row arrives

const sig = (log: LogEntry[]) =>
  log.length + "|" + log.map((e) => `${e.who}${e.verb}${e.it}`).join("");

/** The floor, streaming. Every row is a real event the SHARED world
 *  produced — the client's own warmed-up local world deliberately starts
 *  with an empty log (see liveWorld() in lib/trove.tsx), so nothing shows
 *  here until the server's /world response actually supplies activity.
 *
 *  The underlying log only refreshes when the server ticks, so rendering it
 *  straight gives a static wall. This walks it instead, promoting one real
 *  event to the top each beat, and re-seeds whenever the server's log
 *  genuinely changes so newly-settled activity flows in. */
export function LiveFeed() {
  const { state } = useTrove();
  // "YOU" is the engine's self-label and must never appear on a public feed
  // (a signed-out visitor has done nothing). The server strips these too;
  // this also covers already-stored entries from before that fix, without
  // waiting on a redeploy.
  //
  // Memoised on CONTENT, not array identity: state.log is replaced on every
  // 15s poll and filter() allocates fresh each render, so an unmemoised
  // value would re-create the streaming interval below on every render and
  // it would never survive long enough to tick.
  const rawSig = sig(state.log);
  const source = useMemo(() => {
    const seen = new Set<string>();
    return state.log.filter((e) => {
      if (e.who === "YOU") return false;
      // The stored log can hold the same event more than once (repeated
      // settlements of an identical listing sale, say). Duplicates read as
      // broken on a feed, so keep only the first of each.
      const k = `${e.who}|${e.verb}|${e.it}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSig]);
  const [rows, setRows] = useState<LogEntry[]>([]);
  const cursor = useRef(0);
  const lastSig = useRef("");

  // Re-seed whenever the server's log actually changes content — NOT just
  // when it was previously empty. Seeding once and holding was the bug that
  // pinned the feed to whatever it saw first and never showed real updates.
  useEffect(() => {
    const s = sig(source);
    if (s === lastSig.current) return;
    lastSig.current = s;
    if (source.length === 0) {
      setRows([]);
      cursor.current = 0;
      return;
    }
    setRows(source.slice(0, WINDOW));
    cursor.current = Math.min(WINDOW, source.length);
  }, [source]);

  useEffect(() => {
    if (source.length === 0) return;
    const t = setInterval(() => {
      setRows((cur) => {
        // Walk forward to the next event that ISN'T already on screen.
        // Without this the cursor re-promotes rows still in the window and
        // the feed stutters out the same line several times running, which
        // is the single most obvious "this is fake" tell. Bounded by one
        // full lap; if everything is already visible, leave it alone.
        const onScreen = new Set(cur.map((e) => `${e.who}|${e.verb}|${e.it}`));
        for (let i = 0; i < source.length; i++) {
          const cand = source[(cursor.current + i) % source.length]!;
          if (onScreen.has(`${cand.who}|${cand.verb}|${cand.it}`)) continue;
          cursor.current = (cursor.current + i + 1) % source.length;
          return [cand, ...cur].slice(0, WINDOW);
        }
        return cur;
      });
    }, STREAM_MS);
    return () => clearInterval(t);
  }, [source]);

  return (
    <div className="floorbox">
      <div className="floorbox-body">
        {rows.length === 0 ? (
          <div className="floorbox-empty">Listening to the floor…</div>
        ) : (
          rows.map((e, i) => (
            <div
              className={`feed-row ${e.verb === "sold" ? "dn" : "up"} ${i === 0 ? "entering" : ""}`}
              key={`${e.who}|${e.verb}|${e.it}|${rows.length - i}`}
            >
              <i className="feed-dot" />
              <span className="feed-txt">
                <b>{e.who}</b> {e.verb} {e.it}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
