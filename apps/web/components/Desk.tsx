"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AUTOFULFILL_REP,
  productionCostOf,
  SPECIALIST_REP,
  type WorldState,
} from "@trove/engine";
import type { DeskOrder, PvpOrder } from "@/lib/api";
import { manufacturingName, money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** What it costs YOU to make the whole order (materials + upkeep, all-in), or
 *  null if you don't make it. productionCostOf is per-unit; × qty for the order. */
function makeCostOf(state: WorldState, o: DeskOrder): number | null {
  if (!o.youProduce) return null;
  const item = state.items.find((i) => i.id === o.itemId);
  if (!item) return null;
  const unit = productionCostOf(state, item);
  return unit == null ? null : Math.round(unit * o.qty);
}

type OrderAct = (
  id: string,
  action: "accept" | "decline" | "counter" | "withdraw",
  price?: number,
) => void;

/** A request from another holding, seen on YOUR desk (you're the seller). */
function IncomingCard({ o, held, act }: { o: PvpOrder; held: number; act: OrderAct }) {
  const enough = held >= o.qty;
  const [bid, setBid] = useState(String(Math.round(o.price * 1.12)));
  const bidNum = Math.round(Number(bid));
  const valid = Number.isFinite(bidNum) && bidNum > 0;
  const waiting = o.turn === "buyer";

  return (
    <div className="ordercard offer pvp">
      <div className="oc-co">
        <span className="pvp-tag">◈ holding</span> {manufacturingName(o.buyerName)}
      </div>
      <div className="oc-line">
        <b>{o.qty.toLocaleString()} ×</b>{" "}
        <Link href={`/item/${o.itemId}`} className="it-link">
          {o.itemName}
        </Link>
      </div>
      <div className="oc-meta">
        <span>
          Offer <b>{money(o.price)}</b> ({money(Math.round(o.price / o.qty))}/u)
        </span>
        <span className={enough ? "pvp-ok" : "pvp-short"}>
          you hold {held.toLocaleString()} {enough ? "✓" : `/ ${o.qty.toLocaleString()}`}
        </span>
      </div>

      {waiting ? (
        <div className="pvp-wait">Countered {money(o.price)} · awaiting their reply</div>
      ) : (
        <>
          {!o.countered && (
            <div className="oc-bidrow">
              <span className="oc-bidlbl">Counter</span>
              <input
                className="oc-bid"
                type="number"
                min={1}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
              />
              <button
                className="oc-counter"
                disabled={!valid}
                onClick={() => act(o.id, "counter", bidNum)}
              >
                Send
              </button>
            </div>
          )}
          <div className="oc-actions">
            <button className="oc-decline" onClick={() => act(o.id, "decline")}>
              Decline
            </button>
            <button
              className="oc-accept"
              disabled={!enough}
              title={enough ? "" : "You don't hold enough to deliver"}
              onClick={() => act(o.id, "accept")}
            >
              {enough ? `Accept ${money(o.price)}` : "Need more stock"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** One of YOUR outgoing requests (you're the buyer). */
function OutgoingCard({ o, cash, act }: { o: PvpOrder; cash: number; act: OrderAct }) {
  const yourMove = o.turn === "buyer"; // the seller countered back to you
  const afford = cash >= o.price;
  return (
    <div className="ordercard offer pvp out">
      <div className="oc-co">→ {manufacturingName(o.sellerName)}</div>
      <div className="oc-line">
        <b>{o.qty.toLocaleString()} ×</b>{" "}
        <Link href={`/item/${o.itemId}`} className="it-link">
          {o.itemName}
        </Link>
      </div>
      <div className="oc-meta">
        <span>
          {yourMove ? "Their counter" : "Your offer"} <b>{money(o.price)}</b>
        </span>
        <span>{yourMove ? "your move" : "awaiting seller"}</span>
      </div>
      <div className="oc-actions">
        <button className="oc-decline" onClick={() => act(o.id, "withdraw")}>
          Withdraw
        </button>
        {yourMove && (
          <button
            className="oc-accept"
            disabled={!afford}
            title={afford ? "" : "Not enough cash"}
            onClick={() => act(o.id, "accept")}
          >
            {afford ? `Accept ${money(o.price)}` : "Can't cover it"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The player-to-player order book on the desk (multiplayer routing). */
function PlayerOrders() {
  const { orders, orderAct, state } = useTrove();
  if (!orders) return null;
  const { incoming, outgoing } = orders;
  if (!incoming.length && !outgoing.length) return null;
  const heldOf = (id: number) => state.items.find((i) => i.id === id)?.owners["YOU"] ?? 0;
  return (
    <>
      {incoming.length > 0 && <div className="desk-sec">Requests from holdings</div>}
      {incoming.map((o) => (
        <IncomingCard key={o.id} o={o} held={heldOf(o.itemId)} act={orderAct} />
      ))}
      {outgoing.length > 0 && <div className="desk-sec">Your outgoing requests</div>}
      {outgoing.map((o) => (
        <OutgoingCard key={o.id} o={o} cash={state.cash} act={orderAct} />
      ))}
    </>
  );
}

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
  const { acceptOrder, counterOrder, declineOrder, state } = useTrove();
  // Default ask: a healthy premium over your sourcing cost.
  const suggested = Math.max(
    o.companyOffer + 1,
    Math.round(o.marketValue * 1.3),
  );
  const [bid, setBid] = useState(String(suggested));
  const bidNum = Math.round(Number(bid));
  const valid = Number.isFinite(bidNum) && bidNum > 0;

  const makeCost = makeCostOf(state, o);
  const profit = makeCost != null ? o.companyOffer - makeCost : null;
  const margin = profit != null ? Math.round((profit / o.companyOffer) * 100) : 0;

  return (
    <div className="ordercard offer">
      <div className="oc-co">
        {o.company}
        <span className="oc-sector"> · {o.sector}</span>
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
        <span>
          ~{money(o.marketValue)} to source
          {makeCost != null && (
            <>
              {" · "}
              ~<b>{money(makeCost)}</b> to make
            </>
          )}
        </span>
      </div>
      {makeCost != null && profit != null && (
        <div className={`oc-profit ${profit >= 0 ? "pos" : "neg"}`}>
          {profit >= 0 ? "Profit if you make " : "Loss if you make "}
          <b>
            {profit >= 0 ? "+" : ""}
            {money(profit)}
          </b>
          {profit >= 0 && o.companyOffer > 0 && ` · ${margin}% margin`}
        </div>
      )}

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
  const { desk, mode, state, signedIn, signIn, fulfillOrder } = useTrove();

  if (mode === "live" && !signedIn) {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Order Desk</h2>
        </div>
        <div className="empty">
          Sign in to receive contracts from firms on the market.{" "}
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

      <Automation />

      <PlayerOrders />

      {desk.orders.length === 0 && (
        <div className="empty">
          No client contracts right now. Companies send work every few minutes —
          and other holdings can order from your storefront (see Companies).
        </div>
      )}

      {desk.orders.length > 0 && <div className="desk-sec">Client contracts</div>}

      {accepted.length > 0 && <div className="desk-sec">In progress</div>}
      {accepted.map((o) => {
        const ready = o.held >= o.qty;
        const makeCost = makeCostOf(state, o);
        const profit = makeCost != null ? o.quote - makeCost : null;
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
                {makeCost != null && <> · ~{money(makeCost)} to make</>}
              </span>
              <span>
                In vault: {o.held.toLocaleString()} / {o.qty.toLocaleString()}
              </span>
            </div>
            {profit != null && (
              <div className={`oc-profit ${profit >= 0 ? "pos" : "neg"}`}>
                {profit >= 0 ? "Profit " : "Loss "}
                <b>
                  {profit >= 0 ? "+" : ""}
                  {money(profit)}
                </b>{" "}
                on delivery
              </div>
            )}
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
