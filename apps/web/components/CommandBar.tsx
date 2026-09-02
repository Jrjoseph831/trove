"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Clock as ClockIcon,
  Keyboard,
  Lock,
  Menu,
  Settings2,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { netWorth } from "@trove/engine";
import { sandboxEnabled } from "@/lib/config";
import { money, moneyShort, pctChange } from "@/lib/format";
import { breakingBeat } from "@/lib/breaking";
import { goalsProgress } from "@/lib/goals";
import { DESTS, HOTKEYS, screenTitle, type Dest } from "@/lib/nav";
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

/** Trove time runs 2× real (a full 24h day every 12 real hours). */
const TROVE_SPEED = 2;

type Panel = "firm" | "system" | null;

/**
 * The command bar — the game HUD that replaced the left rail.
 *
 * One strip across the top carries all three things a player checks between
 * actions: where they are (the screen name, left), where they can go (the
 * icon deck, centre) and how they're doing (cash, rank, clock, right). The
 * rail did the same job down the side, but it spent 256px of every screen on
 * navigation that's read for half a second at a time — and it put the
 * storefront's own department list next to a second, unrelated nav.
 *
 * The deck is the part that has to earn its keep: thirteen destinations is a
 * lot for one row, so tiles carry their own colour and hold a fixed position.
 * Muscle memory, not reading, is what makes a game menu fast.
 */
