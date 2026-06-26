"use client";

import { useState } from "react";
import { Cog } from "lucide-react";
import { effectiveSpec } from "@trove/data";
import {
  expandCost,
  floorBays,
  INFRA_UPGRADES,
  lanesPerBay,
  lineLanes,
} from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The Live Factory Floor (after Joe's mockup). Top-down view, as if the roof
 *  were peeled back: an inbound door on the left wall feeds a central junction;
 *  belts branch straight into the shipping-dock doors on the right wall. Doors
 *  face the warehouse interior (inbound faces right, docks face left) — never
 *  flat-to-the-sky. Belt colour is live throughput health: green flowing, bronze
 *  slowing (≥85% of floor lanes), red jammed. No forklift / staging clutter. */
export function FactoryFloor({ mfg }: { mfg: string }) {
  const { state, factoryCycle, expandFloor, buyUpgrade } = useTrove();
  const slots = state.floorSlots;
  const docks = floorBays(slots);
  const perBay = lanesPerBay(state);
  const cost = expandCost(slots);
  const totalLanes = docks * perBay;

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

  // Pooled congestion (mirrors the engine).
  const demand = lines.reduce((s, l) => s + (l.building ? 0 : l.lanes), 0);
  const overCap = demand > totalLanes;
  const throttle = overCap ? totalLanes / demand : 1;
  const realizedOf = (l: (typeof lines)[number]) =>
    l.building ? 0 : Math.floor(l.rate * throttle);
  const potentialTot = lines.reduce((s, l) => s + (l.building ? 0 : l.rate), 0);
  const realizedTot = lines.reduce((s, l) => s + realizedOf(l), 0);
  const lostTot = Math.max(0, potentialTot - realizedTot);
  const util = totalLanes > 0 ? demand / totalLanes : 0;
  const anyRunning = lines.some((l) => !l.building && !l.idle);

  // Even per-dock fill (least-full first) so one line lights every dock.
  const dockUsed = new Array<number>(docks).fill(0);
  let placed = 0;
  while (placed < demand) {
    let best = -1;
    for (let b = 0; b < docks; b++) {
      if (dockUsed[b]! >= perBay) continue;
      if (best < 0 || dockUsed[b]! < dockUsed[best]!) best = b;
    }
    if (best < 0) break;
    dockUsed[best]!++;
    placed++;
  }

  // Belt health → colour.
  const health: "flow" | "slow" | "jam" = !anyRunning
    ? "flow"
    : overCap
      ? "jam"
      : util >= 0.85
        ? "slow"
        : "flow";
  const beltDur = health === "jam" ? 2.6 : health === "slow" ? 1.5 : 1.05;

  const dockState = (used: number) => {
    const r = used / Math.max(1, perBay);
    if (r >= 1) return { cls: "full", label: "FULL" };
    if (r >= 0.6) return { cls: "warn", label: "BUSY" };
    if (used > 0) return { cls: "good", label: "OPEN" };
    return { cls: "idle", label: "IDLE" };
  };
  const fullDock = dockUsed.findIndex((u) => u >= perBay);

  // ── Selection (click a line or dock to highlight its route) ─────────────────
  const [sel, setSel] = useState<"line" | number>("line");

  // ── SVG geometry ────────────────────────────────────────────────────────────
  const VB_W = 720;
  const VB_H = 440;
  const WH = { x: 40, y: 46, w: 624, h: 350 };
  const CY = WH.y + WH.h / 2; // 221
  const INX = 52; // inbound wall x
  const BELT_X0 = 72; // belt leaves inbound here
  const JUNC = { x: 300, y: CY };
  const WALLX = 626; // right wall (dock doors)
  const DOOR_IN = WALLX - 12; // belt enters the dock opening here

  const RIGHT_SLOTS = Math.max(4, docks + 2);
  const startActive = Math.floor((RIGHT_SLOTS - docks) / 2);
  const slotY = (i: number) =>
    WH.y + 44 + (i * (WH.h - 88)) / Math.max(1, RIGHT_SLOTS - 1);
  // active dock j (0..docks-1) lives in wall slot startActive + j
  const dockSlot = (j: number) => startActive + j;

  const mainD = `M ${BELT_X0} ${CY} L ${JUNC.x} ${CY}`;
  const branchD = (j: number) =>
    `M ${JUNC.x} ${CY} L 472 ${slotY(dockSlot(j))} L ${DOOR_IN} ${slotY(dockSlot(j))}`;

  const projected = `${realizedTot.toLocaleString()}/cy`;
  const bottleneck = overCap
    ? "Floor over capacity"
    : fullDock >= 0
      ? `Dock ${fullDock + 1} full`
      : "none";

  return (
    <div className="fl2">
      {/* KPI strip */}
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
          <span className="fk-val">{demand}<small>/{totalLanes}</small></span>
          <span className="fk-sub">
            {overCap ? "over capacity" : `${Math.round(util * 100)}% used`}
          </span>
        </div>
        <div className="fk">
          <span className="fk-lab">Docks</span>
          <span className="fk-val">{docks}</span>
          <span className="fk-sub">{perBay} lanes each</span>
        </div>
      </div>

      <p className="fac-intro">
        Output ships across <b>all {docks} dock{docks > 1 ? "s" : ""} at once</b> — one
        shared pool of {totalLanes} lanes. A line only slows when total production
        out-runs the whole floor. Click a dock or line to highlight its route.
      </p>

      <div className="fl2-dash">
        {/* LEFT: lines + docks + capacity */}
        <div className="fl2-left">
          <div className="section-sub">Lines + shipping docks</div>
          <div className="fl2-linedock">
            <div className="fl2-lines">
              {lines.length === 0 && (
                <div className="fl2-empty">No lines yet — build one on the Lines tab.</div>
              )}
              {lines.map((l) => {
                const realized = realizedOf(l);
                const throttled = !l.building && !l.idle && realized < l.rate;
                return (
                  <button
                    key={l.f.id}
                    className={`fl2-line ${sel === "line" ? "sel" : ""}`}
                    onClick={() => setSel("line")}
                  >
                    <span className="fl2-gear"><Cog size={15} strokeWidth={1.75} /></span>
                    <span className="fl2-line-body">
                      <span className="fl2-line-name">{clip(l.name, 24)}</span>
                      <span className="fl2-line-rate">
                        {l.building
                          ? "building…"
                          : l.idle
                            ? "stalled — no inputs"
                            : `${realized.toLocaleString()}/cy · routes to ${docks} dock${docks > 1 ? "s" : ""}${throttled ? ` · of ${l.rate.toLocaleString()}` : ""}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="fl2-docks">
              {Array.from({ length: docks }).map((_, j) => {
                const used = dockUsed[j] ?? 0;
                const st = dockState(used);
                return (
                  <button
                    key={j}
                    className={`fl2-dock ${st.cls} ${sel === j ? "sel" : ""}`}
                    onClick={() => setSel(j)}
                  >
                    <span className="fl2-dock-top">
                      <span>🚚 Dock {j + 1}</span>
                      <span className="fl2-dock-cap">{used}/{perBay}</span>
                    </span>
                    <span className="fl2-bar">
                      <i style={{ width: `${(used / Math.max(1, perBay)) * 100}%` }} />
                    </span>
                    <span className="fl2-state">{st.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

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
            {mfg} floor · {state.factories.length}/{slots} slots used · {docks} dock
            {docks > 1 ? "s" : ""} · dock upkeep scales with size.
          </p>
        </div>

        {/* RIGHT: the live factory floor */}
        <div className="fl2-right">
          <div className="fl2-card">
            <div className="fl2-head">
              <div>
                <h2>Live Factory Floor</h2>
                <p>Belts route from the inbound door straight to each shipping dock.</p>
              </div>
              <span className={`fl2-pill ${overCap ? "jam" : ""}`}>
                {overCap ? "⚠ Jam Status: over capacity" : "✅ Jam Status: Clear"}
              </span>
            </div>

            <div className="fl2-svgwrap">
              <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="fl2-svg">
                <rect className="wh2" x={WH.x} y={WH.y} width={WH.w} height={WH.h} rx={18} />

                <text className="fl2-lab" x={150} y={32}>PRODUCTION SOURCE</text>
                <text className="fl2-lab" x={355} y={32}>BELT ROUTING</text>
                <text className="fl2-lab" x={566} y={32}>SHIPPING BAYS</text>

                {/* belts (only when something runs) */}
                {anyRunning && (
                  <>
                    <path className="fb-base" d={mainD} fill="none" />
                    <path
                      className={`fb ${health}`}
                      d={mainD}
                      fill="none"
                      style={{ animationDuration: `${beltDur}s` }}
                    />
                    {Array.from({ length: docks }).map((_, j) => {
                      const d = branchD(j);
                      const mark =
                        sel === j ? "sel" : typeof sel === "number" ? "dim" : "";
                      return (
                        <g key={`br${j}`}>
                          <path className="fb-base" d={d} fill="none" />
                          <path
                            className={`fb ${health} ${mark}`}
                            d={d}
                            fill="none"
                            style={{ animationDuration: `${beltDur}s` }}
                          />
                          {/* package riding the branch */}
                          <rect className="fb-pkg" x={-6} y={-6} width={12} height={12} rx={2}>
                            <animateMotion dur={`${beltDur * 2.4}s`} repeatCount="indefinite" path={d} />
                          </rect>
                        </g>
                      );
                    })}
                    {/* package on the main belt */}
                    <rect className="fb-pkg" x={-6} y={-6} width={12} height={12} rx={2}>
                      <animateMotion dur={`${beltDur * 2}s`} repeatCount="indefinite" path={mainD} />
                    </rect>
                    <circle className="fb-node" cx={JUNC.x} cy={JUNC.y} r={8} />
                  </>
                )}

                {/* inbound door (left wall, faces RIGHT into the warehouse) */}
                <g className="fd-bay open">
                  <rect className="fd-struct" x={INX - 30} y={CY - 24} width={32} height={48} rx={6} />
                  <rect className="fd-open" x={INX - 2} y={CY - 16} width={14} height={32} rx={2} />
                  <rect className="fd-jamb" x={INX - 2} y={CY - 18} width={14} height={3} />
                  <rect className="fd-jamb" x={INX - 2} y={CY + 15} width={14} height={3} />
                </g>
                <text className="fl2-small" x={INX - 12} y={CY + 42}>Inbound</text>

                {/* dock doors (right wall, face LEFT into the warehouse) */}
                {Array.from({ length: RIGHT_SLOTS }).map((_, i) => {
                  const cy = slotY(i);
                  const aj = i - startActive;
                  const open = aj >= 0 && aj < docks;
                  const isSel = open && sel === aj;
                  const label = open ? `Dock ${aj + 1}` : "Locked";
                  return (
                    <g key={`door${i}`} className={`fd-bay ${open ? "open" : "lock"} ${isSel ? "sel" : ""}`}>
                      <rect className="fd-struct" x={WALLX - 2} y={cy - 22} width={30} height={44} rx={6} />
                      {open ? (
                        <>
                          <rect className="fd-open" x={WALLX - 12} y={cy - 15} width={14} height={30} rx={2} />
                          <rect className="fd-jamb" x={WALLX - 12} y={cy - 17} width={14} height={3} />
                          <rect className="fd-jamb" x={WALLX - 12} y={cy + 14} width={14} height={3} />
                        </>
                      ) : (
                        <>
                          <rect className="fd-slab" x={WALLX - 11} y={cy - 15} width={12} height={30} rx={2} />
                          <line className="fd-slat" x1={WALLX - 8} y1={cy - 14} x2={WALLX - 8} y2={cy + 14} />
                          <line className="fd-slat" x1={WALLX - 5} y1={cy - 14} x2={WALLX - 5} y2={cy + 14} />
                          <line className="fd-slat" x1={WALLX - 2} y1={cy - 14} x2={WALLX - 2} y2={cy + 14} />
                        </>
                      )}
                      <text className="fl2-small" x={WALLX + 13} y={cy + 36}>{label}</text>
                    </g>
                  );
                })}

                <text className="fl2-small" x={185} y={CY + 22}>line output</text>
              </svg>
            </div>

            <div className="fl2-bottom">
              <div className="fl2-mini">
                <div className="label">Selected</div>
                <div className="value">{sel === "line" ? clip(lines[0]?.name ?? "Line", 18) : `Dock ${(sel as number) + 1}`}</div>
              </div>
              <div className="fl2-mini">
                <div className="label">Projected output</div>
                <div className="value">{projected}</div>
              </div>
              <div className="fl2-mini">
                <div className="label">Next bottleneck</div>
                <div className="value">{bottleneck}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
