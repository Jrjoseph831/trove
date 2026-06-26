"use client";

import {
  ClipboardList,
  Factory,
  FileBarChart,
  Globe,
  LayoutGrid,
  type LucideIcon,
  Newspaper,
  TrendingUp,
  Vault as VaultIcon,
  X,
} from "lucide-react";
import { assetsValue, netWorth } from "@trove/engine";
import { sandboxEnabled } from "@/lib/config";
import { money, pctChange } from "@/lib/format";
import {
  bandProgress,
  gateUnlocked,
  getPeak,
  LADDER,
  nextTierFor,
  tierFor,
} from "@/lib/ladder";
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
    desk,
    startRename,
  } = useTrove();
  const pendingOrders = desk?.orders.filter((o) => o.status === "offer").length ?? 0;
  const go = (t: TabId) => {
    setTab(t);
    setNavOpen(false);
  };

  const nw = netWorth(state, "YOU");
  const prev = state.nwHist[state.nwHist.length - 1] ?? nw;
  const chg = nw - prev;
  const pct = pctChange(nw, prev);

  // The Ladder — rank by peak net worth (never drops mid-stream).
  const peak = Math.max(nw, getPeak());
  const rank = tierFor(peak);
  const nextRank = nextTierFor(peak);
  const prog = bandProgress(peak);
  const factoryOpen = gateUnlocked("factory", peak, state);
  const factoryAt = LADDER.find((t) => t.gate === "factory")?.at ?? 0;

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
        {signedIn && desk?.name ? (
          <span className="brand-holding">{desk.name}</span>
        ) : (
          <>
            TR<b>O</b>VE<small>HOLDINGS</small>
          </>
        )}
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
        {signedIn && desk?.name && (
          <div className="holdingline">
            {desk.name} <span>· rep {desk.reputation}</span>
            <button className="rename-btn" onClick={startRename}>
              edit
            </button>
          </div>
        )}
      </div>

      <div className="ladder">
        <div className="ld-head">
          <span className="ld-lab">Rank</span>
          <span className="ld-name">{rank.name}</span>
        </div>
        {nextRank ? (
          <>
            <div className="ld-bar">
              <i style={{ width: `${Math.round(prog * 100)}%` }} />
            </div>
            <div className="ld-next">
              <span>
                Next · <b>{nextRank.name}</b>
              </span>
              <span className="ld-togo">{money(Math.max(0, nextRank.at - peak))} to go</span>
            </div>
            <div className="ld-unlock">Unlocks {nextRank.unlock}</div>
          </>
        ) : (
          <div className="ld-unlock">Top rank — you're a Titan.</div>
        )}
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
          className={tab === "orders" ? "on" : ""}
          onClick={() => go("orders")}
        >
          <span className="ic">
            <ClipboardList size={15} strokeWidth={1.75} />
          </span>{" "}
          Order Desk
          {pendingOrders > 0 && <span className="navbadge">{pendingOrders}</span>}
        </button>
        <button
          className={tab === "vault" ? "on" : ""}
          onClick={() => go("vault")}
        >
          <span className="ic">
            <VaultIcon size={15} strokeWidth={1.75} />
          </span>{" "}
          My Vault
        </button>
        <button
          className={`${tab === "factory" ? "on" : ""}${factoryOpen ? "" : " locked"}`}
          onClick={() => {
            if (factoryOpen) go("factory");
          }}
          title={factoryOpen ? undefined : `Unlocks at Dealer · ${money(factoryAt)}`}
        >
          <span className="ic">
            <Factory size={15} strokeWidth={1.75} />
          </span>{" "}
          Factory
          {!factoryOpen && <span className="navlock">🔒 {money(factoryAt)}</span>}
        </button>
        <button
          className={tab === "report" ? "on" : ""}
          onClick={() => go("report")}
        >
          <span className="ic">
            <FileBarChart size={15} strokeWidth={1.75} />
          </span>{" "}
          Reports
        </button>
        <button
          className={tab === "companies" ? "on" : ""}
          onClick={() => go("companies")}
        >
          <span className="ic">
            <Globe size={15} strokeWidth={1.75} />
          </span>{" "}
          Companies
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
              <b>~{((1 - state.cycleFrac) * 12).toFixed(1)}h</b>
            </>
          ) : (
            <>
              sandbox · <b>fast clock</b>
            </>
          )}
        </div>
        <ThemeToggle />
        {sandboxEnabled() && (
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
        )}
      </div>
    </nav>
  );
}
