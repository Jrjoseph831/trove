"use client";

import { DoorOpen, Forklift, Lock } from "lucide-react";
import { effectiveSpec } from "@trove/data";
import { floorBays, lanesPerBay, lineLanes } from "@trove/engine";
import { useTrove } from "@/lib/trove";

/** Experimental warehouse, top-down routing layout (after Joe's concept).
 *  Inbound bays (left) = production lines · outbound bays (top + right) = shipping
 *  docks · locked bays = capacity not yet unlocked. Belts route through a central
 *  spine and branch to each active outbound bay, stopping before the door where a
 *  forklift hands the box off. Belt colour is live throughput health:
 *    green = flowing · bronze = slowing (near capacity) · red = jammed.
 *  Isolated behind the Lab tab — nothing here touches the live Floor.
 *  Sprites: OpenMoji package (CC-BY-SA 4.0, openmoji.org). */
export function WarehouseLab() {
  const { state, factoryCycle } = useTrove();
  const docks = floorBays(state.floorSlots);
  const perBay = lanesPerBay(state);
  const totalLanes = docks * perBay;

  const lines = state.factories.filter((f) => factoryCycle >= f.onlineCycle);
  const demand = lines.reduce((s, f) => {
    const out = state.items.find((it) => it.id === f.itemId);
    return out ? s + lineLanes(effectiveSpec(out, f.modules).rate) : s;
  }, 0);
  const realized = lines.reduce((s, f) => {
    const out = state.items.find((it) => it.id === f.itemId);
    if (!out) return s;
    const t = demand > totalLanes ? totalLanes / demand : 1;
    return s + Math.floor(effectiveSpec(out, f.modules).rate * t);
  }, 0);

  // Throughput health → belt colour.
  const util = totalLanes > 0 ? demand / totalLanes : 0;
  const health: "idle" | "flow" | "slow" | "jam" =
    demand === 0 ? "idle" : util > 1 ? "jam" : util >= 0.85 ? "slow" : "flow";
  const beltDur = health === "jam" ? 3 : health === "slow" ? 1.8 : 1;
  const pkgDur = Math.max(3, Math.min(7, 8 - Math.log10(Math.max(1, realized))));

  // ── Bay slots ──────────────────────────────────────────────────────────────
  const IN_SLOTS = Math.max(3, Math.min(5, state.floorSlots));
  const TOP_N = 6;
  const RIGHT_N = 3;
  // Active outbound bays = docks, spread across top then right (interleaved).
  const order: { edge: "top" | "right"; idx: number }[] = [];
  for (let i = 0; i < Math.max(TOP_N, RIGHT_N); i++) {
    if (i < TOP_N) order.push({ edge: "top", idx: i });
    if (i < RIGHT_N) order.push({ edge: "right", idx: i });
  }
  const activeKey = new Set(order.slice(0, docks).map((o) => `${o.edge}${o.idx}`));

  // ── Geometry (fixed px so HTML actors line up with the SVG belts) ───────────
  const W = 760;
  const H = 400;
  const INX = 60;
  const TOPY = 60;
  const RIGHTX = 694;
  const SPINE = 224;
  const SPINE_X0 = 100;
  const SPINE_X1 = 624;
  const inY = (i: number) =>
    IN_SLOTS > 1 ? 120 + (i * 180) / (IN_SLOTS - 1) : 210;
  const topX = (j: number) => 200 + (j * 400) / (TOP_N - 1);
  const rightY = (k: number) => 132 + (k * 168) / (RIGHT_N - 1);

  const feederD = (i: number) =>
    `M ${INX + 19} ${inY(i)} L ${SPINE_X0} ${inY(i)} L ${SPINE_X0} ${SPINE}`;
  const spineD = `M ${SPINE_X0} ${SPINE} L ${SPINE_X1} ${SPINE}`;
  const topD = (j: number) => `M ${topX(j)} ${SPINE} L ${topX(j)} ${TOPY + 28}`;
  const rightD = (k: number) =>
    `M ${SPINE_X1} ${SPINE} L 652 ${SPINE} L 652 ${rightY(k)} L ${RIGHTX - 30} ${rightY(k)}`;

  const activeLines = lines.length;

  return (
    <div className="lab">
      <div className="lab-banner">
        🧪 <b>Warehouse Lab</b> — routing concept. Inbound bays (left) = your
        lines, outbound bays (top &amp; right) = docks, locked bays = capacity to
        unlock. Belts route through the center; colour is live health —{" "}
        <b style={{ color: "#1f8a4d" }}>green flowing</b>,{" "}
        <b style={{ color: "var(--up)" }}>bronze slowing</b>,{" "}
        <b style={{ color: "#c0563f" }}>red jammed</b> (
        {realized.toLocaleString()}/cy).
      </div>

      <div className="lab-wrap">
        <div className="lab-scene" style={{ width: W, height: H }}>
          <svg className="lab-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {/* warehouse shell */}
            <rect className="w2" x={46} y={32} width={668} height={336} rx={16} />

            {/* belts — only for active bays */}
            {activeLines > 0 && (
              <>
                {/* spine */}
                <path className="b2-base" d={spineD} fill="none" />
                <path className={`b2 ${health}`} d={spineD} fill="none" style={{ animationDuration: `${beltDur}s` }} />
                {/* inbound feeders */}
                {lines.map((f, i) =>
                  i < IN_SLOTS ? (
                    <g key={`fd${f.id}`}>
                      <path className="b2-base" d={feederD(i)} fill="none" />
                      <path className={`b2 ${health}`} d={feederD(i)} fill="none" style={{ animationDuration: `${beltDur}s` }} />
                    </g>
                  ) : null,
                )}
                {/* outbound branches */}
                {order.slice(0, docks).map((o) => {
                  const d = o.edge === "top" ? topD(o.idx) : rightD(o.idx);
                  return (
                    <g key={`br${o.edge}${o.idx}`}>
                      <path className="b2-base" d={d} fill="none" />
                      <path className={`b2 ${health}`} d={d} fill="none" style={{ animationDuration: `${beltDur}s` }} />
                    </g>
                  );
                })}
              </>
            )}
          </svg>

          {/* packages riding the active outbound branches */}
          {activeLines > 0 &&
            order.slice(0, docks).map((o) => {
              const d = o.edge === "top" ? topD(o.idx) : rightD(o.idx);
              return (
                <span
                  key={`pk${o.edge}${o.idx}`}
                  className="pk2"
                  style={{ offsetPath: `path("${d}")`, animationDuration: `${pkgDur}s` }}
                >
                  <img src="/lab/package.svg" alt="" draggable={false} />
                </span>
              );
            })}

          {/* inbound bays (left) */}
          {Array.from({ length: IN_SLOTS }).map((_, i) => {
            const on = i < activeLines;
            return (
              <div key={`in${i}`} className={`bay2 ${on ? "in" : "lock"}`} style={{ left: INX, top: inY(i) }}>
                {on ? <DoorOpen size={15} strokeWidth={1.9} /> : <Lock size={13} strokeWidth={2} />}
              </div>
            );
          })}

          {/* outbound bays (top) */}
          {Array.from({ length: TOP_N }).map((_, j) => {
            const on = activeKey.has(`top${j}`);
            return (
              <div key={`top${j}`} className={`bay2 ${on ? "out" : "lock"}`} style={{ left: topX(j), top: TOPY }}>
                {on ? <DoorOpen size={15} strokeWidth={1.9} /> : <Lock size={13} strokeWidth={2} />}
              </div>
            );
          })}

          {/* outbound bays (right) */}
          {Array.from({ length: RIGHT_N }).map((_, k) => {
            const on = activeKey.has(`right${k}`);
            return (
              <div key={`right${k}`} className={`bay2 ${on ? "out" : "lock"}`} style={{ left: RIGHTX, top: rightY(k) }}>
                {on ? <DoorOpen size={15} strokeWidth={1.9} /> : <Lock size={13} strokeWidth={2} />}
              </div>
            );
          })}

          {/* forklift handoffs at each active outbound door */}
          {order.slice(0, docks).map((o) => {
            const pos =
              o.edge === "top"
                ? { left: topX(o.idx), top: TOPY + 26 }
                : { left: RIGHTX - 24, top: rightY(o.idx) };
            return (
              <span key={`fk${o.edge}${o.idx}`} className="fk2" style={pos}>
                <Forklift size={20} strokeWidth={1.7} />
              </span>
            );
          })}

          {activeLines === 0 && (
            <div className="lab-empty">No active lines — build &amp; feed one to route the floor.</div>
          )}
        </div>
      </div>

      <p className="lab-foot">
        Belts converge through the center and branch to every unlocked outbound
        bay, stopping at the door for the forklift handoff — just like your
        concept. Expanding the floor unlocks more bays; the belt colour tracks
        real throughput. Sprites are swappable (AI / Kenney) without touching the
        routing.
      </p>
    </div>
  );
}
