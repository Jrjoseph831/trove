"use client";

import { useState } from "react";
import { lotSize } from "@trove/data";
import type { RuntimeItem } from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** Centered confirmation before any acquisition. A limited/edition piece is a
 *  plain confirm — quantity is always exactly 1, nothing to pick. Everything
 *  else gets a stepper + typeable box + live total. Never shows how much is
 *  actually available; if the confirmed quantity turns out to exceed it, the
 *  buy attempt fails and this dialog says so inline instead of closing, so
 *  the player dials it back themselves. */
export function AcquireConfirm({
  item,
  onClose,
}: {
  item: RuntimeItem;
  onClose: () => void;
}) {
  const { buy, state, signedIn, mode, signIn } = useTrove();
  const isEdition = item.edition !== null;
  const lot = lotSize(item);
  const [qty, setQty] = useState(lot);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A guest browsing the live market can open this and set a quantity — the
  // wall is only at the last step, and it asks for a sign-in rather than
  // pretending a purchase is possible. Sandbox needs no account.
  const isGuest = !signedIn && mode !== "sandbox";

  const effQty = isEdition
    ? 1
    : Math.max(lot, Math.ceil(Math.max(1, qty) / lot) * lot);
  const total = effQty * item.value;
  const short = !isGuest && total > state.cash;

  const confirm = async () => {
    if (isGuest) {
      // Cognito bounces back to this same page, so they land where they were.
      signIn();
      return;
    }
    setError(null);
    setSubmitting(true);
    const r = await buy(item.id, effQty);
    setSubmitting(false);
    if (r.ok) {
      onClose();
      return;
    }
    setError(
      isEdition
        ? "That piece was just claimed by someone else."
        : "That's more than what's available — lower the quantity and try again.",
    );
  };

  return (
    <div
      className="reveal-bg show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bulkbuy">
        <div className="bb-kick">Acquire</div>
        <div className="bb-name">
          {item.brand} {item.name}
        </div>
        <div className="bb-sub">
          {isEdition
            ? item.edition === 1
              ? "1 of 1"
              : "Limited edition"
            : `${money(item.value)} each${
                lot > 1 ? ` · sold in cases of ${lot.toLocaleString()}` : ""
              }`}
        </div>

        {!isEdition && (
          <div className="bb-step">
            <button
              onClick={() => {
                setError(null);
                setQty((q) => Math.max(lot, q - lot));
              }}
              aria-label="Fewer"
            >
              −
            </button>
            <div className="bb-qty">
              <input
                type="number"
                min={lot}
                step={lot}
                value={qty}
                onChange={(e) => {
                  setError(null);
                  setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)));
                }}
                onBlur={() => setQty(effQty)}
              />
              <span>units</span>
            </div>
            <button
              onClick={() => {
                setError(null);
                setQty((q) => q + lot);
              }}
              aria-label="More"
            >
              +
            </button>
          </div>
        )}

        <div className="bb-total">
          Total <b>{money(total)}</b>
        </div>

        {error && <div className="bb-err">{error}</div>}

        {isGuest && (
          <div className="bb-guest">
            Sign in to place this order. New here? You&apos;ll set up your
            holding first.
          </div>
        )}

        <div className="bb-actions">
          <button className="bb-cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="bb-buy" disabled={short || submitting} onClick={confirm}>
            {isGuest
              ? "Sign In"
              : submitting
                ? "Acquiring…"
                : short
                  ? "Not enough cash"
                  : `Acquire${isEdition ? "" : ` ${effQty.toLocaleString()}`} · ${money(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
