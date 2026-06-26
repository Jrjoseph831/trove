"use client";

import { useEffect, useRef, useState } from "react";
import { useTrove } from "@/lib/trove";
import { breakingBeat } from "@/lib/breaking";

/** A subtle, transient "something just broke — go read it" cue. It deliberately
 *  carries NO sector and NO number — the substance (and the read) lives in the
 *  Breaking story on the Wire. Fires once when a new beat foreshadows. */
export function BreakingAlert() {
  const { setTab } = useTrove();
  const [show, setShow] = useState(false);
  const lastSlot = useRef<number | null>(null);
  const synced = useRef(false);

  useEffect(() => {
    const check = () => {
      const beat = breakingBeat(Date.now());
      const slot = beat && beat.phase === "incoming" ? beat.slot : null;
      if (!synced.current) {
        synced.current = true;
        lastSlot.current = slot; // baseline on load — don't flash existing beats
        return;
      }
      if (slot != null && slot !== lastSlot.current) {
        lastSlot.current = slot;
        setShow(true);
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 6500);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;
  return (
    <button
      className="brk-alert"
      onClick={() => {
        setShow(false);
        setTab("wire");
      }}
    >
      <span className="brk-alert-dot" />
      <span className="brk-alert-txt">⚡ Breaking on the Wire</span>
      <span className="brk-alert-cta">Read →</span>
    </button>
  );
}
