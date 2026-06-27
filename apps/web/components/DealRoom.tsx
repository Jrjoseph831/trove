"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { companies as lore, sectors } from "@trove/data";
import { companyValuation } from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

const secName = (s: string | null | undefined) =>
  s ? ((sectors as Record<string, { name?: string }>)[s]?.name ?? s) : "Index";

const TIER_LABEL: Record<string, string> = {
  titan: "Titan",
  large: "Large",
  mid: "Mid-cap",
  boutique: "Boutique",
};

const pct = (f: number) => `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`;
const initials = (name: string) =>
  name.replace(/[^a-zA-Z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join("") || "·";

interface Row {
  name: string;
  sector: string | null;
  tier: string;
  income: number;
  val: number;
  stake: number;
}

export function DealRoom() {
  const { state, buyStakeIn, sellStakeIn } = useTrove();
  const [sec, setSec] = useState("All");
  const [sort, setSort] = useState<"val" | "div" | "mine">("val");
  const [sel, setSel] = useState<string | null>(null);

  const stakes = state.stakes ?? {};

  const rows = useMemo<Row[]>(
    () =>
      state.traders.map((t) => ({
        name: t.name,
        sector: t.bias,
        tier: t.tier ?? "mid",
        income: t.income ?? 0,
        val: companyValuation(state, t.name),
        stake: stakes[t.name] ?? 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, state.cycle],
  );

  const mine = rows.filter((r) => r.stake > 0);
  const stakeVal = mine.reduce((a, r) => a + r.stake * r.val, 0);
  const divs = Math.round(mine.reduce((a, r) => a + r.stake * r.income, 0));

  const secChips = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(secName(r.sector));
    return ["All", ...[...set].sort()];
  }, [rows]);

  const list = useMemo(() => {
    const f = rows.filter((r) => sec === "All" || secName(r.sector) === sec);
    return f.sort((a, b) =>
      sort === "div"
        ? b.income - a.income
        : sort === "mine"
          ? b.stake * b.val - a.stake * a.val || b.val - a.val
          : b.val - a.val,
    );
  }, [rows, sec, sort]);

  const selRow = sel ? rows.find((r) => r.name === sel) : null;

  // ── Full-screen company file ────────────────────────────────────────────────
  if (selRow) {
    const c = (lore as Record<string, any>)[selRow.name];
    const profile = c?.events?.find((e: any) => e.kind === "profile") ?? c?.events?.[0];
    const myVal = selRow.stake * selRow.val;
    const controls = (buy: number, label: string) => (
      <button
        className="deal-buy"
        disabled={state.cash < buy * selRow.val || selRow.stake >= 0.9999}
        onClick={() => buyStakeIn(selRow.name, buy)}
      >
        {label}
        <span className="deal-buy-cost">{money(Math.round(buy * selRow.val))}</span>
      </button>
    );
    return (
      <div className="view deals">
        <button className="est-back" onClick={() => setSel(null)}>
          <ArrowLeft size={15} /> All companies
        </button>

        <div className="deal-file">
          <div className="deal-fhead">
            <span className={`deal-mono t-${selRow.tier}`}>{initials(selRow.name)}</span>
            <div>
              <h1 className="est-h1">{selRow.name}</h1>
              <div className="deal-sub">
                {secName(selRow.sector)} · {TIER_LABEL[selRow.tier] ?? selRow.tier}
                {c?.founded ? ` · est. ${c.founded}` : ""}
                {c?.ceo ? ` · ${c.ceo}` : ""}
              </div>
            </div>
            {selRow.stake >= 0.9999 && <span className="deal-ctrl-tag">◆ You control this</span>}
          </div>

          <div className="est-stats">
            <div className="est-stat">
              <span className="k">Valuation</span>
              <span className="v">{money(selRow.val)}</span>
            </div>
            <div className="est-stat">
              <span className="k">Your stake</span>
              <span className="v">{selRow.stake > 0 ? pct(selRow.stake) : "—"}</span>
            </div>
            <div className="est-stat">
              <span className="k">Stake value</span>
              <span className="v">{myVal > 0 ? money(Math.round(myVal)) : "—"}</span>
            </div>
            <div className="est-stat">
              <span className="k">Dividend / period</span>
              <span className="v rent">
                {selRow.stake > 0 ? `+${money(Math.round(selRow.stake * selRow.income))}` : "—"}
              </span>
            </div>
          </div>

          {profile?.body && <p className="est-blurb">{profile.body}</p>}
          {c?.personality?.trait && (
            <p className="deal-trait">House style: {c.personality.trait}.</p>
          )}

          <div className="deal-actions">
            <div className="deal-buyrow">
              {controls(0.05, "Buy 5%")}
              {controls(0.25, "Buy 25%")}
              {controls(Math.max(0, 1 - selRow.stake), "Acquire control")}
            </div>
            {selRow.stake > 0 && (
              <div className="deal-sellrow">
                <button
                  className="deal-sell"
                  onClick={() => sellStakeIn(selRow.name, selRow.stake * 0.25)}
                >
                  Trim 25%
                </button>
                <button
                  className="deal-sell"
                  onClick={() => {
                    sellStakeIn(selRow.name, selRow.stake);
                    setSel(null);
                  }}
                >
                  Sell entire stake ({money(Math.round(myVal))})
                </button>
              </div>
            )}
          </div>
          <p className="est-note">
            AI shares trade at market. Negotiated buyouts of real players&apos; firms
            come with live multiplayer.
          </p>
        </div>
      </div>
    );
  }

  // ── The floor ───────────────────────────────────────────────────────────────
  return (
    <div className="view deals">
      <header className="est-head">
        <div>
          <h2 className="est-title">The Deal Room</h2>
          <p className="est-sub">Buy into the houses on the floor. Collect dividends. Take control.</p>
        </div>
        <div className="est-portfolio">
          <div className="est-pf">
            <span className="k">Stakes held</span>
            <span className="v">{mine.length}</span>
          </div>
          <div className="est-pf">
            <span className="k">Stake value</span>
            <span className="v">{money(Math.round(stakeVal))}</span>
          </div>
          <div className="est-pf">
            <span className="k">Dividends / period</span>
            <span className="v rent">+{money(divs)}</span>
          </div>
        </div>
      </header>

      <div className="est-filters">
        <div className="est-chips">
          {secChips.map((c) => (
            <button key={c} className={`est-chip ${sec === c ? "on" : ""}`} onClick={() => setSec(c)}>
              {c}
            </button>
          ))}
        </div>
        <select
          className="est-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="val">Biggest valuation</option>
          <option value="div">Highest income</option>
          <option value="mine">My stakes first</option>
        </select>
      </div>

      <div className="deal-grid">
        {list.map((r) => (
          <button key={r.name} className="deal-card" onClick={() => setSel(r.name)}>
            <span className={`deal-mono t-${r.tier}`}>{initials(r.name)}</span>
            <div className="deal-cardmain">
              <div className="deal-cardname">{r.name}</div>
              <div className="deal-cardmeta">
                {secName(r.sector)} · {TIER_LABEL[r.tier] ?? r.tier}
              </div>
            </div>
            <div className="deal-cardright">
              <div className="deal-cardval">{money(r.val)}</div>
              {r.stake > 0 ? (
                <div className="deal-cardstake">◆ {pct(r.stake)} owned</div>
              ) : (
                <div className="deal-cardincome">
                  <TrendingUp size={11} /> +{money(r.income)}/per
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
