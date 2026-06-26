"use client";

import { useEffect, useRef, useState } from "react";
import { netWorth } from "@trove/engine";
import { useTrove } from "@/lib/trove";
import { LADDER, bumpPeak, tierIndexFor } from "@/lib/ladder";

const SEEN_KEY = "trove.ladder.seen";

/** Fires the celebrated "rank up" moment when peak net worth crosses a tier
 *  during the session. On first load it just syncs the baseline (no surprise
 *  popup on refresh) — only live climbs trigger the flash. */
export function LadderUp() {
  const { state, signedIn } = useTrove();
  const nw = netWorth(state, "YOU");
  const [show, setShow] = useState<number | null>(null);
  const synced = useRef(false);

  useEffect(() => {
    if (!signedIn || typeof window === "undefined") return;
    const peak = bumpPeak(nw);
    const idx = tierIndexFor(peak);
    if (!synced.current) {
      synced.current = true;
      window.localStorage.setItem(SEEN_KEY, String(idx));
      return;
    }
    const seen = Number(window.localStorage.getItem(SEEN_KEY) ?? "0");
    if (idx > seen) {
      window.localStorage.setItem(SEEN_KEY, String(idx));
      setShow(idx);
    }
  }, [nw, signedIn]);

  useEffect(() => {
    if (show == null) return;
    const t = setTimeout(() => setShow(null), 4600);
    return () => clearTimeout(t);
  }, [show]);

  if (show == null) return null;
  const tier = LADDER[show]!;
  return (
    <div className="lu-wrap" aria-live="polite" onClick={() => setShow(null)}>
      <div className="lu-card">
        <div className="lu-kick">▲ Rank up</div>
        <div className="lu-name">{tier.name}</div>
        <div className="lu-unlock">
          Unlocked · <b>{tier.unlock}</b>
        </div>
      </div>
    </div>
  );
}
