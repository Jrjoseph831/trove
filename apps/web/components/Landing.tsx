"use client";

import { useState } from "react";
import { Briefcase, Building2, Factory, TrendingUp, Trophy } from "lucide-react";
import { useTrove } from "@/lib/trove";
import { LiveFeed } from "./LiveFeed";
import { Ticker } from "./Ticker";

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
 *  lib/auth.ts) — so this gate invites rather than blocks. */
export function Landing() {
  const { authReady, signedIn, signIn, setTab } = useTrove();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(SEEN_KEY) === "1",
  );

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
      <div className="landing-card landing-full">
        <div className="landing-mark">TROVE</div>
        <div className="landing-kick">One market. Every firm. Your fortune to build.</div>

        <div className="landing-ticker">
          <Ticker />
        </div>

        <p className="landing-lede">
          A persistent, shared-world market — one global economy where prices
          move in real time, hundreds of firms compete for the same
          customers, and every trade you make is visible to everyone else
          playing right now.
        </p>

        {actions}

        <LiveFeed />

        <section className="landing-section">
          <div className="landing-section-h">How to play</div>
          <ol className="landing-steps">
            {STEPS.map((s) => (
              <li className="landing-step" key={s.n}>
                <span className="landing-step-n">{s.n}</span>
                <div>
                  <div className="landing-step-h">{s.h}</div>
                  <div className="landing-step-b">{s.b}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section">
          <div className="landing-section-h">What's inside</div>
          <div className="landing-features">
            {FEATURES.map((f) => (
              <div className="landing-feature" key={f.name}>
                <f.Icon size={20} strokeWidth={1.75} />
                <div className="landing-feature-h">{f.name}</div>
                <div className="landing-feature-b">{f.body}</div>
              </div>
            ))}
          </div>
          <p className="landing-footnote">
            Every firm has a public storefront — click through and look
            around, no account required.
          </p>
        </section>

        {actions}
      </div>
    </div>
  );
}
