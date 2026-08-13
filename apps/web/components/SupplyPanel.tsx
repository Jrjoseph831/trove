"use client";

import { useMemo, useState } from "react";
import { recipeOf, effectiveSpec, getItem } from "@trove/data";
import { held, supplyQuote, type RuntimeItem } from "@trove/engine";
import { money, moneyShort } from "@/lib/format";
import { perHour, ticksToTvt } from "@/lib/tvt";
import { useTrove } from "@/lib/trove";

/** Cover thresholds, in production ticks. Shown to the player as Trove hours
 *  (6 ticks to the hour) — roughly 7h comfortable, 2h tight. */
const COVER_OK = 40;
const COVER_LOW = 12;

interface Need {
  it: RuntimeItem;
  perTick: number; // units every line together consume per production tick
  onHand: number; // in the vault
  inbound: number; // paid for, still in transit
  floorStock: number; // what the market can still sell you
}

/** Supply first: what your lines eat, how long you're covered, and the one
 *  action that fixes it. This is the screen's primary concern because material
 *  — not cash — is what actually stops a floor now. */
export function SupplyPanel() {
  const { state, orderSupply, setReorder, tick } = useTrove();
  const [openFor, setOpenFor] = useState<number | null>(null);

  const needs = useMemo(() => {
    const acc = new Map<number, Need>();
    for (const f of state.factories) {
      const out = state.items.find((x) => x.id === f.itemId);
      if (!out) continue;
      const spec = effectiveSpec(out, f.modules);
      const recipe = recipeOf(out);
      for (const inp of recipe?.inputs ?? []) {
        const it = state.items.find((x) => x.id === inp.itemId);
        if (!it) continue;
        const per = Math.ceil(inp.qty * spec.rate * spec.inputMul);
        const cur = acc.get(it.id);
        if (cur) cur.perTick += per;
        else
          acc.set(it.id, {
            it,
            perTick: per,
            onHand: held(it, "YOU"),
            inbound: 0,
            floorStock: it.stock,
          });
      }
    }
    for (const o of state.supplyOrders ?? []) {
      const n = acc.get(o.itemId);
      if (n) n.inbound += o.qty;
    }
    return [...acc.values()].sort(
      (a, b) => a.onHand / (a.perTick || 1) - b.onHand / (b.perTick || 1),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tick]);

  if (state.factories.length === 0) return null;

  return (
    <section className="supply">
      <div className="supply-h">
        <span className="supply-t">Supply</span>
        <span className="supply-why">
          what your lines consume · per Trove hour, at current output
        </span>
      </div>

      {needs.length === 0 ? (
        <div className="empty">Your lines draw no materials — pure extraction.</div>
      ) : (
        <div className="supply-list">
          {needs.map((n) => {
            const cover = n.perTick > 0 ? n.onHand / n.perTick : Infinity;
            const level = cover >= COVER_OK ? "ok" : cover >= COVER_LOW ? "low" : "crit";
            const rule = (state.reorders ?? []).find((r) => r.itemId === n.it.id);
            return (
              <div className={`sup-card ${level}`} key={n.it.id}>
                <div className="sc-top">
                  <span className="sup-nm">
                    <i className="sup-dot" />
                    {n.it.name}
                  </span>
                  <button
                    className="sup-btn"
                    onClick={() => setOpenFor(openFor === n.it.id ? null : n.it.id)}
                  >
                    {openFor === n.it.id ? "Close" : "Order"}
                  </button>
                </div>

                {/* The three numbers that decide whether to act, in the same
                    label-under-value shape the Deal Room cards use. Cover is
                    the headline — it's the one that answers "do I care yet?" */}
                <div className="sc-metrics">
                  <span className="sc-metric">
                    <b>{Math.floor(n.onHand).toLocaleString()}</b>
                    <i>on hand</i>
                  </span>
                  <span className="sc-metric">
                    <b>{Math.round(perHour(n.perTick)).toLocaleString()}/hr</b>
                    <i>burn</i>
                  </span>
                  <span className={`sc-metric lead ${level}`}>
                    <b>{cover === Infinity ? "—" : ticksToTvt(cover)}</b>
                    <i>cover left</i>
                  </span>
                </div>

                {(n.inbound > 0 || rule) && (
                  <div className="sc-tags">
                    {n.inbound > 0 && (
                      <span className="sup-inbound">
                        +{n.inbound.toLocaleString()} inbound
                      </span>
                    )}
                    {rule && (
                      <span className="sup-rule" title="Auto-reorder is on">
                        auto ≤{rule.floor.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}

                {openFor === n.it.id && (
                  <OrderRow
                    need={n}
                    rule={rule}
                    cash={state.cash}
                    onOrder={(q) => {
                      orderSupply(n.it.id, q);
                      setOpenFor(null);
                    }}
                    onReorder={(floor, q) => setReorder(n.it.id, floor, q)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OrderRow({
  need,
  rule,
  cash,
  onOrder,
  onReorder,
}: {
  need: Need;
  rule?: { floor: number; qty: number };
  cash: number;
  onOrder: (qty: number) => void;
  onReorder: (floor: number, qty: number) => void;
}) {
  // Default to roughly a full settlement of cover, bounded by what's actually
  // on the floor and what you can pay for.
  const suggested = Math.max(1, Math.min(Math.floor(need.floorStock), need.perTick * 72));
  // Held as TEXT, coerced only when read. Clamping on every keystroke made the
  // field impossible to clear: deleting the last digit produced "", which
  // coerced straight back to 1, so you could never type a different number —
  // only append to the one already there.
  const [qtyText, setQtyText] = useState(String(suggested));
  const qty = Math.max(0, Math.floor(Number(qtyText) || 0));
  const q = supplyQuote(need.it, Math.max(1, qty));
  const tooMuch = qty > need.floorStock;
  const tooDear = q.total > cash;

  return (
    <div className="sup-order">
      <div className="sup-order-row">
        <label>
          Quantity
          <input
            type="number"
            min={1}
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={() => setQtyText(String(Math.max(1, qty)))}
          />
        </label>
        <div className="sup-quote">
          <span>
            {money(q.unit)}<em>/unit</em>
            {q.discount > 0 && (
              <b className="sup-disc"> −{Math.round(q.discount * 100)}%</b>
            )}
          </span>
          <span>
            {moneyShort(q.total)}<em>total</em>
          </span>
          <span>
            {ticksToTvt(q.lead)}<em>delivery</em>
          </span>
        </div>
        <button
          className="sup-place"
          disabled={qty < 1 || tooMuch || tooDear}
          onClick={() => onOrder(qty)}
        >
          {qty < 1
            ? "Enter a quantity"
            : tooMuch
            ? "More than the floor has"
            : tooDear
              ? "Not enough cash"
              : `Order · ${moneyShort(q.total)}`}
        </button>
      </div>
      <div className="sup-auto">
        <span>
          Auto-reorder when cover drops below{" "}
          <b>{Math.floor(need.perTick * 12).toLocaleString()}</b> units
        </span>
        {rule ? (
          <button className="sup-autobtn on" onClick={() => onReorder(0, 0)}>
            Turn off
          </button>
        ) : (
          <button
            className="sup-autobtn"
            onClick={() => onReorder(Math.max(1, need.perTick * 12), suggested)}
          >
            Turn on
          </button>
        )}
      </div>
    </div>
  );
}

/** Materials in transit — paid for, not yet landed. */
export function InboundStrip() {
  const { state, factoryCycle } = useTrove();
  const orders = state.supplyOrders ?? [];
  if (orders.length === 0) return null;
  return (
    <div className="inbound">
      <span className="inbound-h">In transit</span>
      {orders.map((o) => {
        const it = getItem(o.itemId);
        // arrivesCycle is stamped on the PRODUCTION clock (wallProdCycle), so it
        // has to be compared against the production clock. Subtracting the
        // market cycle instead — a completely different, much slower counter —
        // left a difference of ~5.9M ticks and rendered deliveries as arriving
        // in forty thousand days.
        const left = Math.max(0, o.arrivesCycle - factoryCycle);
        return (
          <span className="inbound-pill" key={o.id}>
            {o.qty.toLocaleString()}× {it?.name ?? "material"}
            <em>{left === 0 ? "arriving" : `in ${ticksToTvt(left)}`}</em>
          </span>
        );
      })}
    </div>
  );
}
