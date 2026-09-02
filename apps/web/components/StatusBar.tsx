"use client";

import { CornerDownLeft, HelpCircle } from "lucide-react";
import { useTrove } from "@/lib/trove";
import { Ticker } from "./Ticker";

/**
 * The bottom rail — the strip a game keeps its context keys on. Left is the
 * one control that teaches the rest of the keyboard; the tape runs through the
 * middle (it belongs at the edge of the screen, not above the content it keeps
 * interrupting); right is the state you glance at without leaving the screen.
 */
export function StatusBar() {
  const { mode, state, tab, setTab } = useTrove();
  return (
    <footer className="statusbar">
      <div className="sb-left">
        <button
          className="sb-key"
          onClick={() => window.dispatchEvent(new Event("trove:shortcuts"))}
        >
          <HelpCircle size={13} strokeWidth={2} />
          Shortcuts <kbd>F1</kbd>
        </button>
        {mode === "sandbox" && (
          <span className="sb-sandbox">Sandbox — private tuning world</span>
        )}
      </div>

      <Ticker />

      <div className="sb-right">
        <span className="sb-turn">
          {mode === "live" ? (
            <>
              next turn <b>~{((1 - state.cycleFrac) * 12).toFixed(1)}h</b>
            </>
          ) : (
            <>
              sandbox · <b>fast clock</b>
            </>
          )}
        </span>
        {tab !== "trending" && (
          <button className="sb-key" onClick={() => setTab("trending")}>
            <CornerDownLeft size={13} strokeWidth={2} />
            Trending <kbd>Esc</kbd>
          </button>
        )}
      </div>
    </footer>
  );
}
