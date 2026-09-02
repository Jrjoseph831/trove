"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, X } from "lucide-react";
import {
  brands as allBrands,
  brandSlug,
  lotSize,
  sectorKeys,
  sectors,
} from "@trove/data";
import type { ActiveStory, LogEntry, RuntimeItem } from "@trove/engine";
import { canBuy, held } from "@trove/engine";
import { money, pctChange } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { primarySectorLabel, stockState } from "@/lib/ui";
import { itemPlate } from "@/lib/texture";
import { sectorTone } from "@/lib/sectors";
import { useTrove } from "@/lib/trove";
import { AcquireConfirm } from "./AcquireConfirm";
import { ScreenHead } from "./ScreenHead";

type SortKey = "featured" | "price-asc" | "price-desc" | "change" | "name";

/** Find the active news story most responsible for this item's price movement.
 *  Matches on sector weights: the story that pushes the item's primary sectors
 *  hardest wins. In sandbox the active list is exact; in live it is the local
 *  warmup approximation — close enough to give players a meaningful "why". */
function reasonFor(it: RuntimeItem, active: ActiveStory[]): string | null {
  let best: { head: string; mag: number } | null = null;
  for (const { news } of active) {
    for (const [sec, eff] of Object.entries(news.effects)) {
      const w = (it.weights as Record<string, number>)[sec] ?? 0;
      if (w <= 0) continue;
      const mag = Math.abs(eff) * w;
      if (!best || mag > best.mag) best = { head: news.head, mag };
    }
  }
  return best?.head ?? null;
}

const TRADE_VERBS = new Set(["bought", "sold", "acquired"]);

/** Horizontal ticker tape of recent named-firm trade activity. Pure CSS
 *  animation — no interval needed. Only renders when there is real activity. */
function CatalogTicker({ log }: { log: LogEntry[] }) {
  const entries = log.filter(
    (e) => e.who !== "YOU" && e.who !== "Market" && TRADE_VERBS.has(e.verb),
  );
  if (entries.length === 0) return null;
  const tape = [...entries, ...entries]; // duplicate for seamless loop
  return (
    <div className="shop-tape" aria-hidden="true">
      <div className="shop-tape-run">
        {tape.map((e, i) => (
          <span key={i} className={e.verb === "sold" ? "dn" : "up"}>
            <i className="shop-tape-dot" />
            {e.who} · {e.verb} {e.it}
          </span>
        ))}
      </div>
    </div>
  );
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "price-desc", label: "Price: high to low" },
  { key: "price-asc", label: "Price: low to high" },
  { key: "change", label: "Biggest movers" },
  { key: "name", label: "Name A–Z" },
];

const BRAND_NAMES = [...allBrands].map((b) => b.name).sort();

/** Grid geometry — the virtualizer works in ROWS, so the column count is
 *  measured from the container and rows are chunked to match. */
const CARD_MIN = 232;
const GAP = 24;
/** Must match the rendered card height (see .pcard in globals.css) — the
 *  virtualizer positions rows on this, so if it's short the last element in
 *  each card gets clipped by the row below. */
const CARD_H = 364;

/** Inline highlight for the "Find it on the floor" target card. */
const HL_STYLE = {
  boxShadow: "0 0 0 2px var(--accent), 0 0 26px -6px var(--accent)",
} as const;

