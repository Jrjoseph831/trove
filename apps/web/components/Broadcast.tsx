"use client";

import { useEffect, useState } from "react";
import { useTrove } from "@/lib/trove";

export interface WireStory {
  kick: string;
  head: string;
  body?: string;
  current?: boolean;
}

/**
 * The "TNN" broadcast screen — a faux live-news segment. Auto-advances through
 * the rundown with a crossfade, a sliding chyron lower-third, a pulsing LIVE
 * badge, and a slow Ken-Burns backdrop. Always rendered on a dark "screen"
 * regardless of app theme (it's the monitor). Respects reduced-motion via CSS.
 */
const ADVANCE_MS = 6000;

export function Broadcast({ stories }: { stories: WireStory[] }) {
  const { state } = useTrove();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [stories]);

  useEffect(() => {
    if (stories.length < 2) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % stories.length),
      ADVANCE_MS,
    );
    return () => clearInterval(t);
  }, [stories.length]);

  if (!stories.length) {
    return (
      <div className="tnn-screen">
        <div className="tnn-bg" />
      </div>
    );
  }

  const cur = idx % stories.length;
  const s = stories[cur]!;
  const nowUtc = new Date();
  const clock = `${String(nowUtc.getUTCHours()).padStart(2, "0")}:${String(
    nowUtc.getUTCMinutes(),
  ).padStart(2, "0")}`;

  return (
    <div className="tnn-screen">
      <div className="tnn-bg" key={`bg-${cur}`} />
      <div className="tnn-ghost" key={`g-${cur}`}>
        {s.kick}
      </div>

      <div className="tnn-top">
        <span className="tnn-live">
          <i /> LIVE
        </span>
        <span className="tnn-clock">
          TNN · No. {1000 + state.cycle} · {clock}
        </span>
      </div>

      <div className="tnn-lower" key={`l-${cur}`}>
        <span className="tnn-kick">{s.kick}</span>
        <h3 className="tnn-head">{s.head}</h3>
        {s.body && <p className="tnn-body">{s.body}</p>}
      </div>

      <div className="tnn-dots">
        {stories.map((st, i) => (
          <i key={st.head + i} className={i === cur ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}
