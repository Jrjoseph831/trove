"use client";

import { useState } from "react";
import Link from "next/link";
import { AUTOFULFILL_REP, SPECIALIST_REP } from "@trove/engine";
import type { DeskOrder } from "@/lib/api";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** Reputation-gated automation unlocks (sandbox). */
function Automation() {
  const { state, desk, setDeskAutomation } = useTrove();
  const rep = desk?.reputation ?? state.reputation ?? 0;
  const a = state.deskAuto;

  return (
    <div className="desk-auto">
      <div className="desk-sec">Automation · unlocked by reputation</div>

      <div className="da-row">
        <div className="da-info">
          <b>Procurement Specialist</b>
          <span>
            Auto-negotiates every offer — holds a margin floor over source value,
            accepts at/above it, walks if the buyer can&apos;t reach it.
          </span>
        </div>
        {rep >= SPECIALIST_REP ? (
          <div className="da-ctl">
            <button
              className={`da-toggle ${a.specialist ? "on" : ""}`}
              onClick={() => setDeskAutomation({ specialist: !a.specialist })}
            >
              {a.specialist ? "On" : "Off"}
            </button>
            <div className="da-margin">
              <button
                onClick={() => setDeskAutomation({ minMargin: a.minMargin - 0.05 })}
              >
                −
              </button>
              <span>floor +{Math.round(a.minMargin * 100)}%</span>
              <button
                onClick={() => setDeskAutomation({ minMargin: a.minMargin + 0.05 })}
              >
                +
              </button>
            </div>
          </div>
        ) : (
          <span className="da-lock">Unlocks at rep {SPECIALIST_REP}</span>
        )}
      </div>

      <div className="da-row">
        <div className="da-info">
          <b>Auto-Fulfill</b>
          <span>Delivers accepted orders from your vault the moment you have the stock.</span>
        </div>
        {rep >= AUTOFULFILL_REP ? (
          <button
            className={`da-toggle ${a.autoFulfill ? "on" : ""}`}
            onClick={() => setDeskAutomation({ autoFulfill: !a.autoFulfill })}
          >
            {a.autoFulfill ? "On" : "Off"}
          </button>
        ) : (
          <span className="da-lock">Unlocks at rep {AUTOFULFILL_REP}</span>
        )}
      </div>
    </div>
  );
}

function timeLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** A live negotiation: their standing offer, your ask, accept/counter/walk. */
function OfferCard({ o }: { o: DeskOrder }) {
  const { acceptOrder, counterOrder, declineOrder } = useTrove();
  // Default ask: a healthy premium over your sourcing cost.
  const suggested = Math.max(
    o.companyOffer + 1,
    Math.round(o.marketValue * 1.3),
  );
  const [bid, setBid] = useState(String(suggested));
  const bidNum = Math.round(Number(bid));
  const valid = Number.isFinite(bidNum) && bidNum > 0;

  return (
    <div className="ordercard offer">
      <div className="oc-co">
        {o.company}
        <span className="oc-sector"> · {o.sector}</span>
        <span className="oc-round">
          round {o.round + 1} of {o.maxRounds}
        </span>
      </div>
      <div className="oc-line">
        <b>{o.qty.toLocaleString()} ×</b>{" "}
        <Link href={`/item/${o.itemId}`} className="it-link">
          {o.itemName}
        </Link>
        {o.youProduce && <span className="oc-make">◆ you make this</span>}
      </div>
      <div className="oc-meta">
        <span>
          Their offer <b>{money(o.companyOffer)}</b>
        </span>
        <span>≈ {money(o.marketValue)} to source</span>
      </div>

      <div className="oc-bidrow">
        <span className="oc-bidlbl">Your ask</span>
        <input
          className="oc-bid"
          type="number"
          min={1}
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) counterOrder(o.id, bidNum);
          }}
        />
        <button
          className="oc-counter"
          disabled={!valid}
          onClick={() => counterOrder(o.id, bidNum)}
        >
          Counter
        </button>
      </div>

      <div className="oc-actions">
        <button className="oc-decline" onClick={() => declineOrder(o.id)}>
          Walk away
        </button>
        <button className="oc-accept" onClick={() => acceptOrder(o.id)}>
          Accept {money(o.companyOffer)}
        </button>
      </div>
    </div>
  );
}

export function Desk() {
  const { desk, mode, signedIn, signIn, fulfillOrder } = useTrove();

  if (mode === "live" && !signedIn) {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Order Desk</h2>
        </div>
        <div className="empty">
          Sign in to receive contracts from companies on the floor.{" "}
          <button
            className="acct"
            style={{ width: "auto", marginTop: 10 }}
            onClick={signIn}
          >
            <b>Sign in</b>
          </button>
        </div>
      </div>
    );
  }

  if (!desk) {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Order Desk</h2>
        </div>
        <div className="empty">Opening the desk…</div>
      </div>
    );
  }

  const offers = desk.orders.filter((o) => o.status === "offer");
  const accepted = desk.orders.filter((o) => o.status === "accepted");

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">Order Desk</h2>
        <div className="desk-rep">
          Reputation <b>{desk.reputation}</b>
        </div>
      </div>

      {mode === "sandbox" && <Automation />}

      {desk.orders.length === 0 && (
        <div className="empty">
          No requests yet. Companies send work every few minutes — keep the floor
          in view, then haggle for the best price.
        </div>
      )}

      {accepted.length > 0 && <div className="desk-sec">In progress</div>}
      {accepted.map((o) => {
        const ready = o.held >= o.qty;
        return (
          <div key={o.id} className="ordercard accepted">
            <div className="oc-co">
              {o.company}
              <span className="oc-sector"> · {o.sector}</span>
              <span className="oc-time"> · ⏳ {timeLeft(o.expiresAt)}</span>
            </div>
            <div className="oc-line">
              <b>{o.qty.toLocaleString()} ×</b>{" "}
              <Link href={`/item/${o.itemId}`} className="it-link">
                {o.itemName}
              </Link>
              {o.youProduce && <span className="oc-make">◆ you make this</span>}
            </div>
            <div className="oc-meta">
              <span>
                Pays <b>{money(o.quote)}</b>
              </span>
              <span>
                In vault: {o.held.toLocaleString()} / {o.qty.toLocaleString()}
              </span>
            </div>
            <div className="oc-bar">
              <i
                style={{ width: `${Math.min(100, (o.held / o.qty) * 100)}%` }}
              />
            </div>
            <div className="oc-actions">
              <button
                className="oc-fulfill"
                disabled={!ready}
                onClick={() => fulfillOrder(o.id)}
              >
                {ready
                  ? `Fulfill · ${money(o.quote)}`
                  : o.youProduce
                    ? `Need ${(o.qty - o.held).toLocaleString()} more — produce or buy`
                    : `Need ${(o.qty - o.held).toLocaleString()} more`}
              </button>
            </div>
          </div>
        );
      })}

      {offers.length > 0 && <div className="desk-sec">Requests · negotiate</div>}
      {offers.map((o) => (
        <OfferCard key={o.id} o={o} />
      ))}
    </div>
  );
}