export function CommandBar() {
  const {
    state,
    mode,
    tab,
    warp,
    setTab,
    setMode,
    setWarp,
    jump,
    signedIn,
    authReady,
    signIn,
    signOut,
    desk,
    serverNet,
    startRename,
  } = useTrove();

  const [panel, setPanel] = useState<Panel>(null);
  const [drawer, setDrawer] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);

  const pendingOrders = desk?.orders.filter((o) => o.status === "offer").length ?? 0;
  const goals = goalsProgress(state);
  const breaking = breakingBeat();

  // Live: the SERVER's valuation of this firm — the same figure the board ranks
  // it by. The client can't price an equity stake (it never sees another firm's
  // treasury), so recomputing here disagrees with the leaderboard. Sandbox has
  // no server, so local is truth.
  const nw = mode === "live" && serverNet != null ? serverNet : netWorth(state, "YOU");
  const prev = state.nwHist[state.nwHist.length - 1] ?? nw;
  const chg = nw - prev;
  const pct = pctChange(nw, prev);
  const assets = nw - (state.cash - state.debt);

  const peak = Math.max(nw, getPeak());
  const rank = tierFor(peak);
  const nextRank = nextTierFor(peak);
  const prog = bandProgress(peak);
  const factoryOpen = gateUnlocked("factory", peak, state);
  const factoryAt = LADDER.find((t) => t.gate === "factory")?.at ?? 0;

  const locked = useCallback(
    (id: TabId) => id === "factory" && !factoryOpen,
    [factoryOpen],
  );

  const go = useCallback(
    (id: TabId) => {
      if (locked(id)) return;
      setTab(id);
      setPanel(null);
      setDrawer(false);
    },
    [locked, setTab],
  );

  // ---- keyboard ------------------------------------------------------------
  // A game menu you have to click is a game menu you stop using on stream.
  // 1–9/0 jump straight to a destination, Escape backs out one layer at a
  // time, F1 (or ?) shows the sheet. Typing anywhere real is left alone.
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n || !n.tagName) return false;
      const t = n.tagName.toLowerCase();
      return t === "input" || t === "textarea" || t === "select" || n.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target)) return;
      if (e.key === "Escape") {
        if (keysOpen) setKeysOpen(false);
        else if (drawer) setDrawer(false);
        else if (panel) setPanel(null);
        else if (tab !== "trending") setTab("trending");
        return;
      }
      if (e.key === "F1" || e.key === "?") {
        e.preventDefault();
        setKeysOpen((v) => !v);
        return;
      }
      const hit = HOTKEYS.find((h) => h.key === e.key);
      if (hit) {
        e.preventDefault();
        go(hit.id);
      }
    };
    // The status bar's Shortcuts button raises the same sheet without
    // pretending to be a key press.
    const onAsk = () => setKeysOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("trove:shortcuts", onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("trove:shortcuts", onAsk);
    };
  }, [go, keysOpen, drawer, panel, tab, setTab]);

  // Click-away for the HUD popovers. They hang off the bar, so anything
  // outside the bar closes them — including a click on the view behind.
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setPanel(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [panel]);

  const badgeFor = (d: Dest) => {
    if (d.id === "orders" && pendingOrders > 0)
      return <span className="cb-badge">{pendingOrders}</span>;
    if (d.id === "goals" && goals.done > 0)
      return <span className="cb-badge quiet">{goals.done}</span>;
    if (d.id === "wire" && breaking)
      return (
        <span className="cb-badge live" title="Breaking on the Wire">
          <Zap size={9} strokeWidth={2.6} />
        </span>
      );
    if (locked(d.id))
      return (
        <span className="cb-badge lock">
          <Lock size={9} strokeWidth={2.6} />
        </span>
      );
    return null;
  };

  const tile = (d: Dest) => (
    <button
      key={d.id}
      className={`cb-tile ${tab === d.id ? "on" : ""} ${locked(d.id) ? "locked" : ""}`}
      style={{ "--tone": d.tone } as React.CSSProperties}
      onClick={() => go(d.id)}
      aria-current={tab === d.id ? "page" : undefined}
      title={
        locked(d.id)
          ? `${d.title} — unlocks at Dealer · ${money(factoryAt)}`
          : d.title
      }
    >
      <span className="cb-lab">{d.label}</span>
      <span className="cb-ic">
        <d.Icon size={19} strokeWidth={1.9} />
      </span>
      {badgeFor(d)}
      <span className="cb-dot" aria-hidden />
    </button>
  );

  const market = DESTS.filter((d) => d.group === "market");
  const firm = DESTS.filter((d) => d.group === "firm");

  return (
    <>
      <header className="cmdbar" ref={barRef}>
        <div className="cb-left">
          <button
            className="cb-burger"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
          >
            <Menu size={19} strokeWidth={2} />
          </button>
          <div className="cb-screen">
            <span className="cb-kick">
              {desk?.name ?? "Trove Holdings"}
              {desk?.name && (
                <button className="cb-rename" onClick={startRename} title="Rename your firm">
                  edit
                </button>
              )}
            </span>
            <span className="cb-title">{screenTitle(tab)}</span>
          </div>
        </div>

        <nav className="cb-deck" aria-label="Main navigation">
          {market.map(tile)}
          <span className="cb-sep" aria-hidden />
          {firm.map(tile)}
        </nav>

        <div className="cb-hud">
          <button
            className={`hud-chip wide ${panel === "firm" ? "open" : ""}`}
            onClick={() => setPanel((p) => (p === "firm" ? null : "firm"))}
            title="Net worth — open the firm sheet"
          >
            <Wallet size={14} strokeWidth={1.9} />
            <b>{moneyShort(nw)}</b>
            <i className={chg >= 0 ? "pos" : "neg"}>
              {chg >= 0 ? "▲" : "▼"} {moneyShort(Math.abs(chg))}
            </i>
          </button>
          <div className="hud-chip rank" title={`Rank · ${rank.name}`}>
            <span className="hud-rank-n">{rank.name}</span>
            <span className="hud-rank-bar">
              <i style={{ width: `${Math.round(prog * 100)}%` }} />
            </span>
          </div>
          <div className="hud-chip day" title="Market day">
            <CalendarDays size={14} strokeWidth={1.9} />
            <b>Day {state.cycle}</b>
          </div>
          <Clock />
          <button
            className={`hud-chip icon ${panel === "system" ? "open" : ""}`}
            onClick={() => setPanel((p) => (p === "system" ? null : "system"))}
            aria-label="Settings"
          >
            <Settings2 size={15} strokeWidth={1.9} />
          </button>
        </div>

        {panel === "firm" && (
          <div className="hud-pop firm">
            <div className="worth">
              <div className="lab">Net Worth</div>
              <div className="v">{moneyShort(nw)}</div>
              <div className={`chg ${chg >= 0 ? "pos" : "neg"}`}>
                {chg >= 0 ? "▲" : "▼"} {moneyShort(Math.abs(chg))} (
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(2)}%)
              </div>
              <div className="mini">
                <span>
                  Cash<b>{moneyShort(state.cash)}</b>
                </span>
                <span>
                  Assets<b>{moneyShort(assets)}</b>
                </span>
                <span className="debt">
                  Debt<b>{moneyShort(state.debt)}</b>
                </span>
              </div>
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
                    <span className="ld-togo">
                      {moneyShort(Math.max(0, nextRank.at - peak))} to go
                    </span>
                  </div>
                  <div className="ld-unlock">Unlocks {nextRank.unlock}</div>
                </>
              ) : (
                <div className="ld-unlock">Top rank — you&apos;re a Titan.</div>
              )}
            </div>
          </div>
        )}

        {panel === "system" && (
          <div className="hud-pop system">
            <div className="hp-h">Settings</div>
            <ThemeToggle />
            {mode === "live" && authReady && (
              <button className="hp-row" onClick={signedIn ? signOut : signIn}>
                {signedIn ? (
                  <>
                    Signed in · <b>sign out</b>
                  </>
                ) : (
                  <>
                    <b>Sign in</b> to acquire
                  </>
                )}
              </button>
            )}
            <button
              className="hp-row"
              onClick={() => {
                setPanel(null);
                setKeysOpen(true);
              }}
            >
              <Keyboard size={13} strokeWidth={1.9} /> Keyboard shortcuts
              <span className="hp-key">F1</span>
            </button>
            {mode === "sandbox" && (
              <div className="warp">
                <button className={warp === 200 ? "on" : ""} onClick={() => setWarp(200)}>
                  ×200
                </button>
                <button className={warp === 2000 ? "on" : ""} onClick={() => setWarp(2000)}>
                  ×2k
                </button>
                <button onClick={jump}>+1</button>
              </div>
            )}
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
        )}
      </header>

      {drawer && (
        <div className="cb-drawer" role="dialog" aria-label="Menu">
          <button
            className="cb-drawer-x"
            onClick={() => setDrawer(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
          <div className="cb-drawer-h">Market</div>
          <div className="cb-grid">{market.map(tile)}</div>
          <div className="cb-drawer-h">Your firm</div>
          <div className="cb-grid">{firm.map(tile)}</div>
        </div>
      )}

      {keysOpen && <KeySheet onClose={() => setKeysOpen(false)} />}
    </>
  );
}

