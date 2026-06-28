"use client";

import { useEffect, useRef, useState } from "react";
import { validateHoldingName } from "@trove/data";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";
import { Catalog } from "./Catalog";
import { Companies } from "./Companies";
import { Desk } from "./Desk";
import { Factory as FactoryView } from "./Factory";
import { GoalUp } from "./GoalUp";
import { BreakingAlert } from "./BreakingAlert";
import { Goals } from "./Goals";
import { DealRoom } from "./DealRoom";
import { LadderUp } from "./LadderUp";
import { PropertyMarket } from "./PropertyMarket";
import { DailyReportCard, ReportView } from "./Report";
import { Rail } from "./Rail";
import { Ticker } from "./Ticker";
import { Trending } from "./Trending";
import { Vault } from "./Vault";
import { Wire } from "./Wire";

export function Terminal() {
  const { mounted, mode, tab, navOpen, setNavOpen, reveal } = useTrove();

  // Boot gate: render a deterministic shell on the server and the first client
  // paint (the engine uses randomness, so live data must be client-only).
  if (!mounted) return <BootShell />;

  return (
    <div className={`app ${navOpen ? "navopen" : ""}`}>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <Rail />
      <div className={`main ${mode === "sandbox" ? "sandbox" : ""}`}>
        <div className="topbar">
          <button
            className="navtoggle"
            onClick={() => setNavOpen(!navOpen)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <Clock />
          <Ticker />
        </div>
        {tab === "trending" && <Trending />}
        {tab === "catalog" && <Catalog />}
        {tab === "wire" && <Wire />}
        {tab === "vault" && <Vault />}
        {tab === "orders" && <Desk />}
        {tab === "factory" && <FactoryView />}
        {tab === "estates" && <PropertyMarket />}
        {tab === "deals" && <DealRoom />}
        {tab === "report" && <ReportView />}
        {tab === "companies" && <Companies />}
        {tab === "goals" && <Goals />}
      </div>
      {reveal && <Reveal />}
      <BreakingAlert />
      <LadderUp />
      <GoalUp />
      <Onboarding />
      <DailyReportCard />
      <Toast />
    </div>
  );
}

function BootShell() {
  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          TR<b>O</b>VE<small>HOLDINGS</small>
        </div>
      </nav>
      <div className="main">
        <div className="topbar">
          <div className="tlabel">The Wire</div>
        </div>
        <div className="view">
          <div className="empty">Opening the market…</div>
        </div>
      </div>
    </div>
  );
}

function Reveal() {
  const { reveal, closeReveal } = useTrove();

  // Flash: auto-dismiss after a beat (editions linger a touch longer so the
  // collectible moment registers). Click anywhere to dismiss early.
  const isEd = reveal ? reveal.it.edition !== null : false;
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(closeReveal, isEd ? 3200 : 1900);
    return () => clearTimeout(t);
  }, [reveal, isEd, closeReveal]);

  if (!reveal) return null;
  const { it, copyNo, qty } = reveal;
  const edNum = !isEd
    ? null
    : it.edition === 1
      ? "1 of 1"
      : `№ ${copyNo} of ${it.edition}`;
  const kick =
    qty && qty > 1 ? `Acquired ${qty.toLocaleString()}` : "Acquired";
  // A small non-blocking flash: it floats over the floor, which stays fully
  // visible and clickable behind it (pointer-events: none on the wrapper).
  return (
    <div className="flash-wrap" aria-live="polite">
      <div className={`flash ${isEd ? "ed" : ""}`}>
        <span className="flash-ic">
          <ItemIcon it={it} size={26} />
        </span>
        <span className="flash-txt">
          <span className="flash-kick">
            {kick}
            {edNum ? ` · ${edNum}` : ""}
          </span>
          <span className="flash-nm">
            {it.brand} {it.name}
          </span>
        </span>
      </div>
    </div>
  );
}

