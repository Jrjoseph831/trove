"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns a value recomputed only on a slow cadence (every `ms`), NOT on every
 * render. The app re-renders ~5×/s, and prices move continuously in sandbox /
 * refresh on each live poll — reading them straight into the ticker + movers made
 * the numbers and ordering churn ("spammy fluctuating"). This freezes the display
 * to a calm periodic snapshot instead.
 *
 * `compute` may read mutable state; it's captured fresh at each tick. Pass `bump`
 * (e.g. the market cycle) to force an immediate new snapshot when it changes.
 */
export function useSnapshot<T>(compute: () => T, ms: number, bump?: unknown): T {
  const ref = useRef(compute);
  ref.current = compute;
  const [snap, setSnap] = useState<T>(() => compute());
  useEffect(() => {
    setSnap(ref.current()); // refresh immediately when bump changes
    const t = setInterval(() => setSnap(ref.current()), ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, bump]);
  return snap;
}
