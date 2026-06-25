"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Cog, Package, Truck } from "lucide-react";
import {
  canProduce,
  effectiveSpec,
  factorySpec,
  getItem,
  getModule,
  items as catalog,
  MODULES,
  moduleCost,
  productionStages,
  recipeOf,
} from "@trove/data";
import type { Item } from "@trove/data";
import {
  expandCost,
  floorBays,
  floorLaneCapacity,
  lineLanes,
  LANES_PER_BAY,
  SLOTS_PER_BAY,
  type Factory as FactoryLine,
} from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** "G&H Holdings" → "G&H Manufacturing": your production division. */
const FIRM_TAIL =
  /\s+(holdings?|capital|group|trading|partners|house|ventures|industries|works|syndicate|trust|llc|inc\.?|firm|exchange|traders|mfg\.?|corp\.?|company|associates|bros\.?|sons|co\.?)$/i;
function manufacturingName(holding: string | null): string {
  if (!holding) return "Trove Manufacturing";
  const base = holding.replace(/\s+/g, " ").trim().replace(FIRM_TAIL, "").trim();
  return `${base || holding} Manufacturing`;
}

/** Short "2× Steel Billet + 1× I-Beam" recipe summary, or "extraction". */
function recipeText(out: Item): string {
  const r = recipeOf(out);
  if (!r || r.inputs.length === 0) return "Extraction · no inputs";
  return r.inputs
    .map((i) => `${i.qty}× ${getItem(i.itemId)?.name ?? "?"}`)
    .join("  +  ");
}

export function Factory() {
  const { mode, state, buildLine, desk } = useTrove();
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<"lines" | "floor">("lines");
  const mfg = manufacturingName(desk?.name ?? null);

  if (mode === "live") {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Factory</h2>
        </div>
        <div className="empty">
          Production lines are coming to the live floor soon. For now, switch to{" "}
          <b>Sandbox</b> to engineer a line, install modules, and watch it run.
        </div>
      </div>
    );
  }

  const full = state.factories.length >= state.floorSlots;

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">{mfg}</h2>
        <div className="fac-cash">
          Cash <b>{money(state.cash)}</b>
        </div>
      </div>

      <div className="fac-tabs">
        <button
          className={view === "lines" ? "on" : ""}
          onClick={() => setView("lines")}
        >
          Lines
        </button>
        <button
          className={view === "floor" ? "on" : ""}
          onClick={() => setView("floor")}
        >
          Floor
        </button>
        <span className="fac-tabnote">
          {state.factories.length}/{state.floorSlots} slots ·{" "}
          {floorBays(state.floorSlots)} bay
          {floorBays(state.floorSlots) > 1 ? "s" : ""}
        </span>
      </div>

      {view === "floor" ? (
        <FloorView mfg={mfg} />
      ) : (
        <>
          <p className="fac-intro">
            Engineer a line: pick a product, then install <b>modules</b> to push
            throughput up, upkeep down, or trim material per unit. Output is
            branded <b>{mfg}</b> and lands in your vault to sell or fill orders.
          </p>

          {state.factories.length === 0 && (
            <div className="empty">
              No lines yet. Build one below — start cheap, then engineer it.
            </div>
          )}

          {state.factories.map((f) => (
            <LineBay key={f.id} f={f} mfg={mfg} />
          ))}

          <button
            className="fac-build"
            onClick={() => (full ? setView("floor") : setPicking(true))}
          >
            {full ? "Floor's full — expand it →" : "＋ Build a new line"}
          </button>
        </>
      )}

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

/** The warehouse view: lines route to shipping bays; belt lanes have capacity,
 *  and overloading them throttles throughput until you scale down or expand. */
