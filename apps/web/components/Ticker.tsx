"use client";

import { money } from "@/lib/format";
import { moversByAbsMove } from "@/lib/ui";
import { useTrove } from "@/lib/trove";

/** The brass tape: front headline + biggest price moves, scrolling. */
export function Ticker() {
  const { state } = useTrove();
  const tape = moversByAbsMove(state).slice(0, 10);
  return (
    <div className="ticker">
      <div className="run">
        <span style={{ color: "var(--brass-lit)" }}>
          ▣ {state.front?.head ?? ""}
        </span>
        {tape.map((m) => (
          <span key={m.it.id}>
            <b>
              {m.it.brand} {m.it.name}
            </b>{" "}
            {money(m.it.value)}{" "}
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