export function Catalog() {
  const { state, cat, setCatSector, setCatBrand, setCatSearch, hlItem, tick } =
    useTrove();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [acquireTarget, setAcquireTarget] = useState<RuntimeItem | null>(null);
  const [sort, setSort] = useState<SortKey>("featured");
  const [cols, setCols] = useState(4);
  const [cardH, setCardH] = useState(CARD_H);

  // Measure BOTH how many cards fit and how tall they actually render.
  // Height can't be a constant: cards grow when a long name wraps to two
  // lines, and mobile (narrower cards, larger relative type) makes that the
  // norm — a stale constant means the virtualizer lays rows out too tightly
  // and the row below slices the Acquire button off.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) {
        const min = w < 520 ? 150 : CARD_MIN; // two-up on phones, not one giant card
        setCols(Math.max(1, Math.floor((w + GAP) / (min + GAP))));
      }
      const card = el.querySelector<HTMLElement>(".pcard");
      if (card) {
        const h = Math.ceil(card.getBoundingClientRect().height);
        if (h > 0) setCardH((cur) => (Math.abs(cur - h) > 1 ? h : cur));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyed on `tick`, not just `state`: overlayWorld MUTATES the live world in
  // place, so `state`'s identity never changes when server data lands and a
  // memo depending on it alone keeps its pre-overlay result forever. That's
  // why sold-out editions kept appearing — the filter still saw the initial
  // remaining: Infinity while the card rendered the real value and showed
  // "Claimed".
  const filtered = useMemo(() => {
    const q = cat.search.trim().toLowerCase();
    return state.items.filter((i) => {
      if (i.edition !== null && i.remaining <= 0) return false; // claimed
      if (cat.sector && !i.weights[cat.sector]) return false;
      if (cat.brand && i.brand !== cat.brand) return false;
      if (q && !`${i.name} ${i.brand}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tick, cat.sector, cat.brand, cat.search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case "price-asc":
        arr.sort((a, b) => a.value - b.value);
        break;
      case "price-desc":
        arr.sort((a, b) => b.value - a.value);
        break;
      case "change":
        arr.sort(
          (a, b) =>
            Math.abs(pctChange(b.value, b.prevValue)) -
            Math.abs(pctChange(a.value, a.prevValue)),
        );
        break;
      case "name":
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        // Featured: limited editions first, then by value — the shelf you'd
        // put at the front of the store.
        arr.sort((a, b) => {
          const ae = a.edition !== null ? 1 : 0;
          const be = b.edition !== null ? 1 : 0;
          if (ae !== be) return be - ae;
          return b.value - a.value;
        });
    }
    return arr;
  }, [filtered, sort]);

  const rowCount = Math.ceil(sorted.length / cols);
  const rowVirt = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cardH + GAP,
    overscan: 4,
  });

  // Re-lay-out when the measured card height or column count changes —
  // estimateSize is captured per measurement pass, so without this the rows
  // keep their old spacing after a resize/breakpoint change.
  useEffect(() => {
    rowVirt.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardH, cols]);

  // "Find it on the floor" — scroll the highlighted item's row into view.
  const hlId = hlItem;
  useEffect(() => {
    if (hlId == null) return;
    const idx = sorted.findIndex((i) => i.id === hlId);
    if (idx < 0) return;
    rowVirt.scrollToIndex(Math.floor(idx / cols), { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlId, cols, sorted.length]);

  const activeFilters =
    (cat.sector ? 1 : 0) + (cat.brand ? 1 : 0) + (cat.search.trim() ? 1 : 0);
  const clearAll = () => {
    setCatSector(null);
    setCatBrand(null);
    setCatSearch("");
  };

  // `view-shop` turns off .view's own scrolling: the storefront manages its
  // own bounded scroller (.shop-scroll) so the virtualizer has a real
  // viewport to measure. Without it .view grows to full content height, the
  // virtualizer sees a ~72,000px viewport, and every one of the ~1,900 cards
  // mounts at once.
  return (
    <div className="view view-shop">
      <div className="shop">
        {/* One header, same anatomy as every other screen — the storefront's
            search takes the slot the other screens put their readouts in,
            because on this screen search IS the readout you reach for. */}
        <div className="shop-bar">
          <ScreenHead tab="catalog" className="shop-head">
            <div className="shop-search">
              <Search size={17} strokeWidth={2} />
              <input
                placeholder="Search the market — brand, item, anything…"
                value={cat.search}
                onChange={(e) => setCatSearch(e.target.value)}
                aria-label="Search the market"
              />
              {cat.search && (
                <button
                  className="shop-search-x"
                  onClick={() => setCatSearch("")}
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </ScreenHead>
        </div>

        <CatalogTicker log={state.log} />
        <div className="shop-body">
          {/* Filter rail */}
          <aside className="shop-filters">
            <div className="shopf-group">
              <div className="shopf-h">Department</div>
              {/* .shopf-optrow is a plain wrapper on desktop and a horizontal
                  chip strip on phones — a vertical list of 12 departments
                  would fill the first screen before a single product showed. */}
              <div className="shopf-optrow">
              <button
                className={`shopf-opt all ${!cat.sector ? "on" : ""}`}
                onClick={() => setCatSector(null)}
              >
                <i className="shopf-dot" />
                All departments
              </button>
              {sectorKeys.map((k) => (
                <button
                  key={k}
                  className={`shopf-opt ${cat.sector === k ? "on" : ""}`}
                  style={{ "--tone": sectorTone(k) } as React.CSSProperties}
                  onClick={() => setCatSector(k)}
                >
                  <i className="shopf-dot" />
                  {sectors[k]?.label}
                </button>
              ))}
              </div>
            </div>

            <div className="shopf-group">
              <div className="shopf-h">Brand</div>
              <select
                className="shopf-select"
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
            </div>

            {activeFilters > 0 && (
              <button className="shopf-clear" onClick={clearAll}>
                Clear filters ({activeFilters})
              </button>
            )}
          </aside>

          {/* Results */}
          <section className="shop-results">
            <div className="shop-resbar">
              <span className="hud-stat">
                <i>
                  {cat.search.trim()
                    ? `Matching “${cat.search.trim()}”`
                    : cat.sector
                      ? (sectors[cat.sector]?.label ?? "Results")
                      : "On the market"}
                </i>
                <b>{sorted.length.toLocaleString()}</b>
              </span>
              <label className="shop-sort">
                Sort by
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {sorted.length === 0 ? (
              <div className="shop-empty">
                <div className="shop-empty-h">No matches</div>
                <p>Try a different search, or clear your filters.</p>
                {activeFilters > 0 && (
                  <button className="lbtn lbtn-ghost" onClick={clearAll}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="shop-scroll" ref={scrollRef}>
                <div ref={gridRef} style={{ width: "100%" }}>
                  <div
                    style={{
                      height: rowVirt.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {rowVirt.getVirtualItems().map((vr) => {
                      const start = vr.index * cols;
                      const row = sorted.slice(start, start + cols);
                      return (
                        <div
                          key={vr.key}
                          className="shop-row"
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${vr.start}px)`,
                            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                          }}
                        >
                          {row.map((it) => {
                            const dp = pctChange(it.value, it.prevValue);
                            const up = it.value >= it.prevValue;
                            const ss = stockState(it);
                            const mine = held(it, "YOU");
                            const lot = lotSize(it);
                            const isEd = it.edition !== null;
                            const reason =
                              Math.abs(dp) >= 0.5
                                ? reasonFor(it, state.active)
                                : null;
                            return (
                              <article
                                className="pcard"
                                key={it.id}
                                id={`floor-item-${it.id}`}
                                style={hlId === it.id ? HL_STYLE : undefined}
                              >
                                {/* The plate is drawn from the item's own id, so
                                    no two cards share a face and none of it is
                                    an asset. */}
                                <Link
                                  href={`/item/${it.id}`}
                                  className="pcard-media"
                                  style={itemPlate(it)}
                                >
                                  <ItemIcon it={it} size={54} />
                                  {isEd && (
                                    <span className="pcard-tag">
                                      {it.edition === 1 ? "1 of 1" : "Limited"}
                                    </span>
                                  )}
                                </Link>
                                <div className="pcard-body">
                                  <Link
                                    href={`/brand/${brandSlug(it.brand)}`}
                                    className="pcard-brand"
                                  >
                                    {it.brand}
                                  </Link>
                                  <Link
                                    href={`/item/${it.id}`}
                                    className="pcard-name"
                                  >
                                    {it.name}
                                  </Link>
                                  <div className="pcard-meta">
                                    {primarySectorLabel(it)}
                                    {mine > 0 && (
                                      <span className="pcard-own">
                                        · you hold {mine.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                  <div className="pcard-priceline">
                                    <span className="pcard-price">
                                      {money(it.value)}
                                      {lot > 1 && (
                                        <span className="pcard-per">/ea</span>
                                      )}
                                    </span>
                                    <span
                                      className={`pcard-chg ${up ? "up" : "dn"}`}
                                    >
                                      {up ? "▲" : "▼"}
                                      {Math.abs(dp).toFixed(1)}%
                                    </span>
                                  </div>
                                  {reason && (
                                    <div className="pcard-reason">
                                      {reason.length > 36
                                        ? reason.slice(0, 34) + "…"
                                        : reason}
                                    </div>
                                  )}
                                  <div className={`pcard-stock ${ss ?? ""}`}>
                                    {ss === "scarce"
                                      ? "Only a few left"
                                      : ss === "low"
                                        ? "Running tight"
                                        : "In stock"}
                                  </div>
                                  <button
                                    className="pcard-btn"
                                    disabled={!canBuy(it)}
                                    onClick={() => setAcquireTarget(it)}
                                  >
                                    {!canBuy(it)
                                      ? isEd
                                        ? "Claimed"
                                        : "Sold out"
                                      : lot > 1
                                        ? `Acquire case · ${lot}`
                                        : "Acquire"}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {acquireTarget && (
        <AcquireConfirm item={acquireTarget} onClose={() => setAcquireTarget(null)} />
      )}
    </div>
  );
}
