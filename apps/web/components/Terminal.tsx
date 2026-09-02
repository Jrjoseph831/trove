"use client";

import { useEffect, useRef, useState } from "react";
import { validateHoldingName } from "@trove/data";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";
import { Catalog } from "./Catalog";
import { Companies } from "./Companies";
import { Studio } from "./Studio";
import { Desk } from "./Desk";
import { Factory as FactoryView } from "./Factory";
import { GoalUp } from "./GoalUp";
import { BreakingAlert } from "./BreakingAlert";
import { Goals } from "./Goals";
import { DealRoom } from "./DealRoom";
import { Landing } from "./Landing";
import { LadderUp } from "./LadderUp";
import { PropertyMarket } from "./PropertyMarket";
import { DailyReportCard, ReportView } from "./Report";
import { CommandBar } from "./CommandBar";
import { StatusBar } from "./StatusBar";
import { Trending } from "./Trending";
import { Vault } from "./Vault";
import { Wire } from "./Wire";
import { Reputation } from "./Reputation";

export function Terminal() {
  const { mounted, authReady, mode, tab, reveal, signedIn, signIn, setTab, notify } =
    useTrove();

  // Capture and immediately clean any ?studio= param left by a Stripe redirect.
  // This runs in the lazy initializer (synchronously on first render) so the URL
  // is clean before any child mounts — no child needs to detect it themselves.
  const [studioReturn] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const p = new URLSearchParams(window.location.search).get("studio") ?? "";
    if (p) {
      const u = new URL(window.location.href);
      u.searchParams.delete("studio");
      window.history.replaceState({}, "", u.toString());
    }
    return p;
  });

  // Once the app is fully mounted and auth is resolved, act on the return.
  // Dep array re-triggers when mounted/authReady flip true after a cold load.
  useEffect(() => {
    if (!studioReturn || !mounted || !authReady) return;
    setTab("studio");
    if (studioReturn === "unlocked") notify("Studio unlocked — welcome!");
    else if (studioReturn === "slots-added") notify("+10 product slots added");
  }, [studioReturn, mounted, authReady, setTab, notify]);

  // Boot gate: render a deterministic shell on the server and the first client
  // paint (the engine uses randomness, so live data must be client-only).
  //
  // Waiting for authReady matters as much as waiting for mount. Signed-in is
  // not known until a Cognito token refresh comes back over the network, and
  // until then signedIn is false — which sends the fallback below to the
  // Catalog. That's why a refresh appeared to forget your page: the tab was
  // restored correctly, then overridden for as long as the token call took,
  // which on a slow connection is seconds rather than a flicker. Show the
  // shell until we actually know, then land on the right screen once.
  if (!mounted || !authReady) return <BootShell />;

  // Signed-out visitors browse the Catalog only in the real LIVE world —
  // Sandbox is a private practice world that's never required sign-in, so
  // it stays fully open. Defense in depth against `tab` state ever drifting
  // elsewhere (a stray deep link, a leftover value from before sign-out)
  // even though the command bar isn't mounted in this state.
  const canBrowseFull = signedIn || mode === "sandbox";
  const effectiveTab = canBrowseFull ? tab : "catalog";

  return (
    <div className={`app ${canBrowseFull ? "" : "guest"}`}>
      <div className={`main ${mode === "sandbox" ? "sandbox" : ""}`}>
        {canBrowseFull ? (
          <CommandBar />
        ) : (
          /* Guests get the bar's title block and nothing else: there's one
             destination open to them, and the sign-in ask already lives in
             the guest bar at the bottom with the sentence that explains it. */
          <header className="cmdbar guestbar-top">
            <div className="cb-left">
              <div className="cb-screen">
                <button
                  className="cb-kick cb-kick-btn"
                  onClick={() => window.dispatchEvent(new Event("trove:show-landing"))}
                  title="Back to the front page"
                >
                  Trove
                </button>
                <span className="cb-title">Catalog</span>
              </div>
            </div>
          </header>
        )}
        {effectiveTab === "trending" && <Trending />}
        {effectiveTab === "catalog" && <Catalog />}
        {effectiveTab === "wire" && <Wire />}
        {effectiveTab === "vault" && <Vault />}
        {effectiveTab === "orders" && <Desk />}
        {effectiveTab === "factory" && <FactoryView />}
        {effectiveTab === "estates" && <PropertyMarket />}
        {effectiveTab === "deals" && <DealRoom />}
        {effectiveTab === "report" && <ReportView />}
        {effectiveTab === "companies" && <Companies />}
        {effectiveTab === "studio" && <Studio />}
        {effectiveTab === "goals" && <Goals />}
        {effectiveTab === "reputation" && <Reputation />}
        {canBrowseFull && <StatusBar />}
      </div>
      {!canBrowseFull && (
        <div className="guestbar">
          <button
            className="guestbar-mark"
            onClick={() => window.dispatchEvent(new Event("trove:show-landing"))}
            title="Back to the front page"
          >
            TROVE
          </button>
          <span className="guestbar-txt">
            You&apos;re browsing as a guest — prices are live, but you need an
            account to trade.
          </span>
          <button className="guestbar-cta" onClick={signIn}>
            Sign in to trade
          </button>
        </div>
      )}
      {reveal && <Reveal />}
      <BreakingAlert />
      <LadderUp />
      <GoalUp />
      <Onboarding />
      <DailyReportCard />
      <Toast />
      <Landing />
    </div>
  );
}