/** The shortcut sheet — the F1 screen every game has. */
function KeySheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="keysheet-bg" onClick={onClose}>
      <div className="keysheet" onClick={(e) => e.stopPropagation()}>
        <div className="ks-h">
          Keyboard
          <button className="ks-x" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="ks-grid">
          {HOTKEYS.map((h) => (
            <div className="ks-row" key={h.key}>
              <kbd>{h.key}</kbd>
              <span>{screenTitle(h.id)}</span>
            </div>
          ))}
          <div className="ks-row wide">
            <kbd>Esc</kbd>
            <span>Back out — closes a panel, then returns to Trending</span>
          </div>
          <div className="ks-row wide">
            <kbd>F1</kbd>
            <span>This sheet</span>
          </div>
        </div>
        <p className="ks-foot">
          Shortcuts are off while you&apos;re typing in a field.
        </p>
      </div>
    </div>
  );
}

/** In-game clock, anchored to real time so the floor's 6-real-hour turns land
 *  exactly on in-game 00:00 and 12:00. Re-renders on the tick. */
function Clock() {
  useTrove(); // subscribe to the render tick
  const DAY = 86_400_000;
  const HALF = DAY / 2; // 12 in-game hours = 6 real hours = one market turn
  const g = (Date.now() * TROVE_SPEED) % DAY; // ms into the in-game day
  const hh = String(Math.floor(g / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((g % 3_600_000) / 60_000)).padStart(2, "0");
  const left = HALF - (g % HALF); // in-game ms until the next turn
  const nh = Math.floor(left / 3_600_000);
  const nm = Math.floor((left % 3_600_000) / 60_000);
  return (
    <div
      className="hud-chip clock"
      title="Trove time runs 2× real (a full day every 12 hours). The market turns at 00:00 and 12:00."
    >
      <ClockIcon size={14} strokeWidth={1.9} />
      <b>
        {hh}:{mm}
      </b>
      <i className="clock-next">
        next turn {nh}h {nm}m
      </i>
    </div>
  );
}