function FloorView({ mfg }: { mfg: string }) {
  const { state, expandFloor } = useTrove();
  const slots = state.floorSlots;
  const bays = floorBays(slots);
  const capacity = floorLaneCapacity(slots);

  // Resolve each line's live rate + lanes, and assign lines to bays by order.
  const lines = state.factories.map((f) => {
    const out = state.items.find((i) => i.id === f.itemId);
    const rate = out ? effectiveSpec(out, f.modules).rate : 0;
    const online = state.cycle >= f.onlineCycle;
    return {
      f,
      name: out?.name ?? `#${f.itemId}`,
      rate,
      lanes: lineLanes(rate),
      online,
    };
  });
  const load = lines
    .filter((l) => l.online)
    .reduce((s, l) => s + l.lanes, 0);
  const congested = load > capacity;
  const cost = expandCost(slots);

  // Group lines into bays (SLOTS_PER_BAY lines per bay).
  const bayGroups = Array.from({ length: bays }, (_, b) =>
    lines.filter((_, i) => Math.floor(i / SLOTS_PER_BAY) === b),
  );

  return (
    <div className="floor">
      <p className="fac-intro">
        Your lines ship through <b>{bays}</b> bay{bays > 1 ? "s" : ""}. Each bay
        moves {LANES_PER_BAY} belt lanes; a faster line eats more lanes. Push past
        capacity and the whole floor backs up — scale a line down or expand.
      </p>

      <div className={`floor-load ${congested ? "over" : ""}`}>
        <div className="fl-load-top">
          <span>Belt load</span>
          <span>
            {load} / {capacity} lanes{" "}
            {congested && <b className="fl-alert">⚠ overloaded</b>}
          </span>
        </div>
        <div className="fl-load-bar">
          <i style={{ width: `${Math.min(100, (load / capacity) * 100)}%` }} />
        </div>
        {congested && (
          <div className="fl-load-note">
            Output is throttled to ~{Math.round((capacity / load) * 100)}% across
            all lines until you free up lanes.
          </div>
        )}
      </div>

      {bayGroups.map((group, b) => {
        const bayLoad = group
          .filter((l) => l.online)
          .reduce((s, l) => s + l.lanes, 0);
        const bayOver = bayLoad > LANES_PER_BAY;
        return (
          <div key={b} className={`floor-bay ${bayOver ? "over" : ""}`}>
            <div className="floor-bay-head">
              <span className="floor-bay-name">Bay {b + 1}</span>
              <span className="floor-bay-cap">
                {bayLoad}/{LANES_PER_BAY} lanes {bayOver && "⚠"}
              </span>
            </div>
            {group.length === 0 ? (
              <div className="floor-empty">— open bay —</div>
            ) : (
              group.map((l) => (
                <div key={l.f.id} className="floor-line">
                  <span className="floor-line-name">{l.name}</span>
                  <span className="floor-belt">
                    <span className="cvy-rail" />
                    {l.online &&
                      Array.from({ length: Math.min(4, l.lanes + 1) }).map(
                        (_, i) => (
                          <i
                            key={i}
                            className="cvy-box"
                            style={{
                              animationDuration: "1.4s",
                              animationDelay: `${0.35 * i}s`,
                            }}
                          />
                        ),
                      )}
                  </span>
                  <span className="floor-line-rate">
                    {l.online ? `${l.rate.toLocaleString()}/cy` : "building"} ·{" "}
                    {l.lanes} lane{l.lanes > 1 ? "s" : ""}
                  </span>
                  <Truck size={15} strokeWidth={1.75} className="floor-truck" />
                </div>
              ))
            )}
          </div>
        );
      })}

      <button className="fac-build" onClick={expandFloor}>
        Expand floor · +{SLOTS_PER_BAY} slots · {money(cost)}
      </button>
      <p className="floor-foot">
        {mfg} floor · {state.factories.length}/{slots} slots used · bay upkeep
        scales with size.
      </p>
    </div>
  );
}

