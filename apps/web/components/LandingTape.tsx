"use client";

import { money } from "@/lib/format";
import { moversByAbsMove } from "@/lib/ui";
import { useSnapshot } from "@/lib/useSnapshot";
import { useTrove } from "@/lib/trove";

const SNAP_MS = 8000;
const N = 20;

/** The landing page's price tape. Deliberately NOT the in-app <Ticker/>:
 *  that one is switched off by the global prefers-reduced-motion rule,
 *  which is right for chrome inside the app but wrong here, where a tape
 *  that visibly moves IS the pitch ("this world is running right now").
 *  `.ltape-track` is therefore explicitly exempt from that rule — a
 *  deliberate, narrowly-scoped accessibility trade-off for the one element
 *  whose motion carries the message, not decoration.
 *
 *  Animated in CSS (compositor-driven, keeps running under main-thread
 *  pressure) rather than rAF, and the list is rendered twice so the -50%
 *  loop is seamless instead of snapping back. */
export function LandingTape() {
  const { state } = useTrove();

  const tape = useSnapshot(
    () => {
      const movers = moversByAbsMove(state).slice(0, N);
      return movers.map((m) => ({
        id: m.it.id,
        name: m.it.name,
        brand: m.it.brand,
        value: m.it.value,
        dp: m.dp,
      }));
    },
    SNAP_MS,
    state.cycle,
  );

  if (tape.length === 0) return null;

  const row = (keyPrefix: string) =>
    tape.map((m) => (
      <span className="ltape-item" key={`${keyPrefix}${m.id}`}>
        <b>
          {m.brand} {m.name}
        </b>
        <span className="ltape-val">{money(m.value)}</span>
        <span className={`ltape-dp ${m.dp >= 0 ? "up" : "dn"}`}>
          {m.dp >= 0 ? "▲" : "▼"}
          {Math.abs(m.dp).toFixed(1)}%
        </span>
      </span>
    ));

  return (
    <div className="ltape">
      <div className="ltape-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
