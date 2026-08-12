"use client";

import { useEffect, useRef, useState } from "react";
import { Briefcase, Building2, Factory, TrendingUp, Trophy } from "lucide-react";
import { useTrove } from "@/lib/trove";
import { LandingTape } from "./LandingTape";
import { LiveFeed } from "./LiveFeed";

const FEATURES = [
  {
    Icon: TrendingUp,
    name: "The Market",
    body: "Every price moves with real supply, demand, and breaking news. Nothing is on a script.",
  },
  {
    Icon: Factory,
    name: "The Factory Floor",
    body: "Stand up production lines, turn raw materials into finished goods, and sell what you make.",
  },
  {
    Icon: Briefcase,
    name: "The Deal Room",
    body: "Buy into a rival's equity, collect dividends, or acquire their company outright.",
  },
  {
    Icon: Building2,
    name: "Trove Estates",
    body: "Real estate that appreciates and pays rent — a second economy layered on the first.",
  },
  {
    Icon: Trophy,
    name: "The Ladder",
    body: "Rank up as your net worth grows, unlocking new tools and privileges along the way.",
  },
];

const STEPS = [
  {
    n: "01",
    h: "Claim your holding",
    b: "Pick a name. It's how you'll show up in the standings and on every order you place.",
  },
  {
    n: "02",
    h: "Trade the floor",
    b: "Buy low, sell high, and read the news before the rest of the market does.",
  },
  {
    n: "03",
    h: "Build the machine",
    b: "Stand up factories, turn raw material into product, and supply the firms around you.",
  },
  {
    n: "04",
    h: "Take the top",
    b: "Compound your net worth, acquire your rivals, and climb to the top of the ladder.",
  },
];

/** Fades a section up as it enters the viewport — the standard modern
 *  landing-page reveal, kept subtle so it never delays reading. */
