"use client";

import type { CSSProperties } from "react";
import { Forklift } from "lucide-react";
import { effectiveSpec } from "@trove/data";
import { floorBays, lanesPerBay, lineLanes } from "@trove/engine";
import { useTrove } from "@/lib/trove";

/** Experimental warehouse scene (v0). Real external sprites — OpenMoji package &
 *  delivery-truck (CC-BY-SA 4.0, hfg-gmuend/openmoji) — plus a lucide forklift,
 *  animated over PROCEDURAL belts that curve to each dock, lightly bound to live
 *  shipping. The art is swappable; the real deliverable is the data-driven motion
 *  system, into which we drop AI / Kenney / Lottie sprites next. Isolated behind
 *  the Lab tab — nothing here touches the live Floor.
 *
 *  Attribution: warehouse sprites from OpenMoji (https://openmoji.org), CC-BY-SA
 *  4.0 — keep this credit if these ship to production. */
export function WarehouseLab() {
  const { state, factoryCycle } = useTrove();
  const bays = floorBays(state.floorSlots);
  const perBay = lanesPerBay(state);
  const totalLanes = bays * perBay;

  const running = state.factories.filter((f) => factoryCycle >= f.onlineCycle);
  const demand = running.reduce((s, f) => {
    const out = state.items.find((it) => it.id === f.itemId);
    return out ? s + lineLanes(effectiveSpec(out, f.modules).rate) : s;
  }, 0);
  const overCap = demand > totalLanes;
  const throttle = overCap ? totalLanes / demand : 1;
  const realized = running.reduce((s, f) => {
    const out = state.items.find((it) => it.id === f.itemId);
    return out
      ? s + Math.floor(effectiveSpec(out, f.modules).rate * throttle)
      : s;
  }, 0);
  const active = running.length > 0 && realized > 0;

  // Busier floor → faster belts and trucks.
  const lg = Math.log10(Math.max(1, realized));
  const beltDur = Math.max(2.4, Math.min(6.5, 7.5 - lg * 0.75)); // s per package
  const truckDur = Math.max(5, Math.min(11, 13 - lg)); // s per truck cycle
  const pkgPerBelt = active ? 3 : 0;

  // ── Scene geometry (fixed px so the HTML actors line up with the SVG belts) ─
  const W = 720;
  const H = Math.max(230, 96 + bays * 76);
  const originX = 116;
  const originY = H / 2;
  const dockX = 600;
  const dockY = (b: number) => 74 + ((b + 0.5) / bays) * (H - 120);
  const beltD = (b: number) =>
    `M ${originX} ${originY} C ${originX + 210} ${originY}, ${dockX - 250} ${dockY(b)}, ${dockX - 36} ${dockY(b)}`;

  const sceneStyle: CSSProperties = { width: W, height: H };

  return (
    <div className="lab">
      <div className="lab-banner">
        🧪 <b>Warehouse Lab</b> — experimental. Open-source lucide actors on
        procedural belts, bound to live shipping (
        <b>{realized.toLocaleString()}/cy</b> across {bays} dock
        {bays > 1 ? "s" : ""}). Placeholder art — real sprites drop in next.
      </div>

      <div className="lab-wrap">
        <div className={`lab-scene ${overCap ? "jam" : active ? "run" : "idle"}`} style={sceneStyle}>
          <svg
            className="lab-svg"
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
          >
            {/* floor + back wall */}
            <rect className="lab-floor" x={0} y={0} width={W} height={H} rx={14} />
            <rect className="lab-wall" x={dockX - 8} y={28} width={W - dockX - 8} height={H - 56} rx={10} />

            {/* belts */}
            {Array.from({ length: bays }).map((_, b) => (
              <g key={`belt${b}`}>
                <path className="lab-belt-base" d={beltD(b)} fill="none" />
                <path
                  className={`lab-belt-flow ${overCap ? "jam" : active ? "run" : "idle"}`}
                  d={beltD(b)}
                  fill="none"
                  style={active ? { animationDuration: `${beltDur * 0.45}s` } : undefined}
                />
              </g>
            ))}
          </svg>

          {/* packages riding the belts */}
          {active &&
            Array.from({ length: bays }).flatMap((_, b) =>
              Array.from({ length: pkgPerBelt }).map((__, p) => (
                <span
                  key={`pkg${b}-${p}`}
                  className={`lab-pkg ${overCap ? "jam" : ""}`}
                  style={{
                    offsetPath: `path("${beltD(b)}")`,
                    animationDuration: `${beltDur}s`,
                    animationDelay: `${-(beltDur / pkgPerBelt) * p}s`,
                  }}
                >
                  <img src="/lab/package.svg" alt="" draggable={false} />
                </span>
              )),
            )}

          {/* staging forklift */}
          <span className="lab-fork" style={{ left: originX - 6, top: originY }}>
            <Forklift size={30} strokeWidth={1.6} />
          </span>

          {/* dock doors + outbound trucks */}
          {Array.from({ length: bays }).map((_, b) => (
            <div
              key={`dock${b}`}
              className={`lab-dock ${overCap ? "jam" : ""}`}
              style={{ left: dockX, top: dockY(b) }}
            >
              <span
                className="lab-door"
                style={active ? { animationDuration: `${truckDur}s`, animationDelay: `${-b * 1.1}s` } : undefined}
              />
              <span
                className="lab-truck"
                style={active ? { animationDuration: `${truckDur}s`, animationDelay: `${-b * 1.1}s` } : { opacity: 1 }}
              >
                <img src="/lab/truck.svg" alt="" draggable={false} />
              </span>
              <span className="lab-dock-lab">Dock {b + 1}</span>
            </div>
          ))}

          {!active && (
            <div className="lab-empty">Floor idle — build &amp; feed a line to see it move.</div>
          )}
        </div>
      </div>

      <p className="lab-foot">
        Belts curve to each dock and flow with your real output; packages ride
        them, the forklift stages, trucks roll out, doors lift. Swap any actor
        for a real sprite or Lottie loop — the motion stays.
      </p>
    </div>
  );
}
