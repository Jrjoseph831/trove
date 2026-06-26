"use client";

import { Fragment, useMemo, useRef, useState } from "react";
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
  resolveBay,
  type Factory as FactoryLine,
} from "@trove/engine";
import type { LineModule } from "@trove/data";
import { manufacturingName, money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

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
  const [view, setView] = useState<"lines" | "floor">("lines");
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

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── Isometric helpers ──────────────────────────────────────────────────────
const ISO_HW = 34; // tile half-width
const ISO_HH = 17; // tile half-height
const MACH_DH = 26; // machine block depth
const DOCK_DH = 20; // dock block depth
const isoTop = (cx: number, cy: number, hw = ISO_HW, hh = ISO_HH) =>
  `M ${cx} ${cy - hh} L ${cx + hw} ${cy} L ${cx} ${cy + hh} L ${cx - hw} ${cy} Z`;
const isoLeft = (cx: number, cy: number, dh: number, hw = ISO_HW, hh = ISO_HH) =>
  `M ${cx - hw} ${cy} L ${cx} ${cy + hh} L ${cx} ${cy + hh + dh} L ${cx - hw} ${cy + dh} Z`;
const isoRight = (cx: number, cy: number, dh: number, hw = ISO_HW, hh = ISO_HH) =>
  `M ${cx + hw} ${cy} L ${cx} ${cy + hh} L ${cx} ${cy + hh + dh} L ${cx + hw} ${cy + dh} Z`;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The warehouse, isometric. Each line is a machine block that runs a conveyor
 *  to a shipping dock. Docks have a lane capacity; routing too many lines to one
 *  dock jams it and *throttles their real output* (same math as the engine), so
 *  the floor is where you recover units lost to congestion. Drag a machine onto
 *  another dock to re-route it — or tap it to send it to the next dock. */
function FloorView({ mfg }: { mfg: string }) {
  const { state, factoryCycle, expandFloor, routeLine, buyUpgrade } = useTrove();
  const slots = state.floorSlots;
  const bays = floorBays(slots);
  const perBay = lanesPerBay(state); // includes the Auto-Router upgrade
  const cost = expandCost(slots);

  const lines = state.factories.map((f, i) => {
    const out = state.items.find((it) => it.id === f.itemId);
    const rate = out ? effectiveSpec(out, f.modules).rate : 0;
    const building = factoryCycle < f.onlineCycle;
    return {
      f,
      i,
      name: out?.name ?? `#${f.itemId}`,
      rate,
      lanes: lineLanes(rate),
      bay: resolveBay(f, i, bays),
      building,
      idle: !building && f.status === "idle",
    };
  });

  // Per-dock lane load + congestion throttle (mirrors the engine).
  const bayLoad = new Array<number>(bays).fill(0);
  for (const l of lines) if (!l.building) bayLoad[l.bay]! += l.lanes;
  const bayOver = bayLoad.map((ld) => ld > perBay);
  const throttleOf = (b: number) => {
    const ld = bayLoad[b] ?? 0;
    return ld > perBay ? perBay / ld : 1;
  };
  const realizedOf = (l: (typeof lines)[number]) =>
    l.building ? 0 : Math.floor(l.rate * throttleOf(l.bay));

  // Floor-wide KPIs — potential you built vs what actually ships.
  const potentialTot = lines.reduce((s, l) => s + (l.building ? 0 : l.rate), 0);
  const realizedTot = lines.reduce((s, l) => s + realizedOf(l), 0);
  const lostTot = Math.max(0, potentialTot - realizedTot);
  const usedLanes = bayLoad.reduce((a, b) => a + b, 0);
  const totalLanes = bays * perBay;

  // ── Isometric layout ──────────────────────────────────────────────────────
  const W = 600;
  const ROW = 96;
  const TOP = 86;
  const rows = Math.max(lines.length, bays, 1);
  const H = TOP + rows * ROW + 40;
  const MX = 132; // machine column centre-x
  const DX = 452; // dock column centre-x
  const machY = (i: number) => TOP + i * ROW;
  const dockY = (b: number) => TOP + ((b + 0.5) / bays) * (rows * ROW) - ROW / 2;
  const beltPath = (i: number, b: number) =>
    `M ${MX + ISO_HW} ${machY(i) + ISO_HH * 0.4} L ${DX - ISO_HW} ${dockY(b) + ISO_HH * 0.4}`;
  const flowDur = (rate: number, jam: boolean) =>
    (jam ? 2.6 : 1) *
    Math.max(0.55, Math.min(1.6, 1.8 - Math.log10(Math.max(1, rate)) * 0.26));

  // ── Drag-to-reroute ───────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    const loc = ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    return { x: loc.x, y: loc.y };
  };
  const dockAt = (x: number, y: number) => {
    for (let b = 0; b < bays; b++) {
      const cy = dockY(b);
      if (
        Math.abs(x - DX) < ISO_HW + 16 &&
        y > cy - ISO_HH - 14 &&
        y < cy + ISO_HH + DOCK_DH + 30
      )
        return b;
    }
    return -1;
  };
  const onPointerDownMachine = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const { x, y } = toSvg(e);
    setDrag({ id, x, y, moved: false });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, y } = toSvg(e);
    setDrag((d) =>
      d
        ? { ...d, x, y, moved: d.moved || Math.hypot(x - d.x, y - d.y) > 5 }
        : d,
    );
  };
  const onPointerUp = () => {
    if (!drag) return;
    const line = lines.find((l) => l.f.id === drag.id);
    if (line) {
      const target = dockAt(drag.x, drag.y);
      if (target >= 0 && target !== line.bay) routeLine(drag.id, target);
      else if (!drag.moved && bays > 1)
        routeLine(drag.id, (line.bay + 1) % bays);
    }
    setDrag(null);
  };
  const hotDock = drag ? dockAt(drag.x, drag.y) : -1;

  // Alerts.
  const alerts: string[] = [];
  bayLoad.forEach((ld, b) => {
    if (ld > perBay)
      alerts.push(
        `Dock ${b + 1} jammed — ${ld}/${perBay} lanes, output throttled to ~${Math.round((perBay / ld) * 100)}%`,
      );
  });
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
          <span className="fk-sub">{lostTot > 0 ? "re-route to recover" : "all flowing"}</span>
        </div>
        <div className="fk">
          <span className="fk-lab">Dock lanes</span>
          <span className="fk-val">{usedLanes}<small>/{totalLanes}</small></span>
          <span className="fk-sub">{Math.round((usedLanes / Math.max(1, totalLanes)) * 100)}% used</span>
        </div>
        <div className="fk">
          <span className="fk-lab">Docks</span>
          <span className="fk-val">{bays}</span>
          <span className="fk-sub">{perBay} lanes each</span>
        </div>
      </div>

      <p className="fac-intro">
        <b>Drag a machine onto a dock</b> to re-route it (or tap to send it to the
        next dock). Each dock moves {perBay} lanes — overload one and its lines
        throttle, so spread the load to ship everything you build.
      </p>

      <div className="iso-wrap">
        <svg
          ref={svgRef}
          className="iso"
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* ground plane */}
          <path
            className="iso-ground"
            d={isoTop((MX + DX) / 2, TOP + (rows * ROW) / 2 - 6, (DX - MX) / 2 + 120, (rows * ROW) / 2 + 70)}
          />

          {/* conveyors machine → dock */}
          {lines.map((l) => {
            const jam = !l.building && bayOver[l.bay];
            const cls = l.building ? "build" : l.idle ? "idle" : jam ? "jam" : "run";
            const d = beltPath(l.i, l.bay);
            return (
              <g key={`belt${l.f.id}`}>
                <path className={`iso-belt-base ${cls}`} d={d} fill="none" />
                <path
                  className={`iso-belt-flow ${cls}`}
                  d={d}
                  fill="none"
                  style={
                    cls === "run" || cls === "jam"
                      ? { animationDuration: `${flowDur(l.rate, !!jam)}s` }
                      : undefined
                  }
                />
              </g>
            );
          })}

          {/* docks */}
          {Array.from({ length: bays }).map((_, b) => {
            const cy = dockY(b);
            const jam = bayOver[b];
            const hot = hotDock === b;
            const fill = Math.min(1, (bayLoad[b] ?? 0) / Math.max(1, perBay));
            return (
              <g key={`dock${b}`} className={`iso-dock ${jam ? "jam" : ""} ${hot ? "hot" : ""}`}>
                <path className="iso-face-l dock" d={isoLeft(DX, cy, DOCK_DH)} />
                <path className="iso-face-r dock" d={isoRight(DX, cy, DOCK_DH)} />
                <path className="iso-face-t dock" d={isoTop(DX, cy)} />
                <text x={DX} y={cy - 1} className="iso-truck" textAnchor="middle">🚚</text>
                <text x={DX} y={cy + ISO_HH + DOCK_DH + 14} className="iso-name" textAnchor="middle">
                  Dock {b + 1}
                </text>
                {/* lane capacity bar */}
                <rect x={DX - 30} y={cy + ISO_HH + DOCK_DH + 20} width={60} height={6} rx={3} className="iso-cap" />
                <rect
                  x={DX - 30}
                  y={cy + ISO_HH + DOCK_DH + 20}
                  width={60 * fill}
                  height={6}
                  rx={3}
                  className={`iso-cap-fill ${jam ? "jam" : ""}`}
                />
                <text x={DX} y={cy + ISO_HH + DOCK_DH + 38} className={`iso-sub ${jam ? "jam" : ""}`} textAnchor="middle">
                  {bayLoad[b] ?? 0}/{perBay} lanes {jam ? "⚠" : ""}
                </text>
              </g>
            );
          })}

          {/* machines */}
          {lines.map((l) => {
            const dragging = drag?.id === l.f.id;
            const cx = dragging ? drag!.x : MX;
            const cy = dragging ? drag!.y : machY(l.i);
            const jam = !l.building && bayOver[l.bay];
            const cls = l.building ? "build" : l.idle ? "idle" : jam ? "jam" : "run";
            const realized = realizedOf(l);
            return (
              <g
                key={`mach${l.f.id}`}
                className={`iso-machine ${cls} ${dragging ? "dragging" : ""}`}
                onPointerDown={(e) => onPointerDownMachine(e, l.f.id)}
              >
                <path className={`iso-face-l ${cls}`} d={isoLeft(cx, cy, MACH_DH)} />
                <path className={`iso-face-r ${cls}`} d={isoRight(cx, cy, MACH_DH)} />
                <path className={`iso-face-t ${cls}`} d={isoTop(cx, cy)} />
                <Cog x={cx - 8} y={cy - 9} size={16} strokeWidth={1.75} className="iso-cog" />
                <text x={cx} y={cy + ISO_HH + MACH_DH + 13} className="iso-name" textAnchor="middle">
                  {clip(l.name, 16)}
                </text>
                <text x={cx} y={cy + ISO_HH + MACH_DH + 27} className={`iso-sub ${jam ? "jam" : ""}`} textAnchor="middle">
                  {l.building
                    ? "building…"
                    : l.idle
                      ? "stalled"
                      : `${realized.toLocaleString()}/cy${jam ? ` · −${(l.rate - realized).toLocaleString()}` : ""} → Dock ${l.bay + 1}`}
                </text>
              </g>
            );
          })}
        </svg>
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

      <div className="bay-econ">
        <div className="be-head">Per cycle · every ~5 min</div>
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
