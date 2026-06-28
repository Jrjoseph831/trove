"use client";

import Link from "next/link";
import { brandSlug } from "@trove/data";
import { creditLimit, held } from "@trove/engine";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";

export function Vault() {
  const { state, sell, setListing, doBorrow, doRepay } = useTrove();
  const mine = state.items.filter((i) => held(i, "YOU") > 0);
  const lim = creditLimit(state);
  const avail = Math.max(0, lim - state.debt);

  const holdingsValue = mine.reduce((s, it) => s + it.value * held(it, "YOU"), 0);
  const unrealized = mine.reduce(
    (s, it) => s + (it.value - (it.buyAt ?? it.value)) * held(it, "YOU"),
    0,
  );

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">My Vault</h2>
        {mine.length > 0 && (
          <div className="vault-sum">
            <span className="vs">
              <i>Holdings</i>
              <b>{mine.length}</b>
            </span>
            <span className="vs">
              <i>Market value</i>
              <b>{money(holdingsValue)}</b>
            </span>
            <span className={`vs ${unrealized >= 0 ? "pos" : "neg"}`}>
              <i>Unrealized</i>
              <b>
                {unrealized >= 0 ? "+" : ""}
                {money(unrealized)}
              </b>
            </span>
          </div>
        )}
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
              const produced = state.producedQty[it.id] ?? 0;
              const bought = q - produced;
              const listed = state.listed[it.id] !== false;
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
                    {q > 1 ? ` ×${q.toLocaleString()}` : ""}
                    {edNo}
                    {produced > 0 && (
                      <span className={`vlisted ${listed ? "" : "held"}`}>
                        {produced.toLocaleString()} made · {listed ? "listed" : "held"}
                      </span>
                    )}
                  </span>
                  <span className="pr">{money(it.value * q)}</span>
                  <span className={`chg ${pl >= 0 ? "pos" : "neg"}`}>
                    {pl >= 0 ? "+" : ""}
                    {money(pl)}
                  </span>
                  {(produced > 0 || bought > 0) && (
                    <span className="crow-acts">
                      {produced > 0 && (
                        <button
                          className={`tbtn ${listed ? "" : "sell"}`}
                          title={
                            listed
                              ? "Listed for passive sale — click to hold instead"
                              : "Held (not selling) — click to list for passive sale"
                          }
                          onClick={() => setListing(it.id, !listed)}
                        >
                          {listed ? "Unlist" : "List"}
                        </button>
                      )}
                      {bought > 0 && (
                        <button
                          className="tbtn sell"
                          title="Sell a bought unit at market"
                          onClick={() => sell(it.id)}
                        >
                          Let go
                        </button>
                      )}
                    </span>
                  )}
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
