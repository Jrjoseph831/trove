"use client";

import { flowRows } from "./Report";
import { humanizeAway } from "@/lib/recap";
import { money, moneyShort } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** The dismissible bento tile that summarizes what happened while a
 *  returning player was away — production, sales, and net worth movement,
 *  reusing the same flow-row/up-down styling as the daily report card. */
export function WhileYouWereAwayCard() {
  const { recap, dismissRecap } = useTrove();
  if (!recap) return null;

  const rows = flowRows({ flows: recap.flows });
  const delta = recap.netWorthDelta;

  return (
    <article className="away-card col-12">
      <div className="dr-head">
        <span className="brk-card-kick">
          While you were away · {humanizeAway(recap.awayMs)}
          {recap.cyclesAway > 1 ? ` · ${recap.cyclesAway} cycles` : ""}
        </span>
        <button className="dr-x" onClick={dismissRecap} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <div className="dr-net">
        Net worth <b>{moneyShort(recap.netWorthNow)}</b>
        <span className={delta >= 0 ? "rc-up" : "rc-dn"}>
          {" "}
          {delta >= 0 ? "+" : ""}
          {moneyShort(delta)}
        </span>
      </div>
      <div className="dr-flows">
        {rows.map((row) => (
          <div key={row.k} className="dr-flow">
            <span>{row.k}</span>
            <b className={row.good ? "rc-up" : "rc-dn"}>
              {row.money
                ? `${row.v >= 0 ? "+" : ""}${money(row.v)}`
                : row.v.toLocaleString()}
            </b>
          </div>
        ))}
        {rows.length === 0 && <div className="rc-quiet">A quiet shift.</div>}
      </div>
      {recap.headline && (
        <div className="away-headline">
          <span className="away-headline-kick">{recap.headline.kick}</span>
          {" — "}
          {recap.headline.head}
        </div>
      )}
    </article>
  );
}
