"use client";

import { useRef } from "react";
import { money } from "@/lib/format";
import { moversByAbsMove } from "@/lib/ui";
import { useSnapshot } from "@/lib/useSnapshot";
import { useTrove } from "@/lib/trove";

/** The brass tape: front headline, then a scrolling MARKET segment (a window
 *  that surveys the whole floor over time) and an ON THE MOVE segment. Both are
 *  a calm periodic SNAPSHOT — the tape keeps scrolling smoothly while the numbers
 *  only refresh every few seconds, so nothing flickers. */
const SNAP_MS = 8000;
const MARKET_N = 14;
const MOVERS_N = 8;

export function Ticker() {
  const { state } = useTrove();
  const winRef = useRef(0);

  const tape = useSnapshot(
    () => {
      const movers = moversByAbsMove(state)
        .slice(0, MOVERS_N)
        .map((m) => ({
          id: m.it.id,
          name: m.it.name,
          brand: m.it.brand,
          value: m.it.value,
          dp: m.dp,
        }));

      // A rotating market window (by value) that advances each snapshot, so the
      // tape surveys the whole catalog over time instead of fixating.
      const live = state.items.filter((i) => i.edition === null || i.remaining > 0);
      const sorted = [...live].sort((a, b) => b.value - a.value);
      const len = sorted.length || 1;
      const off = (winRef.current * MARKET_N) % len;
      winRef.current += 1;
      const market = [];
      for (let k = 0; k < Math.min(MARKET_N, len); k++) {
        const it = sorted[(off + k) % len]!;
        market.push({ id: it.id, name: it.name, brand: it.brand, value: it.value });
      }

      return { head: state.front?.head ?? "", market, movers };
    },
    SNAP_MS,
    state.cycle,
  );

  return (
    <div className="ticker">
      <div className="run">
        <span className="tk-lead">▣ {tape.head}</span>
        <span className="tk-seg">MARKET</span>
        {tape.market.map((m) => (
          <span key={`m${m.id}`}>
            <b>
              {m.brand} {m.name}
            </b>{" "}
            {money(m.value)}
          </span>
        ))}
        <span className="tk-seg">ON THE MOVE</span>
        {tape.movers.map((m) => (
          <span key={`v${m.id}`}>
            <b>
              {m.brand} {m.name}
            </b>{" "}
            {money(m.value)}{" "}
            <span className={m.dp >= 0 ? "up" : "dn"}>
              {m.dp >= 0 ? "▲" : "▼"}
              {Math.abs(m.dp).toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
