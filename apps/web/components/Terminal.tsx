"use client";

import { useTrove } from "@/lib/trove";
import { Catalog } from "./Catalog";
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
      </div>
      {reveal && <Reveal />}
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
  if (!reveal) return null;
  const { it, copyNo } = reveal;
  const edNum = it.edition === 1 ? "1 of 1" : `№ ${copyNo} of ${it.edition}`;
  const sub =
    it.edition === 1
      ? "The only one in existence."
      : copyNo === it.edition
        ? "The final copy. It's now gone from the floor."
        : "A numbered piece for your vault.";
  return (
    <div
      className="reveal-bg show"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeReveal();
      }}
    >
      <div className="reveal">
        <div className="ic">{it.icon}</div>
        <div className="kick">Acquired</div>
        <div className="nm2">
          {it.brand} {it.name}
        </div>
        <div className="ednum">{edNum}</div>
        <div className="sub2">{sub}</div>
        <button className="close" onClick={closeReveal}>
          Add to vault
        </button>
      </div>
    </div>
  );
}

function Toast() {
  const { toast } = useTrove();
  return <div className={`toast ${toast ? "show" : ""}`}>{toast ?? ""}</div>;
}
