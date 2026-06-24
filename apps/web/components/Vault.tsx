"use client";

import Link from "next/link";
import { brandSlug } from "@trove/data";
import { creditLimit, held } from "@trove/engine";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";

export function Vault() {
  const { state, sell, doBorrow, doRepay } = useTrove();
  const mine = state.items.filter((i) => held(i, "YOU") > 0);
  const lim = creditLimit(state);
  const avail = Math.max(0, lim - state.debt);

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">My Vault</h2>
      </div>
      <div className="cat-grid">
        <div>
          {mine.length === 0 ? (
            <div className="empty">
              Empty. Read the front page, then acquire something.
            </div>
          ) : (
            mine.map((it) => {
              const q = held(it, "YOU");
              const pl = it.value - (it.buyAt ?? it.value);
              const edNo =
                it.edition !== null && it.myCopies.length
                  ? ` · #${it.myCopies[0]} of ${it.edition}`
                  : "";
              return (
                <div className="crow" key={it.id}>
                  <ItemIcon it={it} size={18} className="ic" />
                  <span className="nm">
                    <Link
                      href={`/brand/${brandSlug(it.brand)}`}
                      className="bd bd-link"
                    >
                      {it.brand}
                    </Link>
                    <Link href={`/item/${it.id}`} className="it-link">
                      {it.name}
                    </Link>
                    {q > 1 ? ` ×${q}` : ""}
                    {edNo}
                  </span>
                  <span className="pr">{money(it.value * q)}</span>
                  <span className={`chg ${pl >= 0 ? "pos" : "neg"}`}>
                    {pl >= 0 ? "+" : ""}
                    {money(pl)}
                  </span>
                  <button
                    className="tbtn sell"
                    style={{ marginLeft: 12 }}
                    onClick={() => sell(it.id)}
                  >
                    Let go
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="stack">
          <div className="glasspanel">
            <div className="panel-h">Credit Line</div>
            <div className="debtctl">
              <div className="line">
                <span>Borrowed</span>
                <b>{money(state.debt)}</b>
              </div>
              <div className="meter">
                <i
                  style={{
                    width: `${lim ? Math.min(100, (state.debt / lim) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="line">
                <span>Available {money(avail)}</span>
                <span>0.05%/cycle</span>
              </div>
              <div className="dbtns">
                <button
                  className="borrow"
                  disabled={avail <= 0}
                  onClick={doBorrow}
                >
                  Borrow $5k
                </button>
                <button
                  className="repay"
                  disabled={state.debt <= 0 || state.cash <= 0}
                  onClick={doRepay}
                >
                  Repay $5k
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
