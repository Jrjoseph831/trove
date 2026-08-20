"use client";

import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import { news as newsBank, newsroom, sectorLabel, type SectorKey } from "@trove/data";
import { breakingBeat } from "@/lib/breaking";
import { firmBeat } from "@/lib/firmnews";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { moneyShort } from "@/lib/format";
import { tvtClock } from "@/lib/tvt";
import { tnnLive } from "@/lib/ui";
import { useTrove } from "@/lib/trove";
import { Newsreel, Wheel } from "./Newsreel";

/** A market cycle is 6 real hours and TVT runs at 2×, so one cycle is 12 hours
 *  on the only clock a player is ever shown. */
const TVT_HOURS_PER_CYCLE = 12;

/** A story on the front page. Everything the Wire can publish — a company beat
 *  from the newsroom, a market event, your own house — is flattened into this
 *  one shape, so ranking and layout never have to care where a story came
 *  from. */
interface Article {
  id: string;
  /** Eyebrow: the section it ran under. */
  kicker: string;
  head: string;
  body?: string;
  quote?: string;
  /** Ranking weight — majors lead the page. */
  weight: number;
  /** TVT hours since it broke, or null when it carries no timestamp. */
  agoHours: number | null;
  /** Your own house, which gets a marker but no special billing. */
  mine?: boolean;
  sector?: SectorKey;
}

