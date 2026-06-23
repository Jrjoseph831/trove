"use client";

import { sectorKeys, sectors } from "@trove/data";
import { useTrove } from "@/lib/trove";

/** Sector demand bars. When clickable, deep-links into the filtered Catalog. */
export function SectorBars({ clickable = false }: { clickable?: boolean }) {
  const { state, openSector } = useTrove();
  return (
    <>
      {sectorKeys.map((k) => {
        const v = state.sectorIdx[k] ?? 1;
        const pc = (v - 1) * 100;
        const up = pc >= 0;
        const w = Math.min(50, Math.abs(pc) * 1.5);
        const inner = (
          <>
            <span className="nm">{sectors[k]?.label}</span>
            <span className="track">
              <i className={up ? "up" : "dn"} style={{ width: `${w}%` }} />
            </span>
            <span className={`pct ${up ? "up" : "dn"}`}>
              {pc >= 0 ? "+" : ""}
              {pc.toFixed(0)}%
            </span>
          </>
        );
        return clickable ? (
          <button key={k} className="sec" onClick={() => openSector(k)}>
            {inner}
          </button>
        ) : (
          <div key={k} className="sec">
            {inner}
          </div>
        );
      })}
    </>
  );
}
