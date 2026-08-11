"use client";

import { useState } from "react";
import { useTrove } from "@/lib/trove";
import { Ticker } from "./Ticker";

const SEEN_KEY = "trove.landingSeen";

/** The front cover. Shown once per browser session to signed-out visitors so
 *  the site explains itself before dropping anyone into the terminal. Sign In
 *  is the primary path, but "Browse the market" is an equally real one — the
 *  shared world is public; only Acquire/sell requires an account (see
 *  lib/auth.ts) — so this gate invites rather than blocks. */
export function Landing() {
  const { authReady, signedIn, signIn } = useTrove();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(SEEN_KEY) === "1",
  );

  if (!authReady || signedIn || dismissed) return null;

  const enter = () => {
    sessionStorage.setItem(SEEN_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="landing-gate">
      <div className="landing-card">
        <div className="landing-mark">TROVE</div>
        <div className="landing-kick">A shared-world market</div>

        <div className="landing-ticker">
          <Ticker />
        </div>

        <p className="landing-lede">
          Every firm, every price, one shared market. Build a holding, place
          your trades, and watch the wire move.
        </p>

        <div className="landing-actions">
          <button className="landing-go" onClick={signIn}>
            Sign In to Trade
          </button>
          <button className="landing-browse" onClick={enter}>
            Browse the market →
          </button>
        </div>

        <div className="landing-foot">
          Trending · Catalog · The Wire · The Ladder
        </div>
      </div>
    </div>
  );
}