function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Progressive enhancement, deliberately: content is VISIBLE by default and
  // only becomes hideable once this mounts and opts in ("armed"). Starting
  // hidden and relying on JS to reveal means any failure — IO unsupported, a
  // hydration error, a blocked bundle — leaves a blank marketing page, which
  // is the worst possible failure mode for a page whose whole job is
  // converting visitors.
  const [armed, setArmed] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return; // stays visible
    setArmed(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setOn(true);
          io.disconnect(); // reveal once; re-animating on every pass is noise
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`lreveal ${armed ? "armed" : ""} ${on ? "on" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** The front cover, built on the conversion structure these pages
 *  consistently use in the wild (Linear / Raycast / Vercel): a sticky nav
 *  that keeps the CTA permanently reachable, a benefit-led hero with the
 *  live product surface as its visual proof, a stats bar, how-it-works,
 *  features, and a closing CTA. Continuous scroll on purpose — mandatory
 *  scroll-snap paces information slower than visitors read and is a known
 *  drop-off driver. */
export function Landing() {
  const { authReady, signedIn, signIn, setTab, state } = useTrove();
  // In-memory only, deliberately NOT persisted. The rule is: every visit to
  // the site lands on the front page unless you're signed in, in which case
  // you go straight to the game. "Browse the market" still gets a guest into
  // the catalog for that visit, but it doesn't buy them a permanent bypass —
  // a reload or a return trip shows the pitch again, which is the whole
  // point of having one.
  const [dismissed, setDismissed] = useState(false);
  const [stuck, setStuck] = useState(false);
  const gateRef = useRef<HTMLDivElement>(null);

  // Signing out drops you back to the front page rather than into a
  // restricted catalog with no explanation.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) setDismissed(false);
    wasSignedIn.current = signedIn;
  }, [signedIn]);

  // Guests have no nav, so the guest bar's wordmark dispatches this to get
  // back here without needing a reload.
  useEffect(() => {
    const show = () => setDismissed(false);
    window.addEventListener("trove:show-landing", show);
    return () => window.removeEventListener("trove:show-landing", show);
  }, []);

  // Depends on authReady/signedIn too: the gate returns null until auth
  // resolves, so on first run gateRef.current is still null. Without those
  // deps the effect never re-ran once the element actually mounted and the
  // nav never picked up its scrolled background.
  useEffect(() => {
    const el = gateRef.current;
    if (!el) return;
    const onScroll = () => setStuck(el.scrollTop > 24);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [dismissed, authReady, signedIn]);

  if (!authReady || signedIn || dismissed) return null;

  const enter = () => {
    setDismissed(true);
    setTab("catalog");
  };

  const firms = state.traders.length;
  const goods = state.items.length;

  return (
    <div className="landing-gate" ref={gateRef}>
      <header className={`lnav ${stuck ? "stuck" : ""}`}>
        <div className="lnav-in">
          <span className="lnav-mark">TROVE</span>
          <nav className="lnav-actions">
            <button className="lnav-ghost" onClick={enter}>
              Browse the market
            </button>
            <button className="lnav-cta" onClick={signIn}>
              Sign In
            </button>
          </nav>
        </div>
      </header>

      <section className="lsec lhero">
        <div className="landing-glow" aria-hidden="true" />
        <div className="lwrap">
          <div className="lhero-grid">
            <div className="lhero-copy">
              <div className="lhero-proof">
                <span className="lhero-proof-dot" />
                {firms.toLocaleString()} firms trading right now
              </div>
              <h1 className="lhero-h1">
                Build an empire in a market that never stops.
              </h1>
              <p className="lhero-sub">
                TROVE is a persistent, shared-world economy. Prices move in
                real time, hundreds of firms compete for the same customers,
                and the world keeps running whether you're online or not.
              </p>
              <div className="lhero-cta">
                <button className="lbtn lbtn-primary" onClick={signIn}>
                  Start trading — it's free
                </button>
                <button className="lbtn lbtn-ghost" onClick={enter}>
                  Browse the market →
                </button>
              </div>
              <div className="lhero-note">
                No account needed to look around.
              </div>
            </div>

            <div className="lhero-panel">
              <div className="lpanel-label">Live floor activity</div>
              <LiveFeed />
            </div>
          </div>
        </div>
        <div className="lhero-tape">
          <LandingTape />
        </div>
      </section>

      <section className="lsec lstats-sec">
        <div className="lwrap">
          <Reveal>
            <div className="lstats">
              <div className="lstat">
                <b>{firms.toLocaleString()}</b>
                <span>Firms on the floor</span>
              </div>
              <div className="lstat">
                <b>{goods.toLocaleString()}</b>
                <span>Goods being traded</span>
              </div>
              <div className="lstat">
                <b>24/7</b>
                <span>The economy runs</span>
              </div>
              <div className="lstat">
                <b>6h</b>
                <span>Every market turn</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="lsec">
        <div className="lwrap">
          <Reveal>
            <div className="lsec-head">
              <div className="lsec-kick">How it works</div>
              <h2 className="lsec-h2">From one trade to a holding company.</h2>
            </div>
            <div className="lsteps">
              {STEPS.map((s) => (
                <div className="lstep" key={s.n}>
                  <div className="lstep-n">{s.n}</div>
                  <h3 className="lstep-h">{s.h}</h3>
                  <p className="lstep-b">{s.b}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="lsec">
        <div className="lwrap">
          <Reveal>
            <div className="lsec-head">
              <div className="lsec-kick">What's inside</div>
              <h2 className="lsec-h2">Five ways to grow what you own.</h2>
            </div>
            <div className="landing-features">
              {FEATURES.map((f) => (
                <div className="landing-feature" key={f.name}>
                  <f.Icon size={22} strokeWidth={1.6} />
                  <div className="landing-feature-h">{f.name}</div>
                  <div className="landing-feature-b">{f.body}</div>
                </div>
              ))}
            </div>
            <p className="landing-footnote">
              Every firm has a public storefront — click through and look
              around, no account required.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="lsec lfinal">
        <div className="landing-glow" aria-hidden="true" />
        <div className="lwrap">
          <Reveal>
            <h2 className="lfinal-h">Every empire starts with one trade.</h2>
            <p className="lfinal-sub">
              The market is open and the firms are already moving. Claim your
              holding and get in.
            </p>
            <div className="lhero-cta lfinal-cta">
              <button className="lbtn lbtn-primary" onClick={signIn}>
                Start trading — it's free
              </button>
              <button className="lbtn lbtn-ghost" onClick={enter}>
                Browse the market →
              </button>
            </div>
          </Reveal>
          <div className="lfoot">TROVE · a shared-world market</div>
        </div>
      </section>
    </div>
  );
}