function LineBay({ f, mfg }: { f: FactoryLine; mfg: string }) {
  const { state, demolishLine, addModule, removeModule } = useTrove();
  const out = state.items.find((i) => i.id === f.itemId);
  if (!out) return null;

  const base = factorySpec(out);
  const eff = effectiveSpec(out, f.modules);
  const recipe = recipeOf(out);
  const inputs = recipe?.inputs ?? [];

  const building = state.cycle < f.onlineCycle;
  const cyclesLeft = f.onlineCycle - state.cycle;

  // Per-input batch coverage (module input multiplier shifts the need).
  const batch = inputs.map((inp) => {
    const held = state.items.find((i) => i.id === inp.itemId);
    const need = Math.ceil(inp.qty * eff.rate * eff.inputMul);
    return {
      id: inp.itemId,
      name: held?.name ?? `#${inp.itemId}`,
      value: held?.value ?? 0,
      perUnit: inp.qty,
      have: held?.owners["YOU"] ?? 0,
      need,
    };
  });
  const ready = batch.every((b) => b.have >= b.need);
  const status = building ? "building" : ready ? "running" : "idle";
  const coverage = batch.length
    ? Math.min(1, ...batch.map((b) => (b.need ? b.have / b.need : 1)))
    : 1;

  // Cost to make one unit: materials (× input multiplier) + amortised upkeep.
  const matPerUnit =
    batch.reduce((s, b) => s + b.value * b.perUnit, 0) * eff.inputMul;
  const perUnit = matPerUnit + eff.upkeep / eff.rate;
  const sellEa = out.value * (1 + eff.premium);

  // Which installed module badges onto which stage.
  const stages = productionStages(out);
  const processStages = stages.filter((s) => s.kind === "process");
  const badge: Record<string, string[]> = {};
  for (const id of f.modules) {
    const m = getModule(id);
    if (!m) continue;
    let st = stages.find((s) => s.label === m.stage);
    if (!st)
      st =
        m.stage === "Feed"
          ? stages[0]
          : m.stage === "Pack"
            ? stages[stages.length - 1]
            : (processStages[0] ?? stages[0]);
    (badge[st.key] ??= []).push(m.name);
  }

  return (
    <div className={`bay ${status}`}>
      <div className="bay-head">
        <div className="bay-title">
          <span className="bay-mfg">{mfg}</span>
          <Link href={`/item/${out.id}`} className="it-link">
            {out.name}
          </Link>{" "}
          Line
        </div>
        <span className={`bay-status ${status}`}>
          {building
            ? `building · ${cyclesLeft} cy`
            : status === "running"
              ? "● running"
              : "◐ idle"}
        </span>
      </div>

      <Conveyor
        stages={stages}
        rate={eff.rate}
        status={status}
        badge={badge}
      />
      {status === "idle" && (
        <div className="cvy-note">Line stalled — feed it inputs below.</div>
      )}
      {building && (
        <div className="cvy-note">Line under construction — coming online soon.</div>
      )}

      {inputs.length > 0 && (
        <div className="bay-inputs">
          <div className="bay-sub">Feed / cycle</div>
          {batch.map((b) => (
            <div
              key={b.id}
              className={`bay-inp ${b.have >= b.need ? "" : "short"}`}
            >
              <Link href={`/item/${b.id}`} className="it-link">
                {b.name}
              </Link>
              <span className="bay-need">
                {b.have.toLocaleString()} / {b.need.toLocaleString()}
              </span>
            </div>
          ))}
          {!building && !ready && (
            <div className="bay-warn">
              Short on inputs — line idles (upkeep still burns). Buy more on the
              floor.
            </div>
          )}
        </div>
      )}

      <div className="bay-stats">
        <span>
          rate <b>{eff.rate.toLocaleString()}/cy</b>
          {f.modules.length > 0 && (
            <em className="bay-vs"> (base {base.rate.toLocaleString()})</em>
          )}
        </span>
        <span>upkeep {money(eff.upkeep)}/cy</span>
        <span>cost/ea {money(perUnit)}</span>
        <span>sells ≈ {money(sellEa)}/ea</span>
        {eff.premium > 0 && (
          <span className="bay-prem">+{Math.round(eff.premium * 100)}% quality</span>
        )}
      </div>

      <div className="bay-modules">
        <div className="bay-sub">Modules — engineer the line</div>
        <div className="bay-mgrid">
          {MODULES.map((m) => {
            const installed = f.modules.includes(m.id);
            const cost = moduleCost(out, m.id);
            const afford = state.cash >= cost;
            return (
              <button
                key={m.id}
                className={`mod ${installed ? "on" : ""}`}
                disabled={!installed && !afford}
                onClick={() =>
                  installed ? removeModule(f.id, m.id) : addModule(f.id, m.id)
                }
              >
                <span className="mod-name">{m.name}</span>
                <span className="mod-blurb">{m.blurb}</span>
                <span className="mod-cost">
                  {installed ? "✓ installed · remove" : `install ${money(cost)}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bay-foot">
        <button className="fl-demolish" onClick={() => demolishLine(f.id)}>
          Tear down
        </button>
      </div>
    </div>
  );
}

/** The animated assembly line: stations linked by belts with product flowing
 *  Source → … → Pack → 🚚. Belt speed + box count scale with the line's rate;
 *  boxes only flow when the line is running. */
function Conveyor({
  stages,
  rate,
  status,
  badge,
}: {
  stages: { key: string; label: string; kind: "feed" | "process" | "output" }[];
  rate: number;
  status: "building" | "running" | "idle";
  badge: Record<string, string[]>;
}) {
  // Faster belt + more boxes for higher throughput.
  const lg = Math.log10(Math.max(1, rate));
  const dur = Math.max(0.8, Math.min(2.8, 3 - lg * 0.4)); // seconds per box
  const boxes = Math.max(2, Math.min(6, Math.round(lg + 1)));
  const flowing = status === "running";

  const icon = (kind: string) =>
    kind === "feed" ? (
      <Boxes size={16} strokeWidth={1.75} />
    ) : kind === "output" ? (
      <Package size={16} strokeWidth={1.75} />
    ) : (
      <Cog size={16} strokeWidth={1.75} />
    );

  const Belt = () => (
    <div className="cvy-belt">
      <span className="cvy-rail" />
      {flowing &&
        Array.from({ length: boxes }).map((_, b) => (
          <i
            key={b}
            className="cvy-box"
            style={{
              animationDuration: `${dur}s`,
              animationDelay: `${(dur / boxes) * b}s`,
            }}
          />
        ))}
    </div>
  );

  return (
    <div className={`cvy ${status}`}>
      {stages.map((s, i) => (
        <Fragment key={s.key}>
          <div className={`cvy-station ${s.kind}`}>
            <span className="cvy-ic">{icon(s.kind)}</span>
            <span className="cvy-lbl">{s.label}</span>
            {badge[s.key]?.length ? (
              <span className="cvy-dot" title={badge[s.key]!.join(", ")} />
            ) : null}
          </div>
          {i < stages.length - 1 && <Belt />}
        </Fragment>
      ))}
      <Belt />
      <div className="cvy-station bay">
        <span className="cvy-ic">
          <Truck size={16} strokeWidth={1.75} />
        </span>
        <span className="cvy-lbl">
          {flowing ? `${rate.toLocaleString()}/cy` : "Bay"}
        </span>
      </div>
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
          placeholder="Search a product to make…"
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
