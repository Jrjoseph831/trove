"use client";

import type { RuntimeItem } from "@trove/engine";
import { money, pctChange, signedPct } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";

/** A marquee tile (Trending "Worth Watching"). Click to acquire. */
export function Tile({ it }: { it: RuntimeItem }) {
  const { buy } = useTrove();
  const isEd = it.edition !== null;
  const d = it.value - it.prevValue;
  const dp = pctChange(it.value, it.prevValue);
  const pos = d >= 0;
  return (
    <button className={`tile ${isEd ? "ed" : ""}`} onClick={() => buy(it.id)}>
      <div className="top">
        <ItemIcon it={it} size={28} />
        {isEd && <span className="glint">✦</span>}
      </div>
      <div className="brandlbl">{it.brand}</div>
      <div className="nm">{it.name}</div>
      {isEd && (
        <div className="edword">{it.edition === 1 ? "1 of 1" : "Limited"}</div>
      )}
      <div className="row">
        <span className="pr">{money(it.value)}</span>
        <span className={`chg ${pos ? "pos" : "neg"}`}>
          {pos ? "▲" : "▼"} {signedPct(dp)}
        </span>
      </div>
    </button>
  );
}