// Company-type words; if the player already typed one, we don't add "Holdings".
const FIRM_WORDS = new Set([
  "holdings", "capital", "group", "trading", "co", "co.", "partners", "house",
  "ventures", "industries", "works", "syndicate", "trust", "llc", "inc", "inc.",
  "firm", "exchange", "traders", "mfg", "mfg.", "corp", "corp.", "company",
  "associates", "bros", "bros.", "sons",
]);

/** "Skuvera" → "Skuvera Holdings"; "Veldt Capital" → "Veldt Capital". */
function holdingName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const words = t.toLowerCase().split(" ");
  if (words.some((w) => FIRM_WORDS.has(w))) return t;
  return `${t} Holdings`;
}

function Onboarding() {
  const { signedIn, desk, nameHolding, renaming, cancelRename } = useTrove();
  const [val, setVal] = useState("");
  // Open on first sign-in (no name yet) OR when the player chose to rename.
  const open = !!(signedIn && desk && (!desk.name || renaming));
  const isRename = !!desk?.name;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setVal(isRename ? (desk?.name ?? "") : "");
    wasOpen.current = open;
  }, [open, isRename, desk?.name]);

  if (!open) return null;
  const preview = holdingName(val);
  const check = preview ? validateHoldingName(preview) : { ok: false };
  const submit = () => {
    if (preview && check.ok) nameHolding(preview);
  };
  return (
    <div
      className="reveal-bg show"
      onClick={(e) => {
        if (isRename && e.target === e.currentTarget) cancelRename();
      }}
    >
      <div className="onboard">
        <div className="ob-mark">TROVE</div>
        <div className="ob-h">
          {isRename ? "Rename your Holding" : "Establish your Holding"}
        </div>
        <p className="ob-sub">
          Name your firm — this is how you&apos;ll appear in the
          standings and on every order.
        </p>
        <input
          className="ob-input"
          placeholder="e.g. Skuvera"
          value={val}
          maxLength={32}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <div className={`ob-preview ${preview && !check.ok ? "bad" : ""}`}>
          {!preview
            ? "We'll add “Holdings” unless you include your own (Capital, Group, House…)"
            : check.ok
              ? (
                  <>
                    You&apos;ll trade as <b>{preview}</b>
                  </>
                )
              : check.reason}
        </div>
        <div className="ob-actions">
          {isRename && (
            <button className="ob-cancel" onClick={cancelRename}>
              Cancel
            </button>
          )}
          <button className="ob-go" disabled={!check.ok} onClick={submit}>
            {isRename ? "Save name" : "Open the doors"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** In-game clock. Trove time runs 2× real (a full 24h day every 12 real hours).
 *  Anchored to real time, so the floor's 6-real-hour turns land exactly on
 *  in-game 00:00 and 12:00. Re-renders on the tick. */
const TROVE_SPEED = 2;
function Clock() {
  useTrove(); // subscribe to the render tick
  const DAY = 86_400_000;
  const HALF = DAY / 2; // 12 in-game hours = 6 real hours = one market turn
  const g = (Date.now() * TROVE_SPEED) % DAY; // ms into the in-game day
  const hh = String(Math.floor(g / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((g % 3_600_000) / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((g % 60_000) / 1_000)).padStart(2, "0");
  const left = HALF - (g % HALF); // in-game ms until the next turn
  const nh = Math.floor(left / 3_600_000);
  const nm = Math.floor((left % 3_600_000) / 60_000);
  return (
    <div
      className="clock"
      title="Trove time runs 2× real (a full day every 12 hours). The market turns at 00:00 and 12:00."
    >
      <span className="clock-t">
        {hh}:{mm}
        <span className="clock-s">:{ss}</span> <small>TVT</small>
      </span>
      <span className="clock-n">
        next turn {nh}h {nm}m
      </span>
    </div>
  );
}

function Toast() {
  const { toast } = useTrove();
  return <div className={`toast ${toast ? "show" : ""}`}>{toast ?? ""}</div>;
}
