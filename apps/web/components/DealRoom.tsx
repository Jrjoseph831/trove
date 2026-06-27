"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { companies as lore, sectors } from "@trove/data";
import { companyValuation } from "@trove/engine";
import { devAction, fetchCompanies, type DirEntry } from "@/lib/api";
import { IS_STAGING } from "@/lib/config";
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
  const [view, setView] = useState<"houses" | "players">("houses");
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

      <div className="deal-tabs">
        <button className={view === "houses" ? "on" : ""} onClick={() => setView("houses")}>
          AI Houses
        </button>
        <button className={view === "players" ? "on" : ""} onClick={() => setView("players")}>
          Live Players (M&amp;A)
        </button>
      </div>

      {view === "players" ? (
        <LivePlayers />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// ── Live-player M&A: acquire another player's entire firm (consensual) ────────
function LivePlayers() {
  const { desk, requestBuyout, orders, orderAct } = useTrove();
  const [dir, setDir] = useState<DirEntry[] | null>(null);
  const [openTo, setOpenTo] = useState<string | null>(null);
  const [bid, setBid] = useState("");
  const [devPrice, setDevPrice] = useState("5000000");
  const [devBusy, setDevBusy] = useState(false);

  const runDev = async (action: string, extra: Record<string, number> = {}) => {
    setDevBusy(true);
    await devAction({ action, ...extra });
    if (typeof window !== "undefined") window.location.reload();
  };

  useEffect(() => {
    let alive = true;
    fetchCompanies()
      .then((e) => alive && setDir(e))
      .catch(() => alive && setDir([]));
    return () => {
      alive = false;
    };
  }, []);

  const myName = desk?.name?.trim();
  const targets = (dir ?? []).filter((e) => e.kind === "player" && e.name !== myName);
  const incoming = (orders?.incoming ?? []).filter((o) => o.kind === "buyout");
  const outgoing = (orders?.outgoing ?? []).filter((o) => o.kind === "buyout");

  const send = async (handle: string) => {
    const price = Math.round(Number(bid));
    if (!Number.isFinite(price) || price <= 0) return;
    const ok = await requestBuyout(handle, price);
    if (ok) {
      setOpenTo(null);
      setBid("");
    }
  };

  return (
    <div className="ma-wrap">
      {IS_STAGING && (
        <div className="ma-dev">
          <span className="ma-dev-h">🧪 Staging tools</span>
          <button disabled={devBusy} onClick={() => runDev("fund", { amount: 50_000_000 })}>
            Fund +$50M
          </button>
          <input
            className="ma-input"
            type="number"
            value={devPrice}
            onChange={(e) => setDevPrice(e.target.value)}
            style={{ maxWidth: 150 }}
          />
          <button
            disabled={devBusy}
            onClick={() => runDev("offer-me", { price: Math.round(Number(devPrice) || 1_000_000) })}
          >
            Send me a buyout offer
          </button>
        </div>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="ma-inbox">
          <div className="ma-h">Deals on the table</div>
          {incoming.map((o) => (
            <div className="ma-deal" key={o.id}>
              <span className="ma-deal-txt">
                <b>{o.buyerName}</b> offers <b>{money(o.price)}</b> to acquire your firm
                {o.turn === "buyer" && " · you countered, awaiting them"}
              </span>
              {o.turn === "seller" && (
                <span className="ma-acts">
                  <button className="ma-yes" onClick={() => orderAct(o.id, "accept")}>
                    Sell for {money(o.price)}
                  </button>
                  <button
                    className="ma-no"
                    onClick={() => {
                      const p = Math.round(Number(prompt("Counter price?") ?? ""));
                      if (p > 0) orderAct(o.id, "counter", p);
                    }}
                  >
                    Counter
                  </button>
                  <button className="ma-no" onClick={() => orderAct(o.id, "decline")}>
                    Decline
                  </button>
                </span>
              )}
            </div>
          ))}
          {outgoing.map((o) => (
            <div className="ma-deal" key={o.id}>
              <span className="ma-deal-txt">
                Your offer of <b>{money(o.price)}</b> for <b>{o.sellerName}</b>
                {o.turn === "buyer" ? " · they countered" : " · awaiting their call"}
              </span>
              <span className="ma-acts">
                {o.turn === "buyer" && (
                  <button className="ma-yes" onClick={() => orderAct(o.id, "accept")}>
                    Accept {money(o.price)}
                  </button>
                )}
                <button className="ma-no" onClick={() => orderAct(o.id, "withdraw")}>
                  Withdraw
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="ma-sub">
        Acquire a rival&apos;s entire firm. They must accept — you both negotiate
        the price. On a deal, you absorb their lines, properties, stakes &amp;
        holdings; they cash out.
      </div>

      {dir === null ? (
        <div className="empty">Loading the floor…</div>
      ) : targets.length === 0 ? (
        <div className="empty">No other player firms on the floor yet.</div>
      ) : (
        <div className="ma-grid">
          {targets.map((t) => (
            <div className="ma-card" key={t.handle}>
              <div className="ma-card-top">
                <div>
                  <div className="ma-name">{t.name}</div>
                  <div className="ma-meta">Net worth {money(t.netWorth)}</div>
                </div>
                {openTo !== t.handle && (
                  <button className="ma-offer" onClick={() => { setOpenTo(t.handle); setBid(String(t.netWorth)); }}>
                    Make offer
                  </button>
                )}
              </div>
              {openTo === t.handle && (
                <div className="ma-form">
                  <input
                    className="ma-input"
                    type="number"
                    value={bid}
                    onChange={(e) => setBid(e.target.value)}
                    placeholder="Your offer ($)"
                  />
                  <button className="ma-yes" onClick={() => send(t.handle)}>
                    Send offer
                  </button>
                  <button className="ma-no" onClick={() => setOpenTo(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
