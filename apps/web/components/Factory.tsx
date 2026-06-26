"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Cog, Package, Truck } from "lucide-react";
import {
  canProduce,
  effectiveSpec,
  factorySpec,
  getItem,
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
  INFRA_UPGRADES,
  lanesPerBay,
  lineLanes,
  listedUnitPrice,
  type Factory as FactoryLine,
} from "@trove/engine";
import type { LineModule } from "@trove/data";
import { manufacturingName, money } from "@/lib/format";
import { useTrove } from "@/lib/trove";
import { WarehouseLab } from "@/components/WarehouseLab";

/** A module effect as a color-coded chip: an up/down arrow, a metric, and whether
 *  it's good or bad for the player. */
interface ModChip {
  label: string;
  text: string;
  up: boolean;
  good: boolean;
}
const pctText = (mul: number): string => {
  if (mul >= 2) return `×${mul}`;
  const pct = Math.round((mul - 1) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
};

/** Per-unit price with enough precision for sub-cent commodity goods, so a real
 *  cost of $0.004 doesn't render as a broken "$0.00". */
function unitMoney(v: number): string {
  if (v <= 0) return "$0";
  if (v >= 1) return money(v);
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  if (v >= 0.001) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}
function moduleChips(m: LineModule): ModChip[] {
  const chips: ModChip[] = [];
  if (m.rateMul !== 1)
    chips.push({ label: "Output", text: pctText(m.rateMul), up: m.rateMul > 1, good: m.rateMul > 1 });
  if (m.upkeepMul !== 1)
    chips.push({ label: "Upkeep", text: pctText(m.upkeepMul), up: m.upkeepMul > 1, good: m.upkeepMul < 1 });
  if (m.inputMul !== 1)
    chips.push({ label: "Inputs", text: pctText(m.inputMul), up: m.inputMul > 1, good: m.inputMul < 1 });
  if (m.premium > 0)
    chips.push({ label: "Sells", text: `+${Math.round(m.premium * 100)}%`, up: true, good: true });
  return chips;
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
  const { state, buildLine, desk } = useTrove();
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<"lines" | "floor" | "lab">("lines");
  const mfg = manufacturingName(desk?.name ?? null);

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
        <button
          className={view === "lab" ? "on" : ""}
          onClick={() => setView("lab")}
        >
          Lab 🧪
        </button>
        <span className="fac-tabnote">
          {state.factories.length}/{state.floorSlots} slots ·{" "}
          {floorBays(state.floorSlots)} bay
          {floorBays(state.floorSlots) > 1 ? "s" : ""}
        </span>
      </div>

      {view === "floor" ? (
        <FloorView mfg={mfg} />
      ) : view === "lab" ? (
        <WarehouseLab />
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

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The warehouse as a loading-dock command center. Output ships across ALL docks
 *  at once — one shared lane pool — so a line throttles only when *total*
 *  production out-runs *total* dock capacity, then everything slows together.
 *  The floor is a capacity dashboard: watch "lost to jams" and add docks /
 *  Auto-Router to clear it. */
function FloorView({ mfg }: { mfg: string }) {
  const { state, factoryCycle, expandFloor, buyUpgrade } = useTrove();
  const slots = state.floorSlots;
  const bays = floorBays(slots);
  const perBay = lanesPerBay(state); // lanes per dock, incl. Auto-Router
  const cost = expandCost(slots);
  const totalLanes = bays * perBay;

  const lines = state.factories.map((f) => {
    const out = state.items.find((it) => it.id === f.itemId);
    const rate = out ? effectiveSpec(out, f.modules).rate : 0;
    const building = factoryCycle < f.onlineCycle;
    return {
      f,
      name: out?.name ?? `#${f.itemId}`,
      rate,
      lanes: lineLanes(rate),
      building,
      idle: !building && f.status === "idle",
    };
  });

  // Pooled congestion: demand vs the WHOLE floor's lanes (mirrors the engine).
  const demandLanes = lines.reduce((s, l) => s + (l.building ? 0 : l.lanes), 0);
  const overCap = demandLanes > totalLanes;
  const floorThrottle = overCap ? totalLanes / demandLanes : 1;
  const throttlePct = Math.round(floorThrottle * 100);
  const realizedOf = (l: (typeof lines)[number]) =>
    l.building ? 0 : Math.floor(l.rate * floorThrottle);

  // KPIs — potential you built vs what actually ships.
  const potentialTot = lines.reduce((s, l) => s + (l.building ? 0 : l.rate), 0);
  const realizedTot = lines.reduce((s, l) => s + realizedOf(l), 0);
  const lostTot = Math.max(0, potentialTot - realizedTot);

  // Visual fill — output spreads EVENLY across every dock (least-full first), so
  // a single line lights up all docks rather than packing into one. Anything
  // past total capacity is the overflow that gets throttled away.
  const dockUsed = new Array<number>(bays).fill(0);
  let placed = 0;
  while (placed < demandLanes) {
    let best = -1;
    for (let b = 0; b < bays; b++) {
      if (dockUsed[b]! >= perBay) continue;
      if (best < 0 || dockUsed[b]! < dockUsed[best]!) best = b;
    }
    if (best < 0) break; // every dock full → the rest is overflow
    dockUsed[best]!++;
    placed++;
  }
  const overflow = Math.max(0, demandLanes - placed);
  const anyRunning = lines.some((l) => !l.building && !l.idle);
  const beltCls = overCap ? "jam" : anyRunning ? "run" : "idle";

  // Alerts.
  const alerts: string[] = [];
  if (overCap)
    alerts.push(
      `Floor over capacity — ${demandLanes}/${totalLanes} dock lanes in use, so every line throttles to ~${throttlePct}%. Add Auto-Router or expand the floor.`,
    );
  for (const l of lines)
    if (l.idle) alerts.push(`${l.name} line stalled — feed it inputs`);

  return (
    <div className="floor">
      <div className="floor-kpis">
        <div className="fk">
          <span className="fk-lab">Shipping</span>
          <span className="fk-val">{realizedTot.toLocaleString()}<small>/cy</small></span>
          <span className="fk-sub">of {potentialTot.toLocaleString()} built</span>
        </div>
        <div className={`fk ${lostTot > 0 ? "lost" : ""}`}>
          <span className="fk-lab">Lost to jams</span>
          <span className="fk-val">
            {lostTot > 0 ? `−${lostTot.toLocaleString()}` : "none"}
            {lostTot > 0 ? <small>/cy</small> : null}
          </span>
          <span className="fk-sub">{lostTot > 0 ? "add dock capacity" : "all flowing"}</span>
        </div>
        <div className={`fk ${overCap ? "lost" : ""}`}>
          <span className="fk-lab">Floor lanes</span>
          <span className="fk-val">{demandLanes}<small>/{totalLanes}</small></span>
          <span className="fk-sub">
            {overCap
              ? "over capacity"
              : `${Math.round((demandLanes / Math.max(1, totalLanes)) * 100)}% used`}
          </span>
        </div>
        <div className="fk">
          <span className="fk-lab">Docks</span>
          <span className="fk-val">{bays}</span>
          <span className="fk-sub">{perBay} lanes each</span>
        </div>
      </div>

      <p className="fac-intro">
        Output ships across <b>all {bays} dock{bays > 1 ? "s" : ""} at once</b> — one
        shared pool of {totalLanes} lanes. A line only slows when total production
        out-runs the whole floor; then every line throttles together. Add capacity
        to recover what you lose.
      </p>

      <div className="cc">
        <div className="cc-col cc-lines">
          <div className="cc-col-head">Lines</div>
          {lines.length === 0 && (
            <div className="cc-empty">No lines yet — build one on the Lines tab.</div>
          )}
          {lines.map((l) => {
            const cls = l.building ? "build" : l.idle ? "idle" : overCap ? "jam" : "run";
            const realized = realizedOf(l);
            const throttled = !l.building && !l.idle && realized < l.rate;
            return (
              <div key={l.f.id} className={`cc-line ${cls}`}>
                <span className="cc-line-ic">
                  <Cog size={15} strokeWidth={1.75} />
                </span>
                <div className="cc-line-body">
                  <span className="cc-line-name">{clip(l.name, 22)}</span>
                  <span className="cc-line-stat">
                    {l.building ? (
                      "building…"
                    ) : l.idle ? (
                      "stalled — no inputs"
                    ) : (
                      <>
                        {realized.toLocaleString()}
                        <small>/cy</small>
                        {throttled && <em> of {l.rate.toLocaleString()}</em>}
                      </>
                    )}
                  </span>
                </div>
                <span className="cc-line-lanes">
                  {l.lanes}
                  <small>×</small>
                </span>
              </div>
            );
          })}
        </div>

        <div className={`cc-belt ${beltCls}`}>
          <span className="cc-belt-track" />
          <span className="cc-belt-cap">{realizedTot.toLocaleString()}/cy</span>
        </div>

        <div className="cc-col cc-docks">
          <div className="cc-col-head">Shipping docks</div>
          {Array.from({ length: bays }).map((_, b) => {
            const used = dockUsed[b] ?? 0;
            const full = used >= perBay && overCap;
            return (
              <div key={b} className={`cc-dock ${full ? "jam" : used > 0 ? "run" : ""}`}>
                <span className="cc-dock-truck">🚚</span>
                <div className="cc-dock-body">
                  <span className="cc-dock-name">Dock {b + 1}</span>
                  <div className="cc-dock-bar">
                    <i
                      className={full ? "jam" : ""}
                      style={{ width: `${(used / Math.max(1, perBay)) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="cc-dock-cap">
                  {used}/{perBay}
                </span>
              </div>
            );
          })}
          {overflow > 0 && (
            <div className="cc-dock overflow">
              <span className="cc-dock-truck">⚠</span>
              <div className="cc-dock-body">
                <span className="cc-dock-name">
                  No dock for {overflow} lane{overflow > 1 ? "s" : ""}
                </span>
                <span className="cc-dock-over">throttled to ~{throttlePct}%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="wh-alerts">
          {alerts.map((a, i) => (
            <div key={i} className="wh-alert">
              ⚠ {a}
            </div>
          ))}
        </div>
      )}

      <button className="fac-build" onClick={expandFloor}>
        Expand floor · +2 slots · {money(cost)}
      </button>

      <div className="floor-infra">
        <div className="bay-sub">Floor upgrades — one-time, floor-wide</div>
        <div className="fi-grid">
          {INFRA_UPGRADES.map((u) => {
            const owned = state.infra[u.id];
            const afford = state.cash >= u.cost;
            return (
              <button
                key={u.id}
                className={`fi-card ${owned ? "on" : ""}`}
                disabled={owned || !afford}
                onClick={() => buyUpgrade(u.id)}
              >
                <span className="fi-name">{u.name}</span>
                <span className="fi-blurb">{u.blurb}</span>
                <span className="fi-cost">
                  {owned ? "✓ installed" : `install ${money(u.cost)}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="floor-foot">
        {mfg} floor · {state.factories.length}/{slots} slots used · {bays} dock
        {bays > 1 ? "s" : ""} · dock upkeep scales with size.
      </p>
    </div>
  );
}

function LineBay({ f, mfg }: { f: FactoryLine; mfg: string }) {
  const {
    state,
    factoryCycle,
    demolishLine,
    addModule,
    removeModule,
    setLineSource,
    setSellPrice,
  } = useTrove();
  const out = state.items.find((i) => i.id === f.itemId);
  if (!out) return null;

  const base = factorySpec(out);
  const eff = effectiveSpec(out, f.modules);
  const recipe = recipeOf(out);
  const inputs = recipe?.inputs ?? [];

  const building = factoryCycle < f.onlineCycle;
  const cyclesLeft = f.onlineCycle - factoryCycle;

  // Floor congestion (pooled, mirrors the engine): this line ships slower only
  // when total production out-runs total dock lanes. Surface it so the Lines
  // page tells the same truth as the Floor instead of bragging the full rate.
  const floorLanes = floorBays(state.floorSlots) * lanesPerBay(state);
  const floorDemand = state.factories.reduce((s, x) => {
    const xo = state.items.find((it) => it.id === x.itemId);
    if (!xo || factoryCycle < x.onlineCycle) return s;
    return s + lineLanes(effectiveSpec(xo, x.modules).rate);
  }, 0);
  const floorThrottle = floorDemand > floorLanes ? floorLanes / floorDemand : 1;
  const shipRate = Math.floor(eff.rate * floorThrottle);
  const throttled = !building && shipRate < eff.rate;
  const throttlePct = Math.round(floorThrottle * 100);

  // Per-input: where it's sourced (a feeder line in-house, or the market), what
  // it costs per unit there, and feeder options the player owns.
  const batch = inputs.map((inp) => {
    const held = state.items.find((i) => i.id === inp.itemId);
    const need = Math.ceil(inp.qty * eff.rate * eff.inputMul);
    const feederId = f.sources?.[inp.itemId];
    const feeder = feederId
      ? state.factories.find((x) => x.id === feederId)
      : undefined;
    const inHouse = !!feeder;
    // In-house unit cost ≈ the feeder's marginal cost (upkeep / its rate);
    // market unit cost = the live price.
    const fSpec = feeder
      ? effectiveSpec(
          state.items.find((i) => i.id === feeder.itemId) ?? out,
          feeder.modules,
        )
      : null;
    const unitCost =
      inHouse && fSpec ? fSpec.upkeep / fSpec.rate : (held?.value ?? 0);
    const feeders = state.factories.filter(
      (x) => x.itemId === inp.itemId && x.id !== f.id,
    );
    return {
      id: inp.itemId,
      name: held?.name ?? `#${inp.itemId}`,
      value: held?.value ?? 0,
      perUnit: inp.qty,
      have: held?.owners["YOU"] ?? 0,
      need,
      inHouse,
      feederId: feederId ?? null,
      unitCost,
      feeders,
    };
  });
  // Run-readiness mirrors the engine: in-house needs vault stock; market
  // auto-buys the shortfall (so it just needs cash).
  let cashCost = 0;
  let canRun = true;
  for (const b of batch) {
    if (b.inHouse) {
      if (b.have < b.need) canRun = false;
    } else {
      cashCost += Math.max(0, b.need - b.have) * b.value;
    }
  }
  const ready = canRun && state.cash >= cashCost;
  const status = building ? "building" : ready ? "running" : "idle";

  // Cost to make one unit: per-input source cost (× input multiplier) + upkeep.
  const matPerUnit =
    batch.reduce((s, b) => s + b.unitCost * b.perUnit, 0) * eff.inputMul;
  const perUnit = matPerUnit + eff.upkeep / eff.rate;
  // What a unit actually sells for (market × your markup × QC infra), and the
  // line's profit per cycle + margin — the numbers that matter, made the hero.
  const sellMult = state.listPrices?.[out.id] ?? 1;
  const sellPrice = listedUnitPrice(out.value, sellMult, !!state.infra?.qc);
  const profitEa = sellPrice - perUnit;
  const profitCy = profitEa * eff.rate;
  const margin = sellPrice > 0 ? profitEa / sellPrice : 0;

  // Per-stage live status. Source is the only stage that can actually fail
  // (run out of inputs); Mill/Pack simply light up when the line is running.
  //  good  = stocked / flowing
  //  warn  = sourcing the gap (buying short inputs) — the "changing" state
  //  bad   = out of stock, line stalled
  //  idle  = not running (building or stalled downstream)
  const stages = productionStages(out);
  const anyShort = batch.some((b) => b.have < b.need);
  const feedStat: CvyStat = building
    ? "idle"
    : !ready
      ? "bad"
      : anyShort
        ? "warn"
        : "good";
  const flowStat: CvyStat = status === "running" ? "good" : "idle";
  const stageStat: Record<string, CvyStat> = {};
  for (const s of stages) {
    stageStat[s.key] = s.kind === "feed" ? feedStat : flowStat;
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
        stageStat={stageStat}
      />
      {status === "idle" && (
        <div className="cvy-note">Line stalled — feed it inputs below.</div>
      )}
      {building && (
        <div className="cvy-note">Line under construction — coming online soon.</div>
      )}

      {inputs.length > 0 && (
        <div className="bay-inputs">
          <div className="bay-sub">Feed / cycle · source</div>
          {batch.map((b) => {
            const short = b.inHouse && b.have < b.need;
            return (
              <div key={b.id} className={`bay-inp ${short ? "short" : ""}`}>
                <Link href={`/item/${b.id}`} className="it-link">
                  {b.name}
                </Link>
                <select
                  className="bay-src"
                  value={b.feederId ?? "market"}
                  onChange={(e) =>
                    setLineSource(
                      f.id,
                      b.id,
                      e.target.value === "market" ? null : e.target.value,
                    )
                  }
                >
                  <option value="market">Market · {money(b.value)}/ea</option>
                  {b.feeders.map((fd) => (
                    <option key={fd.id} value={fd.id}>
                      In-house · my line
                    </option>
                  ))}
                </select>
                <span className="bay-need">
                  {b.inHouse
                    ? `${b.have.toLocaleString()} / ${b.need.toLocaleString()}`
                    : `${b.need.toLocaleString()}/cy`}
                </span>
              </div>
            );
          })}
          {!building && !ready && (
            <div className="bay-warn">
              Line idles — an in-house feeder can&apos;t keep up, or not enough
              cash to buy market inputs.
            </div>
          )}
          {batch.some((b) => b.feeders.length > 0) && (
            <div className="bay-srchint">
              Tip: source an input from your own line to skip the market markup.
            </div>
          )}
        </div>
      )}

      {throttled && (
        <div className="bay-throttle">
          ⚠ Floor jammed — actually shipping{" "}
          <b>{shipRate.toLocaleString()}/cy</b> of {eff.rate.toLocaleString()} (
          {throttlePct}%). Add dock capacity on the <b>Floor</b> to recover.
        </div>
      )}

      <div className="bay-econ">
        <div className="be-head">
          Per cycle · every ~5 min{throttled ? " · potential" : ""}
        </div>
        <div className="be-grid">
          <div className="be-cell">
            <span className="be-lab">Output</span>
            <span className="be-val">
              {eff.rate.toLocaleString()}
              <small>/cy</small>
            </span>
            {f.modules.length > 0 && (
              <span className="be-sub">base {base.rate.toLocaleString()}</span>
            )}
          </div>
          <div className="be-cell">
            <span className="be-lab">Sells</span>
            <span className="be-val">
              {unitMoney(sellPrice)}
              <small>/ea</small>
            </span>
          </div>
          <div className="be-cell">
            <span className="be-lab">Cost to make</span>
            <span className="be-val">
              {unitMoney(perUnit)}
              <small>/ea</small>
            </span>
          </div>
          <div className="be-cell hero">
            <span className="be-lab">Profit</span>
            <span className={`be-val ${profitCy >= 0 ? "pos" : "neg"}`}>
              {profitCy >= 0 ? "+" : ""}
              {money(profitCy)}
              <small>/cy</small>
            </span>
            <span className="be-sub">{Math.round(margin * 100)}% margin</span>
          </div>
        </div>
      </div>

      {(() => {
        const mult = state.listPrices[out.id] ?? 1;
        const pct = Math.round((mult - 1) * 100);
        return (
          <div className="bay-price">
            <span className="bay-sub">Your sell price — what orders anchor to</span>
            <div className="bp-row">
              <button
                className="bp-btn"
                onClick={() => setSellPrice(out.id, mult - 0.05)}
              >
                −
              </button>
              <span className="bp-val">
                {unitMoney(out.value * mult)}
                <small>/ea</small>
              </span>
              <button
                className="bp-btn"
                onClick={() => setSellPrice(out.id, mult + 0.05)}
              >
                +
              </button>
              <span className="bp-mkt">
                market {unitMoney(out.value)} · {pct >= 0 ? "+" : ""}
                {pct}%
              </span>
            </div>
          </div>
        );
      })()}

      <div className="bay-modules">
        <div className="bay-sub">Upgrades — engineer the line</div>
        <div className="modcard-grid">
          {MODULES.map((m) => {
            const installed = f.modules.includes(m.id);
            const cost = moduleCost(out, m.id);
            const afford = state.cash >= cost;
            const chips = moduleChips(m);
            const afterRate = Math.round(eff.rate * m.rateMul);
            return (
              <div key={m.id} className={`modcard ${installed ? "on" : ""}`}>
                <div className="mc-top">
                  <span className="mc-name">{m.name}</span>
                  {installed ? (
                    <span className="mc-tag">✓ installed</span>
                  ) : (
                    <span className="mc-cost">{money(cost)}</span>
                  )}
                </div>
                <p className="mc-desc">{m.desc}</p>
                <div className="mc-chips">
                  {chips.map((c, i) => (
                    <span key={i} className={`mc-chip ${c.good ? "good" : "bad"}`}>
                      {c.up ? "▲" : "▼"} {c.label} {c.text}
                    </span>
                  ))}
                </div>
                <div className="mc-foot">
                  {!installed && m.rateMul !== 1 && (
                    <span className="mc-prev">
                      {eff.rate.toLocaleString()} → <b>{afterRate.toLocaleString()}</b>/cy
                    </span>
                  )}
                  <button
                    className={`mc-btn ${installed ? "remove" : ""}`}
                    disabled={!installed && !afford}
                    onClick={() =>
                      installed ? removeModule(f.id, m.id) : addModule(f.id, m.id)
                    }
                  >
                    {installed ? "Remove" : afford ? "Install" : "Can't afford"}
                  </button>
                </div>
              </div>
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

/** A stage's live status: green flowing, amber sourcing, red stalled, gray idle. */
type CvyStat = "good" | "warn" | "bad" | "idle";

const STAT_TIP: Record<CvyStat, { feed: string; flow: string }> = {
  good: { feed: "Fully stocked", flow: "Running" },
  warn: { feed: "Sourcing short inputs", flow: "Running" },
  bad: { feed: "Out of stock — stalled", flow: "Idle" },
  idle: { feed: "Idle", flow: "Idle" },
};

/** The assembly line: stations linked by a belt with product flowing
 *  Source → … → Pack → 🚚. The belt is one transform-driven track (boxes are
 *  glued to it, so they ride at a single speed with a seamless loop — no
 *  flicker, no back-and-forth). Each station carries a status dot that maps to
 *  real mechanics. Belt speed + box count scale with the line's rate. */
function Conveyor({
  stages,
  rate,
  status,
  stageStat,
}: {
  stages: { key: string; label: string; kind: "feed" | "process" | "output" }[];
  rate: number;
  status: "building" | "running" | "idle";
  stageStat: Record<string, CvyStat>;
}) {
  // Faster belt + more boxes for higher throughput.
  const lg = Math.log10(Math.max(1, rate));
  const beltDur = Math.max(0.9, Math.min(3.2, 3.4 - lg * 0.45)); // s per loop
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

  // One carriage of N boxes, doubled so a translateX(-50% → 0) loops seamlessly.
  const Belt = () => (
    <div className="cvy-belt">
      <div
        className="cvy-flow"
        style={flowing ? { animationDuration: `${beltDur}s` } : undefined}
      >
        {[0, 1].map((half) => (
          <span className="cvy-half" key={half} aria-hidden>
            {Array.from({ length: boxes }).map((_, b) => (
              <i className="cvy-box" key={b} />
            ))}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`cvy ${status}`}>
      {stages.map((s, i) => {
        const st = stageStat[s.key] ?? "idle";
        const tip = s.kind === "feed" ? STAT_TIP[st].feed : STAT_TIP[st].flow;
        return (
          <Fragment key={s.key}>
            <div className={`cvy-station ${s.kind}`}>
              <span className="cvy-ic">{icon(s.kind)}</span>
              <span className={`cvy-dot ${st}`} title={`${s.label}: ${tip}`} />
              <span className="cvy-lbl">{s.label}</span>
            </div>
            {i < stages.length - 1 && <Belt />}
          </Fragment>
        );
      })}
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

// One entry per PRODUCT (name), cheapest-base representative — you build "a
// Flatware Set", not a specific brand's SKU. Production is matched by product.
const PRODUCIBLE: Item[] = (() => {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of catalog.filter(canProduce).sort((a, b) => a.base - b.base)) {
    const key = it.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
})();

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