/** The deterministic pre-hydration shell. It holds the command bar's exact
 *  shape — same height, same title block — so the real bar drops into place
 *  instead of the page jumping once live data arrives. */
function BootShell() {
  return (
    <div className="app">
      <div className="main">
        <header className="cmdbar">
          <div className="cb-left">
            <div className="cb-screen">
              <span className="cb-kick">Trove Holdings</span>
              <span className="cb-title">Trending</span>
            </div>
          </div>
        </header>
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

const TOUR = [
  {
    h: "The market never stops",
    b: "Prices move with real demand and breaking news on The Wire. Buy low, sell high, right alongside everyone else playing right now.",
  },
  {
    h: "Build something real",
    b: "Stand up a factory, turn raw materials into finished goods, and sell what you make — to the market or under contract.",
  },
  {
    h: "Make your move",
    b: "Buy into another firm's equity, acquire a rival outright in the Deal Room, or grow your holdings in Trove Estates. However you want to build your empire.",
  },
];

function Onboarding() {
  const { signedIn, desk, nameHolding, renaming, cancelRename } = useTrove();
  const [val, setVal] = useState("");
  // 0 = not touring; 1..TOUR.length = a tour screen, shown once right after
  // a first-time naming (not a rename) keeps the same gate open a few beats
  // longer instead of dropping straight onto the floor.
  const [tourStep, setTourStep] = useState(0);
  const needsName = !!(signedIn && desk && !desk.name);
  // Open on first sign-in (no name yet), the player choosing to rename, OR
  // mid-tour (desk.name is already set by then, so needsName alone would
  // close the gate before the tour gets a chance to show).
  const open = !!(signedIn && desk && (needsName || renaming || tourStep > 0));
  const isRename = !!desk?.name;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setVal(isRename ? (desk?.name ?? "") : "");
    wasOpen.current = open;
  }, [open, isRename, desk?.name]);

  if (!open) return null;

  if (tourStep > 0) {
    const last = tourStep === TOUR.length;
    const step = TOUR[tourStep - 1]!;
    return (
      <div className="reveal-bg show">
        <div className="onboard">
          <div className="ob-mark">TROVE</div>
          <div className="ob-dots">
            {TOUR.map((_, i) => (
              <i key={i} className={i < tourStep ? "on" : ""} />
            ))}
          </div>
          <div className="ob-h">{step.h}</div>
          <p className="ob-sub">{step.b}</p>
          <div className="ob-actions">
            <button
              className="ob-go"
              onClick={() => (last ? setTourStep(0) : setTourStep((s) => s + 1))}
            >
              {last ? "Enter the market" : "Next"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Default ON: the suffix is what makes a name read like a firm, and most
  // players want it. But forcing it means someone who wants a bare name is
  // simply told no, which is a silly thing to be told about your own company.
  const [addSuffix, setAddSuffix] = useState(true);
  const preview = addSuffix ? holdingName(val) : val.trim().replace(/\s+/g, " ");
  const check = preview ? validateHoldingName(preview) : { ok: false };
  const submit = () => {
    if (!preview || !check.ok) return;
    nameHolding(preview);
    if (!isRename) setTourStep(1); // first-time only — walk the new player through the tour
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
        <label className="ob-suffix">
          <input
            type="checkbox"
            checked={addSuffix}
            onChange={(e) => setAddSuffix(e.target.checked)}
          />
          Add &ldquo;Holdings&rdquo;
        </label>
        <div className={`ob-preview ${preview && !check.ok ? "bad" : ""}`}>
          {!preview
            ? addSuffix
              ? "We'll add “Holdings” unless you include your own (Capital, Group, House…)"
              : "Your name, exactly as you type it."
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

function Toast() {
  const { toast } = useTrove();
  return <div className={`toast ${toast ? "show" : ""}`}>{toast ?? ""}</div>;
}
