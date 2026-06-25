"use client";

import { useEffect, useState } from "react";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";
import { Catalog } from "./Catalog";
import { Desk } from "./Desk";
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
          <div className="tlabel">The Wire</div>
          <Ticker />
        </div>
        {tab === "trending" && <Trending />}
        {tab === "catalog" && <Catalog />}
        {tab === "wire" && <Wire />}
        {tab === "vault" && <Vault />}
        {tab === "orders" && <Desk />}
      </div>
      {reveal && <Reveal />}
      <Onboarding />
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
          <div className="empty">Opening the floor…</div>
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
  const { signedIn, desk, nameHolding } = useTrove();
  const [val, setVal] = useState("");
  // Shown once: signed in, desk loaded, but no Holding name yet.
  if (!signedIn || !desk || desk.name) return null;
  const preview = holdingName(val);
  const submit = () => {
    if (preview) nameHolding(preview);
  };
  return (
    <div className="reveal-bg show">
      <div className="onboard">
        <div className="ob-mark">TROVE</div>
        <div className="ob-h">Establish your Holding</div>
        <p className="ob-sub">
          Name your house on the floor — this is how you&apos;ll appear in the
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
        <div className="ob-preview">
          {preview ? (
            <>
              You&apos;ll trade as <b>{preview}</b>
            </>
          ) : (
            "We'll add “Holdings” unless you include your own (Capital, Group, House…)"
          )}
        </div>
        <button className="ob-go" disabled={!preview} onClick={submit}>
          Open the doors
        </button>
      </div>
    </div>
  );
}

function Toast() {
  const { toast } = useTrove();
  return <div className={`toast ${toast ? "show" : ""}`}>{toast ?? ""}</div>;
}
