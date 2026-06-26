"use client";

import { useEffect, useState } from "react";
import { sectorKeys, sectorLabel } from "@trove/data";
import { activeMarketEvent, nextMarketEvent } from "@trove/engine";

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}

/** The telegraphed market-event banner: counts down to the next sector surge,
 *  then goes LIVE while it fires. Deterministic + global — every viewer sees the
 *  same event at the same moment. */
export function MarketEventBanner() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const active = activeMarketEvent(now, sectorKeys);
  if (active) {
    const pct = Math.round((active.mult - 1) * 100);
    return (
      <div className="mev live">
        <span className="mev-dot" />
        <span className="mev-tag">⚡ Live</span>
        <span className="mev-msg">
          <b>{sectorLabel(active.sector)}</b> demand surge · <b>+{pct}%</b>
        </span>
        <span className="mev-time">ends in {fmt(active.endAt - now)}</span>
      </div>
    );
  }

  const next = nextMarketEvent(now, sectorKeys);
  const left = next.fireAt - now;
  const soon = left < 3 * 60 * 1000;
  return (
    <div className={`mev ${soon ? "soon" : ""}`}>
      <span className="mev-dot" />
      <span className="mev-tag">Incoming</span>
      <span className="mev-msg">
        <b>{sectorLabel(next.sector)}</b> demand surge · +{next.range[0]}–
        {next.range[1]}%
      </span>
      <span className="mev-time">in {fmt(left)}</span>
    </div>
  );
}