/** "product_launch" → "Product launch". The newsroom writes these as keys. */
function kindLabel(kind: string): string {
  const s = kind.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function agoLabel(hours: number | null): string | null {
  if (hours == null) return null;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const SIZE_WEIGHT: Record<string, number> = { major: 100, standard: 60, flash: 40 };

export function Wire() {
  const { state, desk, mode, serverNet } = useTrove();
  const [studioOpen, setStudioOpen] = useState(false);
  // The telegraphed market-event Breaking beat — refreshed on its own clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const beat = breakingBeat(now);
  // Your own firm in the news — only when you've earned it (a record period).
  const firm = firmBeat(state, desk?.name ?? null);

  // The whole front page comes out of one ranked pool. The newsroom's company
  // beats are the substance here — each carries a real headline, a reported
  // body and a named company — and until now they only played inside the
  // broadcast modal, which left the page itself running bare sector headlines
  // and reading like a placeholder for the news rather than the news.
  const articles = useMemo<Article[]>(() => {
    const out: Article[] = [];

    for (const b of newsroom.beats ?? []) {
      const age = state.cycle - b.cycle;
      if (age < 0 || age >= b.dur) continue; // off air
      out.push({
        id: `beat:${b.company}:${b.head}`,
        kicker: `${sectorLabel(b.sector)} · ${kindLabel(b.kind)}`,
        head: b.head,
        body: b.body,
        weight: (SIZE_WEIGHT[b.size] ?? 50) - age, // fresher leads among equals
        agoHours: age * TVT_HOURS_PER_CYCLE,
        sector: b.sector,
      });
    }

    if (firm) {
      out.push({
        id: "firm",
        kicker: firm.kicker,
        head: firm.head,
        body: firm.body,
        quote: firm.quote,
        // Ranked on its own merits, like any other house: a record that clears
        // the old one comfortably can lead the page, a routine one sits in the
        // grid. It never jumps the queue just for being yours.
        weight: SIZE_WEIGHT[firm.size] ?? 60,
        agoHours: 0,
        mine: true,
      });
    }

    if (beat) {
      out.push({
        id: `mkt:${beat.slot}`,
        kicker: `Markets · ${beat.kicker}`,
        head: beat.head,
        body: beat.body,
        weight: 90,
        agoHours: 0,
      });
    }

    // The market's own headline and the recent archive fill the page out when
    // the newsroom is quiet.
    if (state.front) {
      out.push({
        id: `front:${state.front.head}`,
        kicker: state.front.kick,
        head: state.front.head,
        body: state.front.body,
        weight: 80,
        agoHours: 0,
      });
    }
    for (const a of state.archive) {
      if (state.front && a.head === state.front.head) continue;
      const n = newsBank.find((x) => x.head === a.head);
      out.push({
        id: `arch:${a.head}`,
        kicker: a.kick,
        head: a.head,
        body: n?.body,
        weight: 30,
        agoHours: null,
      });
    }

    const seen = new Set<string>();
    return out
      .filter((a) => (seen.has(a.head) ? false : (seen.add(a.head), true)))
      .sort((x, y) => y.weight - x.weight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.cycle, firm?.head, beat?.head]);

  const live = tnnLive(state);
  const [lead, ...rest] = articles;
  const secondary = rest.slice(0, 4);
  const briefs = rest.slice(4, 12);

  // One unified board: you + every firm + (live) every other real player, top 8
  // but always including you at your true rank.
  const myLabel = desk?.name?.trim() || "Your Holding";
  const ranked = useLeaderboard(state, mode, myLabel, serverNet);
  const top = ranked.slice(0, 8);
  const me = ranked.find((e) => e.id === "YOU");
  const board = top.some((e) => e.id === "YOU") ? top : me ? [...top, me] : top;

  return (
    <div className="view wire">
      <div className="wire-wrap">
      <header className="wmast">
        <span className="wmast-name">
          The Trove Wire
          <em>Reporting the floor, every turn</em>
        </span>
        <div className="wmast-right">
          <span className="wmast-clock">{tvtClock()} TVT</span>
          <span className={`wmast-live ${live ? "on" : "off"}`}>
            <i />
            {live ? "Live" : "Off-peak"}
          </span>
          <button className="wmast-watch" onClick={() => setStudioOpen(true)}>
            <Radio size={13} /> Watch
          </button>
        </div>
      </header>

      {!lead ? (
        <div className="empty">Quiet on the wire.</div>
      ) : (
        <div className="wpage">
          <main className="wmain">
            <div className="wtop">
              <article className={`wlead ${lead.mine ? "mine" : ""}`}>
                <div className="wkick">
                  <span className="wkick-sec">{lead.kicker}</span>
                  {lead.mine && <span className="wmine">your house</span>}
                  {agoLabel(lead.agoHours) && (
                    <span className="wago">{agoLabel(lead.agoHours)}</span>
                  )}
                </div>
                <h1>{lead.head}</h1>
                {lead.body && <p className="wstand">{lead.body}</p>}
                {lead.quote && <blockquote className="wquote">{lead.quote}</blockquote>}
                <div className="wbyline">By the Trove Wire</div>
              </article>
            </div>

            {secondary.length > 0 && (
              <div className="wgrid">
                {secondary.map((a) => (
                  <article className={`wcol ${a.mine ? "mine" : ""}`} key={a.id}>
                    <div className="wkick">
                      <span className="wkick-sec">{a.kicker}</span>
                      {a.mine && <span className="wmine">your house</span>}
                    </div>
                    <h2>{a.head}</h2>
                    {a.body && <p>{a.body}</p>}
                    {agoLabel(a.agoHours) && (
                      <span className="wago">{agoLabel(a.agoHours)}</span>
                    )}
                  </article>
                ))}
              </div>
            )}

            <div className="wreel">
              <div className="wreel-frame">
                <Wheel
                  embedded
                  mode={live ? "news" : "filler"}
                  onExpand={() => setStudioOpen(true)}
                />
              </div>
            </div>
          </main>

          <aside className="wrail">
            <section className="wpanel">
              <h3>Most valuable</h3>
              {board.map((e) => (
                <div className={`wlb ${e.id === "YOU" ? "me" : ""}`} key={e.id}>
                  <span className="wlb-rk">{e.rank}</span>
                  <span className="wlb-nm">
                    {e.live && e.id !== "YOU" && <i className="wlb-live" />}
                    {e.label}
                  </span>
                  <span className="wlb-v">{moneyShort(e.w)}</span>
                </div>
              ))}
            </section>

            {briefs.length > 0 && (
              <section className="wpanel">
                <h3>Also on the wire</h3>
                {briefs.map((a) => (
                  <div className={`wbrief ${a.mine ? "mine" : ""}`} key={a.id}>
                    <span className="wbrief-kick">{a.kicker}</span>
                    <span className="wbrief-head">{a.head}</span>
                  </div>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}

      </div>
      {studioOpen && <Newsreel onClose={() => setStudioOpen(false)} />}
    </div>
  );
}
