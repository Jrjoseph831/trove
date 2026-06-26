"use client";

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

/** The Floor as a command console — a status board you scan at a glance: which
 *  lines are flowing (green), which are throttled (bronze) or stalled (red),
 *  which docks are full, and what needs attention. No animation; just signal. */
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

  // Even per-dock fill (least-full first).
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

  // Overall floor status.
  const status: "ok" | "warn" | "bad" | "idle" = overCap
    ? "bad"
    : !anyRunning
      ? "idle"
      : util >= 0.85
        ? "warn"
        : "ok";
  const statusMsg = overCap
    ? `Jammed — losing ${lostTot.toLocaleString()}/cy to congestion`
    : !anyRunning
      ? "Floor idle — no lines running"
      : util >= 0.85
        ? `Near capacity — ${Math.round(util * 100)}% of dock lanes in use`
        : "All lines flowing";

  // Problems list.
  const problems: string[] = [];
  if (overCap)
    problems.push(
      `Floor over capacity (${demand}/${totalLanes} lanes) — every line throttled to ~${Math.round(throttle * 100)}%. Add Auto-Router or expand the floor.`,
    );
  for (const l of lines)
    if (l.idle) problems.push(`${clip(l.name, 30)} line stalled — feed it inputs.`);
  if (!overCap && util >= 0.85 && anyRunning)
    problems.push(`Floor at ${Math.round(util * 100)}% — one more line could start jamming it.`);

  const lineStatus = (l: (typeof lines)[number]) => {
    if (l.building) return { dot: "idle", tag: "BUILDING" };
    if (l.idle) return { dot: "jam", tag: "STALLED" };
    if (realizedOf(l) < l.rate) return { dot: "slow", tag: "THROTTLED" };
    return { dot: "flow", tag: "FLOWING" };
  };
  const dockStatus = (used: number) => {
    if (used <= 0) return { dot: "idle", tag: "IDLE" };
    if (used >= perBay) return { dot: overCap ? "jam" : "slow", tag: "FULL" };
    return { dot: "flow", tag: "OPEN" };
  };

  return (
    <div className="cons">
      {/* headline metrics */}
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

      {/* overall status banner */}
      <div className={`cons-status ${status}`}>
        <span className="cons-status-dot" />
        <span className="cons-status-msg">{statusMsg}</span>
        <span className="cons-status-sub">
          {realizedTot.toLocaleString()}/cy shipping · {lines.length} line
          {lines.length === 1 ? "" : "s"} · {docks} dock{docks === 1 ? "" : "s"}
        </span>
      </div>

      <div className="cons-grid">
        {/* lines */}
        <div className="cons-panel">
          <div className="cons-panel-head">
            Production lines<span>{lines.length}</span>
          </div>
          {lines.length === 0 && (
            <div className="cons-empty">No lines yet — build one on the Lines tab.</div>
          )}
          {lines.map((l) => {
            const st = lineStatus(l);
            const realized = realizedOf(l);
            const throttled = !l.building && !l.idle && realized < l.rate;
            return (
              <div key={l.f.id} className="cons-row">
                <span className={`cons-dot ${st.dot}`} />
                <span className="cons-row-ic"><Cog size={14} strokeWidth={1.75} /></span>
                <div className="cons-row-body">
                  <span className="cons-row-name">{clip(l.name, 26)}</span>
                  <span className="cons-row-sub">
                    {l.building
                      ? "coming online…"
                      : l.idle
                        ? "no inputs"
                        : `${realized.toLocaleString()}/cy${throttled ? ` of ${l.rate.toLocaleString()}` : ""} · ${l.lanes} lane${l.lanes === 1 ? "" : "s"}`}
                  </span>
                </div>
                <span className={`cons-tag ${st.dot}`}>{st.tag}</span>
              </div>
            );
          })}
        </div>

        {/* docks */}
        <div className="cons-panel">
          <div className="cons-panel-head">
            Shipping docks<span>{docks}</span>
          </div>
          {Array.from({ length: docks }).map((_, j) => {
            const used = dockUsed[j] ?? 0;
            const st = dockStatus(used);
            return (
              <div key={j} className="cons-row">
                <span className={`cons-dot ${st.dot}`} />
                <div className="cons-row-body">
                  <span className="cons-row-name">Dock {j + 1}</span>
                  <span className="cons-bar">
                    <i
                      className={st.dot}
                      style={{ width: `${(used / Math.max(1, perBay)) * 100}%` }}
                    />
                  </span>
                </div>
                <span className="cons-row-cap">{used}/{perBay}</span>
                <span className={`cons-tag ${st.dot}`}>{st.tag}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* problems / all-clear */}
      {problems.length > 0 ? (
        <div className="cons-problems">
          <div className="cons-panel-head">⚠ Needs attention<span>{problems.length}</span></div>
          {problems.map((p, i) => (
            <div key={i} className="cons-problem">{p}</div>
          ))}
        </div>
      ) : (
        <div className="cons-allclear">✅ No problems — everything's flowing.</div>
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
        {mfg} floor · {state.factories.length}/{slots} slots used · {docks} dock
        {docks > 1 ? "s" : ""} · dock upkeep scales with size.
      </p>
    </div>
  );
}
