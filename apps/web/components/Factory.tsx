"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  canProduce,
  factorySpec,
  getItem,
  items as catalog,
  recipeOf,
} from "@trove/data";
import type { Item } from "@trove/data";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** Short "2× Steel Billet + 1× I-Beam" recipe summary, or "extraction". */
function recipeText(out: Item): string {
  const r = recipeOf(out);
  if (!r || r.inputs.length === 0) return "Extraction · no inputs";
  return r.inputs
    .map((i) => `${i.qty}× ${getItem(i.itemId)?.name ?? "?"}`)
    .join("  +  ");
}

export function Factory() {
  const { mode, state, buildLine, demolishLine } = useTrove();
  const [picking, setPicking] = useState(false);

  // Live factories need the Settlement Lambda production step + a per-player
  // table — that's the next phase. For now the Factory lives in the sandbox.
  if (mode === "live") {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Factory</h2>
        </div>
        <div className="empty">
          Production lines are coming to the live floor soon. For now, switch to{" "}
          <b>Sandbox</b> to build factories, source inputs, and watch a line run.
        </div>
      </div>
    );
  }

  const factories = state.factories;

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">Factory</h2>
        <div className="fac-cash">
          Cash <b>{money(state.cash)}</b>
        </div>
      </div>

      <p className="fac-intro">
        Build a line to <b>produce</b> a good every cycle. A line consumes input
        items from your vault, pays upkeep whether it runs or not, and drops its
        output into your vault — sell it on the floor or fill orders.
      </p>

      {factories.length === 0 && (
        <div className="empty">
          No lines yet. Build one below — start cheap (screws, bolts) and reinvest
          into bigger goods.
        </div>
      )}

      {factories.map((f) => {
        // The runtime item carries the live floor price + your holdings.
        const out = state.items.find((i) => i.id === f.itemId);
        if (!out) return null;
        const spec = factorySpec(out);
        const recipe = recipeOf(out);
        const inputs = recipe?.inputs ?? [];
        const building = state.cycle < f.onlineCycle;
        const cyclesLeft = f.onlineCycle - state.cycle;
        // Can the vault cover a full batch right now?
        const batch = inputs.map((inp) => {
          const held = state.items.find((i) => i.id === inp.itemId);
          const need = inp.qty * spec.rate;
          return {
            inp,
            name: held?.name ?? `#${inp.itemId}`,
            have: held?.owners["YOU"] ?? 0,
            need,
          };
        });
        const ready = batch.every((b) => b.have >= b.need);
        const status = building
          ? "building"
          : ready
            ? "running"
            : "idle";

        return (
          <div key={f.id} className={`facline ${status}`}>
            <div className="fl-top">
              <div className="fl-name">
                <Link href={`/item/${out.id}`} className="it-link">
                  {out.name}
                </Link>
                <span className="fl-bd">{out.brand}</span>
              </div>
              <span className={`fl-status ${status}`}>
                {building
                  ? `building · ${cyclesLeft} cy`
                  : status === "running"
                    ? "● running"
                    : "◐ idle"}
              </span>
            </div>

            <div className="fl-econ">
              <span>
                <b>{spec.rate.toLocaleString()}</b>/cycle
              </span>
              <span>upkeep {money(spec.upkeep)}/cy</span>
              <span>
                ≈ {money(out.value)} ea on the floor
              </span>
            </div>

            {inputs.length > 0 ? (
              <div className="fl-recipe">
                <div className="fl-rlabel">Consumes per cycle</div>
                {batch.map((b) => (
                  <div
                    key={b.inp.itemId}
                    className={`fl-inp ${b.have >= b.need ? "" : "short"}`}
                  >
                    <Link href={`/item/${b.inp.itemId}`} className="it-link">
                      {b.name}
                    </Link>
                    <span className="fl-need">
                      {b.have.toLocaleString()} / {b.need.toLocaleString()}
                    </span>
                  </div>
                ))}
                {!building && !ready && (
                  <div className="fl-warn">
                    Short on inputs — line idles (still paying upkeep). Buy more on
                    the floor.
                  </div>
                )}
              </div>
            ) : (
              <div className="fl-recipe">
                <div className="fl-rlabel">Extraction · no inputs</div>
              </div>
            )}

            <div className="fl-foot">
              <button
                className="fl-demolish"
                onClick={() => demolishLine(f.id)}
              >
                Tear down
              </button>
            </div>
          </div>
        );
      })}

      <button className="fac-build" onClick={() => setPicking(true)}>
        ＋ Build a new line
      </button>

      {picking && (
        <BuildPicker
          cash={state.cash}
          onPick={(id) => {
            buildLine(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

const PRODUCIBLE: Item[] = catalog
  .filter(canProduce)
  .sort((a, b) => a.base - b.base);

function BuildPicker({
  cash,
  onPick,
  onClose,
}: {
  cash: number;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? PRODUCIBLE.filter(
          (it) =>
            it.name.toLowerCase().includes(needle) ||
            it.brand.toLowerCase().includes(needle),
        )
      : PRODUCIBLE;
    return pool.slice(0, 60);
  }, [q]);

  return (
    <div
      className="reveal-bg show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="facpick">
        <div className="fp-head">
          <h3 className="serif">Build a line</h3>
          <button className="fp-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input
          className="fp-search"
          placeholder="Search items to produce…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="fp-list">
          {results.map((it) => {
            const spec = factorySpec(it);
            const afford = cash >= spec.buildCost;
            return (
              <button
                key={it.id}
                className="fp-row"
                disabled={!afford}
                onClick={() => onPick(it.id)}
                title={recipeText(it)}
              >
                <div className="fp-r-main">
                  <span className="fp-r-name">{it.name}</span>
                  <span className="fp-r-bd">{it.brand}</span>
                </div>
                <div className="fp-r-recipe">{recipeText(it)}</div>
                <div className="fp-r-econ">
                  <span>{spec.rate.toLocaleString()}/cy</span>
                  <span className={afford ? "" : "fp-cant"}>
                    build {money(spec.buildCost)}
                  </span>
                </div>
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="empty">No producible items match.</div>
          )}
        </div>
      </div>
    </div>
  );
}
