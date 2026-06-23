"use client";

import { assetsValue, netWorth } from "@trove/engine";
import { money, pctChange } from "@/lib/format";
import type { TabId } from "@/lib/trove";
import { useTrove } from "@/lib/trove";

const TABS: { id: TabId; ic: string; label: string }[] = [
  { id: "trending", ic: "◈", label: "Trending" },
  { id: "catalog", ic: "▦", label: "Catalog" },
  { id: "wire", ic: "❧", label: "The Wire" },
];

export function Rail() {
  const { state, mode, tab, warp, setTab, setMode, setWarp, jump } = useTrove();

  const nw = netWorth(state, "YOU");
  const prev = state.nwHist[state.nwHist.length - 1] ?? nw;
  const chg = nw - prev;
  const pct = pctChange(nw, prev);

  return (
    <nav className="rail">
      <div className="brand">
        TR<b>O</b>VE<small>HOLDINGS</small>
      </div>

      <div className="worth">
        <div className="lab">Net Worth</div>
        <div className="v">{money(nw)}</div>
        <div className={`chg ${chg >= 0 ? "pos" : "neg"}`}>
          {chg >= 0 ? "▲" : "▼"} {money(Math.abs(chg))} ({pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%)
        </div>
        <div className="mini">
          <span>
            Cash<b>{money(state.cash)}</b>
          </span>
          <span>
            Assets<b>{money(assetsValue(state, "YOU"))}</b>
          </span>
          <span className="debt">
            Debt<b>{money(state.debt)}</b>
          </span>
        </div>
      </div>

      <div className="nav">
        <div className="navh">Floor</div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(t.id)}
          >
            <span className="ic">{t.ic}</span> {t.label}
          </button>
        ))}
        <div className="navh" style={{ marginTop: 14 }}>
          Account
        </div>
        <button
          className={tab === "vault" ? "on" : ""}
          onClick={() => setTab("vault")}
        >
          <span className="ic">⬗</span> My Vault
        </button>
        <button disabled>
          <span className="ic">⚒</span> Factory <span className="soon">soon</span>
        </button>
      </div>

      <div className="rail-foot">
        {mode === "sandbox" && (
          <div className="warp">
            <button
              className={warp === 200 ? "on" : ""}
              onClick={() => setWarp(200)}
            >
              ×200
            </button>
            <button
              className={warp === 2000 ? "on" : ""}
              onClick={() => setWarp(2000)}
            >
              ×2k
            </button>
            <button onClick={jump}>+1</button>
          </div>
        )}
        <div className="clockline">
          {mode === "live" ? (
            <>
              front page turns in{" "}
              <b>~{((1 - state.cycleFrac) * 12).toFixed(1)}h</b>
            </>
          ) : (
            <>
              sandbox · <b>fast clock</b>
            </>
          )}
        </div>
        <div className="modeswitch">
          <button
            className={`live ${mode === "live" ? "on" : ""}`}
            onClick={() => setMode("live")}
          >
            Live
          </button>
          <button
            className={`sandbox ${mode === "sandbox" ? "on" : ""}`}
            onClick={() => setMode("sandbox")}
          >
            Sandbox
          </button>
        </div>
      </div>
    </nav>
  );
}
