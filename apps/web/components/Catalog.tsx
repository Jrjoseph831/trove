"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { brands as allBrands, brandSlug, sectorKeys, sectors } from "@trove/data";
import { canBuy, held } from "@trove/engine";
import { money, pctChange, signedPct } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { primarySectorLabel, stockState } from "@/lib/ui";
import { useTrove } from "@/lib/trove";

const ROW = 46;

type SortKey = "item" | "sector" | "supply" | "price" | "change";

/** Inline highlight for the "Find it on the floor" target row. */
const HL_STYLE = {
  background: "color-mix(in srgb, var(--accent) 22%, transparent)",
  boxShadow: "inset 0 0 0 2px var(--accent), 0 0 22px -6px var(--accent)",
  borderRadius: 8,
  zIndex: 3,
} as const;
const BRAND_NAMES = [...allBrands].map((b) => b.name).sort();

export function Catalog() {
  const { state, cat, setCatSector, setCatBrand, setCatSearch, buy, hlItem } =
    useTrove();
  const parentRef = useRef<HTMLDivElement>(null);

  // "Find it on the floor": hlItem comes from the provider (same reliable path
  // as the q search filter). Apply an INLINE highlight at render time so it can't
  // be lost to re-renders/remounts/virtualization. Scroll it into view.
  const hlId = hlItem;
  useEffect(() => {
    if (hlId == null) return;
    const find = (n = 0) => {
      const el = document.getElementById(`floor-item-${hlId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      else if (n < 40) window.setTimeout(() => find(n + 1), 100);
    };
    window.setTimeout(() => find(0), 200);
  }, [hlId]);

  const filtered = useMemo(() => {
    const q = cat.search.trim().toLowerCase();
    return state.items.filter((i) => {
      if (cat.sector && !i.weights[cat.sector]) return false;
      if (cat.brand && i.brand !== cat.brand) return false;
      if (q && !`${i.name} ${i.brand}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // recompute when filters change; live prices don't change membership
  }, [state, cat.sector, cat.brand, cat.search]);

  // Sortable columns. Text columns default ascending, numbers descending;
  // clicking the active column flips direction.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "price",
    dir: -1,
  });
  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 }
        : { key, dir: key === "item" || key === "sector" ? 1 : -1 },
    );

  const commodities = useMemo(() => {
    const arr = filtered.filter((i) => i.edition === null);
    const d = sort.dir;
    arr.sort((a, b) => {
      switch (sort.key) {
        case "item":
          return a.name.localeCompare(b.name) * d;
        case "sector":
          return primarySectorLabel(a).localeCompare(primarySectorLabel(b)) * d;
        case "supply":
          return (a.stock - b.stock) * d;
        case "change":
          return (
            (pctChange(a.value, a.prevValue) - pctChange(b.value, b.prevValue)) *
            d
          );
        default:
          return (a.value - b.value) * d;
      }
    });
    return arr;
  }, [filtered, sort]);
  const editions = useMemo(
    () =>
      filtered
        .filter((i) => i.edition !== null && i.remaining > 0)
        .sort((a, b) => b.value - a.value),
    [filtered],
  );

  const rowVirt = useVirtualizer({
    count: commodities.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">Catalog</h2>
        <div className="seg">
          <button
            className={`chip ${!cat.sector ? "on" : ""}`}
            onClick={() => setCatSector(null)}
          >
            All
          </button>
          {sectorKeys.map((k) => (
            <button
              key={k}
              className={`chip ${cat.sector === k ? "on" : ""}`}
              onClick={() => setCatSector(k)}
            >
              {sectors[k]?.label}
            </button>
          ))}
        </div>
        <div className="cat-controls">
          <select
            className="search brand-select"
            value={cat.brand ?? ""}
            onChange={(e) => setCatBrand(e.target.value || null)}
            aria-label="Filter by brand"
          >
            <option value="">All brands</option>
            {BRAND_NAMES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <input
            className="search cat-search"
            placeholder="Search brand or item…"
            value={cat.search}
            onChange={(e) => setCatSearch(e.target.value)}
          />
          <button
            className="cat-reset"
            onClick={() => {
              setCatSector(null);
              setCatBrand(null);
              setCatSearch("");
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="cat-grid">
        <div>
          <div className="thead">
            {(
              [
                ["item", "Item", ""],
                ["sector", "Sector", ""],
                ["supply", "Supply", ""],
                ["price", "Price", "r"],
                ["change", "Δ", "r"],
              ] as [SortKey, string, string][]
            ).map(([key, label, align]) => (
              <button
                key={key}
                className={`th ${align}`}
                onClick={() => toggleSort(key)}
              >
                {label}
                {sort.key === key && (
                  <span className="th-arr">{sort.dir === 1 ? "↑" : "↓"}</span>
                )}
              </button>
            ))}
            <span />
          </div>

          {commodities.length === 0 ? (
            <div className="empty">Nothing matches.</div>
          ) : (
            <div ref={parentRef} className="catlist">
              <div
                style={{
                  height: rowVirt.getTotalSize(),
                  position: "relative",
                  width: "100%",
                }}
              >
                {rowVirt.getVirtualItems().map((v) => {
                  const it = commodities[v.index]!;
                  const d = it.value - it.prevValue;
                  const dp = pctChange(it.value, it.prevValue);
                  const ss = stockState(it);
                  const mineQty = held(it, "YOU");
                  return (
                    <div
                      key={it.id}
                      id={`floor-item-${it.id}`}
                      className="trow"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: ROW,
                        transform: `translateY(${v.start}px)`,
                        ...(hlId === it.id ? HL_STYLE : {}),
                      }}
                    >
                      <span className="nmcell">
                        <ItemIcon it={it} size={18} className="ic" />
                        <span className="nm">
                          <Link
                            href={`/brand/${brandSlug(it.brand)}`}
                            className="bd bd-link"
                          >
                            {it.brand}
                          </Link>
                          <Link href={`/item/${it.id}`} className="it-link">
                            {it.name}
                          </Link>
                          {mineQty ? ` · you hold ${mineQty}` : ""}
                        </span>
                      </span>
                      <span className="sct">{primarySectorLabel(it)}</span>
                      <span className="stockdot">
                        <i className={ss ?? ""} />
                        {ss === "scarce" ? "scarce" : ss === "low" ? "tight" : "in stock"}
                      </span>
                      <span className="pr">{money(it.value)}</span>
                      <span className={`chg ${d >= 0 ? "pos" : "neg"}`}>
                        {d >= 0 ? "▲" : "▼"}
                        {Math.abs(dp).toFixed(1)}%
                      </span>
                      <span style={{ textAlign: "right" }}>
                        <button
                          className="tbtn"
                          disabled={!canBuy(it) || it.value > state.cash}
                          onClick={() => buy(it.id)}
                        >
                          {canBuy(it) ? "Acquire" : "Sold out"}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="ed-col">
          <h3>Collectible Editions</h3>
          {editions.length ? (
            editions.map((it) => {
              const d = it.value - it.prevValue;
              const dp = pctChange(it.value, it.prevValue);
              return (
                <div
                  className="edcard"
                  id={`floor-item-${it.id}`}
                  key={it.id}
                  style={hlId === it.id ? HL_STYLE : undefined}
                >
                  <div className="top">
                    <ItemIcon it={it} size={30} />
                    <span className="glint">✦</span>
                  </div>
                  <Link
                    href={`/brand/${brandSlug(it.brand)}`}
                    className="bd bd-link"
                  >
                    {it.brand}
                  </Link>
                  <Link href={`/item/${it.id}`} className="nm it-link">
                    {it.name}
                  </Link>
                  <div className="edword">
                    {it.edition === 1 ? "1 of 1" : "Limited edition"}
                  </div>
                  <div className="row">
                    <span className="pr">{money(it.value)}</span>
                    <span className={`chg ${d >= 0 ? "pos" : "neg"}`}>
                      {d >= 0 ? "▲" : "▼"} {signedPct(dp)}
                    </span>
                  </div>
                  <button
                    className="acq"
                    disabled={!canBuy(it) || it.value > state.cash}
                    onClick={() => buy(it.id)}
                  >
                    {canBuy(it) ? "Acquire" : "Claimed"}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="empty">No editions match. They may all be claimed.</div>
          )}
        </div>
      </div>
    </div>
  );
}
