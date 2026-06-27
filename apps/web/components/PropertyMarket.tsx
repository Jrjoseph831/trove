"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, MapPin, TrendingUp } from "lucide-react";
import { properties as catalog, type Property } from "@trove/data";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** Where the card art lives once generated: public/properties/<slug>.jpg.
 *  Until then a category gradient + the emoji stands in. */
const artUrl = (slug: string) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/properties/${slug}.jpg`;

const CATS = [
  "All",
  "Residential",
  "Estate",
  "Land",
  "Retail",
  "Office",
  "Industrial",
  "Hospitality",
  "Tower",
  "Flagship",
] as const;

const BLURB: Record<Property["category"], string> = {
  Residential: "Residential real estate — steady tenants and dependable rent.",
  Estate: "A trophy estate. More about standing than yield — owning it says something.",
  Land: "Raw land. No rent, but its value moves with the market — buy low, hold, flip.",
  Retail: "Retail frontage with foot traffic and reliable lease income.",
  Office: "Commercial office space — long leases, blue-chip tenants, stable cash flow.",
  Industrial: "Industrial & logistics — the unglamorous backbone of the economy. It pays.",
  Hospitality: "Hospitality — rooms and resorts that throw off strong, if cyclical, cash.",
  Tower: "A skyline tower. Marquee address, marquee rent, marquee price tag.",
  Flagship: "A one-of-one landmark. The kind of asset everyone in the world recognizes.",
};

const volLabel = (v: number) =>
  v < 0.02 ? "Low" : v < 0.035 ? "Medium" : "High";

const yieldPct = (p: Property) => (p.rentYield * 100).toFixed(2);

export function PropertyMarket() {
  const { state, buyEstate, sellEstate } = useTrove();
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const [sort, setSort] = useState<"low" | "high" | "yield">("low");
  const [sel, setSel] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const owned = useMemo(
    () => new Map((state.properties ?? []).map((o) => [o.propId, o])),
    [state.properties],
  );

  const ownedValue = useMemo(() => {
    let v = 0;
    for (const o of owned.values()) v += o.value;
    return v;
  }, [owned]);

  const rentPerPeriod = useMemo(() => {
    let r = 0;
    for (const o of owned.values()) {
      const p = catalog.find((x) => x.id === o.propId);
      if (p) r += p.price * p.rentYield;
    }
    return Math.round(r);
  }, [owned]);

  const list = useMemo(() => {
    const f = catalog.filter((p) => cat === "All" || p.category === cat);
    return f.sort((a, b) =>
      sort === "low"
        ? a.price - b.price
        : sort === "high"
          ? b.price - a.price
          : b.rentYield - a.rentYield,
    );
  }, [cat, sort]);

  const sale = (slug: string) =>
    failed.has(slug) ? null : (
      <img
        className="est-img"
        src={artUrl(slug)}
        alt=""
        loading="lazy"
        onError={() => setFailed((s) => new Set(s).add(slug))}
      />
    );

  const selProp = sel != null ? catalog.find((p) => p.id === sel) : null;

  // ── Full-screen listing ────────────────────────────────────────────────────
  if (selProp) {
    const op = owned.get(selProp.id);
    const isOwned = !!op;
    const canAfford = state.cash >= selProp.price;
    return (
      <div className="view estates">
        <button className="est-back" onClick={() => setSel(null)}>
          <ArrowLeft size={15} /> All listings
        </button>

        <div className="est-detail">
          <div className="est-hero" data-cat={selProp.category}>
            {sale(selProp.slug)}
            <span className="est-emoji">{selProp.icon}</span>
            {selProp.scarcity === "1of1" && (
              <span className="est-tag oneof">◆ 1 of 1</span>
            )}
            {isOwned && <span className="est-tag owned">✓ You own this</span>}
            <div className="est-hero-foot">
              <span className="est-hero-cat">
                <MapPin size={13} /> {selProp.category}
              </span>
            </div>
          </div>

          <div className="est-info">
            <h1 className="est-h1">{selProp.name}</h1>
            <div className="est-priceline">
              {money(selProp.price)}
              {isOwned && (
                <span className="est-nowworth">
                  · now worth <b>{money(op!.value)}</b>{" "}
                  <em className={op!.value >= op!.boughtValue ? "up" : "down"}>
                    {op!.value >= op!.boughtValue ? "▲" : "▼"}{" "}
                    {money(Math.abs(op!.value - op!.boughtValue))}
                  </em>
                </span>
              )}
            </div>

            <div className="est-stats">
              <div className="est-stat">
                <span className="k">Rent / period</span>
                <span className="v">
                  {selProp.rentYield > 0
                    ? money(Math.round(selProp.price * selProp.rentYield))
                    : "—"}
                </span>
              </div>
              <div className="est-stat">
                <span className="k">Yield</span>
                <span className="v">
                  {selProp.rentYield > 0
                    ? `${yieldPct(selProp)}% / per`
                    : "Appreciation"}
                </span>
              </div>
              <div className="est-stat">
                <span className="k">Volatility</span>
                <span className="v">{volLabel(selProp.volatility)}</span>
              </div>
              <div className="est-stat">
                <span className="k">Scarcity</span>
                <span className="v cap">{selProp.scarcity}</span>
              </div>
            </div>

            <p className="est-blurb">{BLURB[selProp.category]}</p>

            {isOwned ? (
              <button
                className="est-act sell"
                onClick={() => {
                  sellEstate(selProp.id);
                  setSel(null);
                }}
              >
                Sell for {money(op!.value)}
              </button>
            ) : (
              <button
                className="est-act buy"
                disabled={!canAfford}
                onClick={() => buyEstate(selProp.id)}
              >
                {canAfford
                  ? `Buy for ${money(selProp.price)}`
                  : `Need ${money(selProp.price - state.cash)} more`}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Marketplace grid ────────────────────────────────────────────────────────
  return (
    <div className="view estates">
      <header className="est-head">
        <div>
          <h2 className="est-title">Trove Estates</h2>
          <p className="est-sub">Real assets. Collect rent, watch them appreciate.</p>
        </div>
        <div className="est-portfolio">
          <div className="est-pf">
            <span className="k">Properties</span>
            <span className="v">{owned.size}</span>
          </div>
          <div className="est-pf">
            <span className="k">Portfolio value</span>
            <span className="v">{money(ownedValue)}</span>
          </div>
          <div className="est-pf">
            <span className="k">Rent / period</span>
            <span className="v rent">+{money(rentPerPeriod)}</span>
          </div>
        </div>
      </header>

      <div className="est-filters">
        <div className="est-chips">
          {CATS.map((c) => (
            <button
              key={c}
              className={`est-chip ${cat === c ? "on" : ""}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <select
          className="est-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="low">Price: low → high</option>
          <option value="high">Price: high → low</option>
          <option value="yield">Highest yield</option>
        </select>
      </div>

      <div className="est-grid">
        {list.map((p) => {
          const op = owned.get(p.id);
          return (
            <button
              key={p.id}
              className="est-card"
              onClick={() => setSel(p.id)}
            >
              <div className="est-photo" data-cat={p.category}>
                {sale(p.slug)}
                <span className="est-emoji">{p.icon}</span>
                {p.scarcity === "1of1" && (
                  <span className="est-tag oneof">◆ 1 of 1</span>
                )}
                {op && <span className="est-tag owned">✓ Owned</span>}
                {p.rentYield > 0 && (
                  <span className="est-tag yield">
                    <TrendingUp size={11} /> {yieldPct(p)}%
                  </span>
                )}
              </div>
              <div className="est-cardbody">
                <div className="est-cardprice">
                  {money(op ? op.value : p.price)}
                </div>
                <div className="est-cardname">{p.name}</div>
                <div className="est-cardmeta">
                  <MapPin size={11} /> {p.category}
                  {p.rentYield > 0
                    ? ` · +${money(Math.round(p.price * p.rentYield))}/per`
                    : " · appreciation"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
