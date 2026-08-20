"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { fetchReputation, unlockNode, type RepNodeStatus, type RepView } from "@/lib/api";
import { useTrove } from "@/lib/trove";
import { money } from "@/lib/format";

const HEAT_TIERS = ["CLEAN", "WATCHED", "FLAGGED", "UNDER INVESTIGATION"] as const;
const REP_THRESHOLDS = [50, 150, 400] as const;

function progressTo(rep: number): { pct: number; toNext: number | null; tier: number } {
  for (let i = 0; i < REP_THRESHOLDS.length; i++) {
    const at = REP_THRESHOLDS[i];
    if (rep < at) {
      const prev = i === 0 ? 0 : REP_THRESHOLDS[i - 1];
      return { pct: (rep - prev) / (at - prev), toNext: at - rep, tier: i + 1 };
    }
  }
  return { pct: 1, toNext: null, tier: 3 };
}

export function Reputation() {
  const { signedIn, notify } = useTrove();
  const [view, setView] = useState<RepView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!signedIn) return;
    fetchReputation().then(setView).catch((e: Error) => setLoadErr(e.message ?? "failed to load"));
  }, [signedIn]);

  useEffect(load, [load]);

  const handleUnlock = async (node: RepNodeStatus) => {
    if (busy) return;
    setBusy(node.id);
    const res = await unlockNode(node.id);
    setBusy(null);
    if ("error" in res) {
      notify(res.error);
    } else {
      setView(res);
      notify(`${node.name} unlocked`);
    }
  };

  if (!signedIn) {
    return (
      <div className="view rep-view">
        <div className="cat-head"><h2 className="serif">Reputation</h2></div>
        <div className="empty">Sign in to view your reputation.</div>
      </div>
    );
  }
  if (loadErr) {
    return (
      <div className="view rep-view">
        <div className="cat-head"><h2 className="serif">Reputation</h2></div>
        <div className="empty">{loadErr}</div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="view rep-view">
        <div className="cat-head"><h2 className="serif">Reputation</h2></div>
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const shadowNodes = view.nodes.filter((n) => n.branch === "shadow");
  const legitNodes = view.nodes.filter((n) => n.branch === "legit");
  const sp = progressTo(view.shadowRep);
  const lp = progressTo(view.legitRep);
  const heatIdx = HEAT_TIERS.indexOf(view.heatTier);

  return (
    <div className="view rep-view">
      <div className="cat-head">
        <h2 className="serif">Reputation</h2>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>
          {view.unlockedNodes.length} / 6 nodes unlocked
        </span>
      </div>

      <div className="bento">
        {/* ── Shadow Rep ─────────────────────────────────────── */}
        <div className="bento-card col-6 rep-card">
          <div className="bc-h">
            <span className="t">Shadow Reputation</span>
            <span className="why">lifetime · never resets</span>
          </div>
          <div className="rep-score rep-score-shadow">{view.shadowRep}</div>
          <div className="rep-track-wrap">
            <div className="rep-track">
              <i className="rep-fill rep-fill-shadow" style={{ transform: `scaleX(${sp.pct.toFixed(3)})` }} />
            </div>
            <span className="rep-thresh">
              {sp.toNext != null
                ? <>{sp.toNext} to unlock Tier {sp.tier}</>
                : "All tiers met"}
            </span>
          </div>
          <p className="rep-desc">
            Earned through risky moves, market intelligence, and deliberate opacity.
            Gates the Shadow branch of the skill tree.
          </p>
        </div>

        {/* ── Legit Rep ──────────────────────────────────────── */}
        <div className="bento-card col-6 rep-card">
          <div className="bc-h">
            <span className="t">Legit Reputation</span>
            <span className="why">lifetime · never resets</span>
          </div>
          <div className="rep-score rep-score-legit">{view.legitRep}</div>
          <div className="rep-track-wrap">
            <div className="rep-track">
              <i className="rep-fill rep-fill-legit" style={{ transform: `scaleX(${lp.pct.toFixed(3)})` }} />
            </div>
            <span className="rep-thresh">
              {lp.toNext != null
                ? <>{lp.toNext} to unlock Tier {lp.tier}</>
                : "All tiers met"}
            </span>
          </div>
          <p className="rep-desc">
            Earned through transparent operation, fulfilled contracts, and clean filings.
            Gates the Legit branch of the skill tree.
          </p>
        </div>

        {/* ── Heat Meter ─────────────────────────────────────── */}
        <div className="bento-card col-12 heat-card">
          <div className="bc-h">
            <span className="t">Market Heat</span>
            <span className="why">volatile · decays 1pt per 5 min</span>
          </div>
          <div className="heat-body">
            <div className={`heat-tier-name heat-name-${heatIdx}`}>{view.heatTier}</div>
            <div className="heat-meter">
              <div className="heat-track">
                <i className={`heat-fill heat-fill-${heatIdx}`} style={{ transform: `scaleX(${(view.heat / 100).toFixed(3)})` }} />
              </div>
              <div className="heat-labels">
                {HEAT_TIERS.map((t, i) => (
                  <span key={t} className={`heat-label ${i <= heatIdx ? "on" : ""}`}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <p className="rep-desc heat-note">
              Heat rises with every risky action. <b>Under Investigation</b> carries bust risk each settlement.
              Stays dormant until your next action — decays automatically.
            </p>
          </div>
        </div>

        {/* ── Skill Tree ─────────────────────────────────────── */}
        <div className="bento-card col-12 tree-card">
          <div className="bc-h">
            <span className="t">Skill Tree</span>
            <span className="why">permanent · cross-branch friction +5% per opposing node</span>
          </div>
          <div className="tree-grid">
            <div className="tree-branch">
              <span className="eyebrow tree-branch-label tree-shadow-lbl">Shadow</span>
              <div className="tree-nodes">
                {shadowNodes.map((n) => (
                  <NodeCard key={n.id} node={n} onUnlock={handleUnlock} busy={busy === n.id} />
                ))}
              </div>
            </div>
            <div className="tree-branch">
              <span className="eyebrow tree-branch-label tree-legit-lbl">Legit</span>
              <div className="tree-nodes">
                {legitNodes.map((n) => (
                  <NodeCard key={n.id} node={n} onUnlock={handleUnlock} busy={busy === n.id} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  onUnlock,
  busy,
}: {
  node: RepNodeStatus;
  onUnlock: (n: RepNodeStatus) => void;
  busy: boolean;
}) {
  return (
    <div className={`node-card node-${node.state}`}>
      <div className="node-head">
        <span className="node-tier-badge">T{node.tier}</span>
        <span className="node-state-icon">
          {node.state === "unlocked"
            ? <Check size={12} strokeWidth={2.5} />
            : <Lock size={11} strokeWidth={2} />}
        </span>
      </div>
      <div className="node-name">{node.name}</div>
      <p className="node-desc">{node.description}</p>
      <div className="node-footer">
        <span className="node-req">{node.repRequired} rep · {money(node.cost)}</span>
        {node.state === "eligible" && (
          <button
            className="node-unlock-btn"
            onClick={() => onUnlock(node)}
            disabled={busy}
          >
            {busy ? "…" : "Unlock"}
          </button>
        )}
        {node.state === "locked" && node.blockedBy && (
          <span className="node-blocked">{node.blockedBy}</span>
        )}
      </div>
    </div>
  );
}
