"use client";

import { useEffect, useRef, useState } from "react";
import { useTrove } from "@/lib/trove";
import { ACHIEVEMENTS, completedIds } from "@/lib/goals";

const SEEN_KEY = "trove.goals.seen";

/** Fires the "goal complete" flash when a new achievement is earned during the
 *  session. Syncs a baseline on first load so refreshes don't re-pop earned
 *  goals. */
export function GoalUp() {
  const { state, signedIn } = useTrove();
  const ids = completedIds(state).join(",");
  const [show, setShow] = useState<string | null>(null);
  const synced = useRef(false);

  useEffect(() => {
    if (!signedIn || typeof window === "undefined") return;
    const cur = ids ? ids.split(",") : [];
    const seen = new Set(
      (window.localStorage.getItem(SEEN_KEY) ?? "").split(",").filter(Boolean),
    );
    if (!synced.current) {
      synced.current = true;
      window.localStorage.setItem(SEEN_KEY, cur.join(","));
      return;
    }
    const fresh = cur.find((id) => !seen.has(id));
    if (fresh) {
      window.localStorage.setItem(SEEN_KEY, cur.join(","));
      setShow(fresh);
    }
  }, [ids, signedIn]);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(null), 4200);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;
  const a = ACHIEVEMENTS.find((x) => x.id === show);
  if (!a) return null;
  return (
    <div className="lu-wrap" aria-live="polite" onClick={() => setShow(null)}>
      <div className="lu-card">
        <div className="lu-kick">★ Goal complete</div>
        <div className="lu-name">{a.name}</div>
        <div className="lu-unlock">{a.desc}</div>
      </div>
    </div>
  );
}
