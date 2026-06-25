"use client";

import Link from "next/link";
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

export function Desk() {
  const { desk, signedIn, signIn, acceptOrder, declineOrder, fulfillOrder } =
    useTrove();

  if (!signedIn) {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Order Desk</h2>
        </div>
        <div className="empty">
          Sign in to receive contracts from companies on the floor.{" "}
          <button className="acct" style={{ width: "auto", marginTop: 10 }} onClick={signIn}>
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

  const pending = desk.orders.filter((o) => o.status === "pending");
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
          No contracts yet. Companies send new orders every few minutes — keep
          the floor in view.
        </div>
      )}

      {accepted.length > 0 && <div className="desk-sec">In progress</div>}
      {accepted.map((o) => {
        const ready = o.held >= o.qty;
        return (
          <div key={o.id} className="ordercard accepted">
            <div className="oc-co">
              {o.company}
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
              <i style={{ width: `${Math.min(100, (o.held / o.qty) * 100)}%` }} />
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

      {pending.length > 0 && <div className="desk-sec">New offers</div>}
      {pending.map((o) => {
        const spread = o.quote - o.marketValue;
        return (
          <div key={o.id} className="ordercard">
            <div className="oc-co">
              {o.company}
              <span className="oc-time"> · {timeLeft(o.expiresAt)} left</span>
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
              <span>Market ~{money(o.marketValue)}</span>
              <span className={spread >= 0 ? "oc-up" : "oc-dn"}>
                spread {spread >= 0 ? "+" : ""}
                {money(spread)}
              </span>
            </div>
            <div className="oc-actions">
              <button className="oc-decline" onClick={() => declineOrder(o.id)}>
                Decline
              </button>
              <button className="oc-accept" onClick={() => acceptOrder(o.id)}>
                Accept
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
