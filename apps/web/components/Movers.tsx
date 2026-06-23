"use client";

import { useEffect, useMemo, useState } from "react";
import { money, pctChange, signedPct } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { primarySectorLabel } from "@/lib/ui";
import { useTrove } from "@/lib/trove";

/**
 * "On the Move" — a calm news-segment treatment instead of spammy reordering
 * tiles. The set is locked each cycle (no jumping); one mover is spotlighted
 * and auto-advances on a slow timer with a crossfade, with a stable board
 * beside it whose prices update in place.
 */
const ADVANCE_MS = 5000;

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

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [state.cycle, state]);
  useEffect(() => {
    if (top.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % top.length), ADVANCE_MS);
    return () => clearInterval(t);
  }, [top.length]);

  if (top.length === 0) {
    return <div className="empty">The floor is still. Nothing has moved yet.</div>;
  }

  const safeIdx = idx % top.length;
  const hero = top[safeIdx]!;
  const isEd = hero.edition !== null;
  const heroDp = pctChange(hero.value, hero.prevValue);
  const board = top.slice(0, 4);

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
          <div className="pr">{money(hero.value)}</div>
          <div className={`chg ${heroDp >= 0 ? "pos" : "neg"}`}>
            {heroDp >= 0 ? "▲" : "▼"} {signedPct(heroDp)}
          </div>
        </div>
        <div className="spot-dots">
          {top.map((m, i) => (
            <i key={m.id} className={i === safeIdx ? "on" : ""} />
          ))}
        </div>
      </button>

      <div className="board">
        {board.map((it) => {
          const dp = pctChange(it.value, it.prevValue);
          return (
            <div className="brow" key={it.id} onClick={() => buy(it.id)}>
              <ItemIcon it={it} size={18} className="ic" />
              <span className="nm">
                <span className="bd">{it.brand}</span>
                {it.name}
              </span>
              <span className="pr">{money(it.value)}</span>
              <span className={`chg ${dp >= 0 ? "pos" : "neg"}`}>
                {dp >= 0 ? "▲" : "▼"} {Math.abs(dp).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
