"use client";

import { useState } from "react";
import Link from "next/link";
import type { DeskOrder } from "@/lib/api";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

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
        <span className="oc-bd">{o.brand}</span>
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
              <span className="oc-bd">{o.brand}</span>
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
                  : `Source ${(o.qty - o.held).toLocaleString()} more`}
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
