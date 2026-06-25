"use client";

import { useEffect, useMemo, useState } from "react";
import { money, pctChange, signedPct } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { primarySectorLabel } from "@/lib/ui";
import { useSnapshot } from "@/lib/useSnapshot";
import { useTrove } from "@/lib/trove";

/**
 * "On the Move" — a calm news-segment treatment instead of spammy reordering
 * tiles. The set is locked each cycle (no jumping); one mover is spotlighted
 * and auto-advances on a slow timer with a crossfade. Prices are a periodic
 * SNAPSHOT (not live), so the numbers hold steady instead of flickering.
 */
const ADVANCE_MS = 5000;
const SNAP_MS = 8000;

export function Movers() {
  const { state, buy } = useTrove();

  // Lock the set per cycle: re-pick only when the front page turns.
  const top = useMemo(
    () =>
      [...state.items]
        .map((it) => ({ it, dp: pctChange(it.value, it.prevValue) }))
        .filter((m) => m.it.edition === null || m.it.remaining > 0)
        .sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp))
        .slice(0, 6)
        .map((m) => m.it),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, state.cycle],
  );

  // Freeze the displayed prices/moves to a slow snapshot (refreshed on the cycle
  // turn too) so they don't tick every render.
  const frozen = useSnapshot(
    () => top.map((it) => ({ it, value: it.value, dp: pctChange(it.value, it.prevValue) })),
    SNAP_MS,
    state.cycle,
  );

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [state.cycle]);
  useEffect(() => {
    if (frozen.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frozen.length), ADVANCE_MS);
    return () => clearInterval(t);
  }, [frozen.length]);

  if (frozen.length === 0) {
    return <div className="empty">The floor is still. Nothing has moved yet.</div>;
  }

  const safeIdx = idx % frozen.length;
  const heroSnap = frozen[safeIdx]!;
  const hero = heroSnap.it;
  const isEd = hero.edition !== null;
  const heroDp = heroSnap.dp;
  const heroVal = heroSnap.value;
  const board = frozen.slice(0, 4);

  return (
    <div className="move">
      <button
        className={`spotlight ${isEd ? "ed" : ""}`}
        onClick={() => buy(hero.id)}
        aria-label={`Acquire ${hero.brand} ${hero.name}`}
      >
        <div className="spot-media">
          <ItemIcon it={hero} size={56} />
        </div>
        <div className="spot-body fadein" key={hero.id}>
          <div className="kick">{heroDp >= 0 ? "Heating up" : "Cooling"}</div>
          <div className="nm">{hero.name}</div>
          <div className="meta">
            {hero.brand} · {primarySectorLabel(hero)}
          </div>
          {isEd && (
            <span className="spot-edword">
              {hero.edition === 1 ? "1 of 1" : "Limited edition"}
            </span>
          )}
        </div>
        <div className="spot-price fadein" key={`p-${hero.id}`}>
          <div className="pr">{money(heroVal)}</div>
          <div className={`chg ${heroDp >= 0 ? "pos" : "neg"}`}>
            {heroDp >= 0 ? "▲" : "▼"} {signedPct(heroDp)}
          </div>
        </div>
        <div className="spot-dots">
          {frozen.map((m, i) => (
            <i key={m.it.id} className={i === safeIdx ? "on" : ""} />
          ))}
        </div>
      </button>

      <div className="board">
        {board.map(({ it, value, dp }) => (
          <div className="brow" key={it.id} onClick={() => buy(it.id)}>
            <ItemIcon it={it} size={18} className="ic" />
            <span className="nm">
              <span className="bd">{it.brand}</span>
              {it.name}
            </span>
            <span className="pr">{money(value)}</span>
            <span className={`chg ${dp >= 0 ? "pos" : "neg"}`}>
              {dp >= 0 ? "▲" : "▼"} {Math.abs(dp).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
