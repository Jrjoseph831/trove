"use client";

import { useEffect, useState } from "react";
import { useTrove } from "@/lib/trove";
import { ACHIEVEMENTS, completedIds } from "@/lib/goals";

const SEEN_KEY = "trove.goals.seen";

/** Fires the "goal complete" flash when a new achievement is earned. Uses a
 *  PERSISTED seen-set as the source of truth so a refresh/login never re-pops an
 *  already-earned goal — even though live state hydrates asynchronously (which
 *  is why an empty-state baseline must never be written). */
export function GoalUp() {
  const { state, signedIn } = useTrove();
  const ids = completedIds(state).join(",");
  const [show, setShow] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn || typeof window === "undefined") return;
    const cur = ids ? ids.split(",") : [];
    if (!cur.length) return; // not loaded yet / nothing earned — leave the baseline alone
    const seen = new Set(
      (window.localStorage.getItem(SEEN_KEY) ?? "").split(",").filter(Boolean),
    );
    const fresh = cur.find((id) => !seen.has(id));
    if (!fresh) return;
    // Persist every currently-complete goal so a later refresh/login won't re-pop.
    window.localStorage.setItem(SEEN_KEY, [...new Set([...seen, ...cur])].join(","));
    setShow(fresh);
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
