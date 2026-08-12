"use client";

import { useEffect, useRef, useState } from "react";
import { Briefcase, Building2, ChevronDown, Factory, TrendingUp, Trophy } from "lucide-react";
import { useTrove } from "@/lib/trove";
import { LandingTape } from "./LandingTape";
import { LiveFeed } from "./LiveFeed";

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
  {
    n: 1,
    h: "Sign up, name your holding",
    b: "Your firm's identity on the market — it's how you'll appear in the standings and on every order.",
  },
  {
    n: 2,
    h: "Trade the floor",
    b: "Buy low, sell high, and watch prices move with breaking news across every sector.",
  },
  {
    n: 3,
    h: "Build & grow",
    b: "Stand up a factory, manufacture your own goods, and sell to the market or under contract.",
  },
  {
    n: 4,
    h: "Climb the ranks",
    b: "Grow your net worth, unlock new tools, and chase the top of the ladder.",
  },
];

/** Reveals its children once scrolled into view — the whole page is
 *  scroll-snapped, so each screen gets its moment as it arrives instead of
 *  being pre-rendered flat. */
function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), {
      threshold: 0.35,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lreveal ${on ? "on" : ""} ${className}`}>
      {children}
    </div>
  );
}

function ScrollHint() {
  return (
    <div className="landing-scrollhint" aria-hidden="true">
      <ChevronDown size={20} strokeWidth={1.75} />
    </div>
  );
}

/** The front cover: a full-screen, scroll-snapped pitch shown once per
 *  browser session to signed-out visitors. Sign In is the primary path, but
 *  "Browse the market" is an equally real one — the shared world is public;
 *  only Acquire/sell requires an account. */
export function Landing() {
  const { authReady, signedIn, signIn, setTab, state } = useTrove();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(SEEN_KEY) === "1",
  );
  const [progress, setProgress] = useState(0);
  const gateRef = useRef<HTMLDivElement>(null);

  // `dismissed` is otherwise a one-time read — without this, signing out
  // leaves it stuck at whatever it was during the signed-in session, so the
  // front cover would never reappear.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) {
      sessionStorage.removeItem(SEEN_KEY);
      setDismissed(false);
    }
    wasSignedIn.current = signedIn;
  }, [signedIn]);

  useEffect(() => {
    const el = gateRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? el.scrollTop / max : 0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [dismissed]);

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

  const firms = state.traders.length;
  const goods = state.items.length;

  return (
    <div className="landing-gate" ref={gateRef}>
      <div className="landing-progress" style={{ transform: `scaleX(${progress})` }} />

      <section className="landing-screen landing-hero">
        <div className="landing-glow" aria-hidden="true" />
        <div className="landing-inner">
          <div className="landing-eyebrow">
            <i /> The market is open
          </div>
          <h1 className="landing-mark">TROVE</h1>
          <div className="landing-kick">One market. Every firm. Your fortune to build.</div>

          <p className="landing-lede">
            A persistent, shared-world economy where prices move in real
            time, hundreds of firms compete for the same customers, and
            every trade is visible to everyone playing right now.
          </p>

          {actions}

          <div className="landing-stats">
            <div className="lstat">
              <b>{firms.toLocaleString()}</b>
              <span>firms trading</span>
            </div>
            <div className="lstat">
              <b>{goods.toLocaleString()}</b>
              <span>goods on the market</span>
            </div>
            <div className="lstat">
              <b>24/7</b>
              <span>the world keeps running</span>
            </div>
          </div>
        </div>
        <div className="landing-tapewrap">
          <LandingTape />
        </div>
        <ScrollHint />
      </section>

      <section className="landing-screen landing-screen-feed">
        <div className="landing-inner">
          <Reveal>
            <div className="landing-screen-kick">Happening right now</div>
            <h2 className="landing-screen-h">The floor never sleeps.</h2>
          </Reveal>
          <LiveFeed />
        </div>
        <ScrollHint />
      </section>

      {STEPS.map((s) => (
        <section className="landing-screen landing-screen-step" key={s.n}>
          <div className="landing-inner">
            <Reveal>
              <div className="landing-step-bign">{String(s.n).padStart(2, "0")}</div>
              <h2 className="landing-step-bigh">{s.h}</h2>
              <p className="landing-step-bigb">{s.b}</p>
            </Reveal>
          </div>
          <ScrollHint />
        </section>
      ))}

      <section className="landing-screen landing-screen-features">
        <div className="landing-inner">
          <Reveal>
            <div className="landing-screen-kick">What's inside</div>
            <div className="landing-features">
              {FEATURES.map((f) => (
                <div className="landing-feature" key={f.name}>
                  <f.Icon size={24} strokeWidth={1.6} />
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
        <ScrollHint />
      </section>

      <section className="landing-screen landing-screen-close">
        <div className="landing-glow" aria-hidden="true" />
        <div className="landing-inner">
          <Reveal>
            <h2 className="landing-closeh">Every empire starts with one trade.</h2>
            <div className="landing-mark landing-mark-sm">TROVE</div>
            {actions}
          </Reveal>
        </div>
      </section>
    </div>
  );
}
