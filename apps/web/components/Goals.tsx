"use client";

import { Check, Lock } from "lucide-react";
import { useTrove } from "@/lib/trove";
import { ACHIEVEMENTS } from "@/lib/goals";

export function Goals() {
  const { state } = useTrove();
  const done = new Set(
    ACHIEVEMENTS.filter((a) => a.done(state)).map((a) => a.id),
  );
  const count = done.size;
  const total = ACHIEVEMENTS.length;

  return (
    <div className="view goals">
      <div className="cat-head">
        <h2 className="serif">Goals</h2>
      </div>

      <div className="gl-head">
        <span className="gl-count">
          {count}
          <small> / {total}</small>
        </span>
        <div className="gl-bar">
          <i style={{ width: `${(count / total) * 100}%` }} />
        </div>
        <span className="gl-sub">
          {count === total
            ? "All cleared — you're a machine."
            : `${total - count} to go`}
        </span>
      </div>

      <div className="gl-grid">
        {ACHIEVEMENTS.map((a) => {
          const ok = done.has(a.id);
          return (
            <div key={a.id} className={`gl-card ${ok ? "done" : ""}`}>
              <span className="gl-ic">
                {ok ? (
                  <Check size={16} strokeWidth={2.5} />
                ) : (
                  <Lock size={13} strokeWidth={2} />
                )}
              </span>
              <div className="gl-body">
                <span className="gl-name">{a.name}</span>
                <span className="gl-desc">{a.desc}</span>
              </div>
              {ok && <span className="gl-tag">Done</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
