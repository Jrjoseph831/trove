"use client";

import { useEffect, useRef, useState } from "react";
import { Briefcase, Building2, ChevronDown, Factory, TrendingUp, Trophy } from "lucide-react";
import { useTrove } from "@/lib/trove";
import { LiveFeed } from "./LiveFeed";
import { Ticker } from "./Ticker";

/** A quiet "there's more" cue — every screen but the last gets one, so
 *  scroll-snap's one-screen-at-a-time feel doesn't read as the end of the
 *  page. */
function ScrollHint() {
  return (
    <div className="landing-scrollhint" aria-hidden="true">
      <ChevronDown size={20} strokeWidth={1.75} />
    </div>
  );
}

const SEEN_KEY = "trove.landingSeen";

const FEATURES = [
  {
    Icon: TrendingUp,
    name: "The Market",
    body: "Every price moves with real supply, demand, and breaking news on The Wire. Nothing is static.",
  },
  {
    Icon: Factory,
    name: "The Factory Floor",
    body: "Stand up production lines, turn raw materials into finished goods, and sell what you make.",
  },
  {
    Icon: Briefcase,
    name: "The Deal Room",
    body: "Buy into another firm's equity, collect dividends, or make a full offer to acquire their company outright.",
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
  { n: 1, h: "Sign up, name your holding", b: "Your firm's identity on the market." },
  { n: 2, h: "Trade the floor", b: "Buy low, sell high, watch prices move with breaking news." },
  {
    n: 3,
    h: "Build & grow",
    b: "Stand up a factory, manufacture your own goods, sell to the market or under contract.",
  },
  { n: 4, h: "Climb the ranks", b: "Grow your net worth, unlock new tools, chase the top of the ladder." },
];

/** The front cover. Shown once per browser session to signed-out visitors so
 *  the site explains itself before dropping anyone into the terminal. Sign In
 *  is the primary path, but "Browse the market" is an equally real one — the
 *  shared world is public; only Acquire/sell requires an account (see
 *  lib/auth.ts) — so this gate invites rather than blocks.
 *
 *  One full-viewport "screen" at a time (CSS scroll-snap) instead of a
 *  compact scrolling page — hero, then the live activity feed, then each
 *  how-to-play step gets its own dominant moment, then the feature grid,
 *  then a closing screen repeating the CTA. */
export function Landing() {
  const { authReady, signedIn, signIn, setTab } = useTrove();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(SEEN_KEY) === "1",
  );
  // `dismissed` is otherwise a one-time read — without this, signing out
  // leaves it stuck at whatever it was during the signed-in session (true
  // if they'd ever clicked "Browse the market" before signing in), so the
  // front cover would never reappear and sign-out would drop straight into
  // a restricted Catalog with no explanation.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) {
      sessionStorage.removeItem(SEEN_KEY);
      setDismissed(false);
    }
    wasSignedIn.current = signedIn;
  }, [signedIn]);

  if (!authReady || signedIn || dismissed) return null;

  const enter = () => {
    sessionStorage.setItem(SEEN_KEY, "1");
    setDismissed(true);
    setTab("catalog");
  };

  const actions = (
    <div className="landing-actions">
      <button className="landing-go" onClick={signIn}>
        Sign In to Trade
      </button>
      <button className="landing-browse" onClick={enter}>
        Browse the market →
      </button>
    </div>
  );

  return (
    <div className="landing-gate">
      <section className="landing-screen landing-hero">
        <div className="landing-inner">
          <div className="landing-mark">TROVE</div>
          <div className="landing-kick">One market. Every firm. Your fortune to build.</div>

          <div className="landing-ticker">
            <Ticker />
          </div>

          <p className="landing-lede">
            A persistent, shared-world market — one global economy where
            prices move in real time, hundreds of firms compete for the
            same customers, and every trade you make is visible to
            everyone else playing right now.
          </p>

          {actions}
        </div>
        <ScrollHint />
      </section>

      <section className="landing-screen landing-screen-feed">
        <div className="landing-inner">
          <div className="landing-screen-kick">Live on the floor</div>
          <LiveFeed />
        </div>
        <ScrollHint />
      </section>

      {STEPS.map((s) => (
        <section className="landing-screen landing-screen-step" key={s.n}>
          <div className="landing-inner">
            <div className="landing-step-bign">{s.n}</div>
            <h2 className="landing-step-bigh">{s.h}</h2>
            <p className="landing-step-bigb">{s.b}</p>
          </div>
          <ScrollHint />
        </section>
      ))}

      <section className="landing-screen landing-screen-features">
        <div className="landing-inner">
          <div className="landing-screen-kick">What's inside</div>
          <div className="landing-features">
            {FEATURES.map((f) => (
              <div className="landing-feature" key={f.name}>
                <f.Icon size={26} strokeWidth={1.6} />
                <div className="landing-feature-h">{f.name}</div>
                <div className="landing-feature-b">{f.body}</div>
              </div>
            ))}
          </div>
          <p className="landing-footnote">
            Every firm has a public storefront — click through and look
            around, no account required.
          </p>
        </div>
        <ScrollHint />
      </section>

      <section className="landing-screen landing-screen-close">
        <div className="landing-inner">
          <div className="landing-mark">TROVE</div>
          {actions}
        </div>
      </section>
    </div>
  );
}
