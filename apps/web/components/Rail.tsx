"use client";

import {
  Factory,
  LayoutGrid,
  type LucideIcon,
  Newspaper,
  TrendingUp,
  Vault as VaultIcon,
  X,
} from "lucide-react";
import { assetsValue, netWorth } from "@trove/engine";
import { money, pctChange } from "@/lib/format";
import type { TabId } from "@/lib/trove";
import { useTrove } from "@/lib/trove";
import { ThemeToggle } from "./ThemeToggle";

const TABS: { id: TabId; Icon: LucideIcon; label: string }[] = [
  { id: "trending", Icon: TrendingUp, label: "Trending" },
  { id: "catalog", Icon: LayoutGrid, label: "Catalog" },
  { id: "wire", Icon: Newspaper, label: "The Wire" },
];

export function Rail() {
  const {
    state,
    mode,
    tab,
    warp,
    setTab,
    setMode,
    setWarp,
    jump,
    setNavOpen,
    signedIn,
    authReady,
    signIn,
    signOut,
  } = useTrove();
  const go = (t: TabId) => {
    setTab(t);
    setNavOpen(false);
  };

  const nw = netWorth(state, "YOU");
  const prev = state.nwHist[state.nwHist.length - 1] ?? nw;
  const chg = nw - prev;
  const pct = pctChange(nw, prev);

  return (
    <nav className="rail">
      <button
        className="rail-close"
        aria-label="Close menu"
        onClick={() => setNavOpen(false)}
      >
        <X size={20} />
      </button>
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
            onClick={() => go(t.id)}
          >
            <span className="ic">
              <t.Icon size={15} strokeWidth={1.75} />
            </span>{" "}
            {t.label}
          </button>
        ))}
        <div className="navh" style={{ marginTop: 14 }}>
          Account
        </div>
        <button
          className={tab === "vault" ? "on" : ""}
          onClick={() => go("vault")}
        >
          <span className="ic">
            <VaultIcon size={15} strokeWidth={1.75} />
          </span>{" "}
          My Vault
        </button>
        <button disabled>
          <span className="ic">
            <Factory size={15} strokeWidth={1.75} />
          </span>{" "}
          Factory <span className="soon">soon</span>
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
        {mode === "live" && authReady && (
          <div className="accountline">
            {signedIn ? (
              <button className="acct" onClick={signOut}>
                Signed in · <b>sign out</b>
              </button>
            ) : (
              <button className="acct" onClick={signIn}>
                <b>Sign in</b> to acquire
              </button>
            )}
          </div>
        )}
        <div className="clockline">
          {mode === "live" ? (
            <>
              front page turns in{" "}
              <b>~{((1 - state.cycleFrac) * 6).toFixed(1)}h</b>
            </>
          ) : (
            <>
              sandbox · <b>fast clock</b>
            </>
          )}
        </div>
        <ThemeToggle />
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
