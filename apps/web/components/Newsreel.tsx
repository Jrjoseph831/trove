"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Car,
  Cpu,
  Factory,
  Gem,
  HardHat,
  type LucideIcon,
  Newspaper,
  Pause,
  Play,
  ShoppingBag,
  Shirt,
  Sprout,
  Stethoscope,
  Truck,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import {
  news as newsBank,
  sectorKeys,
  sectorLabel,
  type SectorKey,
} from "@trove/data";
import { netWorth } from "@trove/engine";
import { money, pctChange } from "@/lib/format";
import { moversByAbsMove } from "@/lib/ui";
import { createAmbient } from "@/lib/ambient";
import { useTrove } from "@/lib/trove";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const bgUrl = (name: string) => `${BASE}/news-bg/${name}.png`;

const SECTOR_META: Record<string, { icon: LucideIcon; grad: string }> = {
  construction: { icon: HardHat, grad: "linear-gradient(135deg,#3a2a12,#0d0a06)" },
  logistics: { icon: Truck, grad: "linear-gradient(135deg,#0f2a2e,#07100e)" },
  automotive: { icon: Car, grad: "linear-gradient(135deg,#3a1414,#0d0707)" },
  technology: { icon: Cpu, grad: "linear-gradient(135deg,#10243f,#070b12)" },
  energy: { icon: Zap, grad: "linear-gradient(135deg,#3a2e0e,#0d0a05)" },
  agriculture: { icon: Sprout, grad: "linear-gradient(135deg,#1c3312,#070d05)" },
  manufacturing: { icon: Factory, grad: "linear-gradient(135deg,#28272c,#0a0a0c)" },
  medical: { icon: Stethoscope, grad: "linear-gradient(135deg,#0e2f33,#06100f)" },
  hospitality: { icon: UtensilsCrossed, grad: "linear-gradient(135deg,#33184a,#0e0712)" },
  consumer: { icon: ShoppingBag, grad: "linear-gradient(135deg,#3a1430,#0f070c)" },
  textiles: { icon: Shirt, grad: "linear-gradient(135deg,#241546,#090611)" },
  luxury: { icon: Gem, grad: "linear-gradient(135deg,#3a2c0e,#100b05)" },
};
const meta = (s?: string) =>
  (s && SECTOR_META[s]) || { icon: Newspaper, grad: "linear-gradient(135deg,#1c2029,#0a0b0e)" };

interface Story {
  kick: string;
  head: string;
  body?: string;
  sector?: SectorKey;
}
type Slide =
  | { type: "ident"; dur: number }
  | { type: "segment"; dur: number; sector: SectorKey }
  | { type: "headline"; dur: number; story: Story }
  | { type: "movers"; dur: number }
  | { type: "standings"; dur: number }
  | { type: "bumper"; dur: number };

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Group every in-depth, single-sector story by its sector (built once).
const STORIES_BY_SECTOR: Record<string, Story[]> = (() => {
  const by: Record<string, Story[]> = {};
  for (const n of newsBank) {
    if (!n.body) continue;
    const keys = Object.keys(n.effects ?? {});
    if (keys.length !== 1) continue;
    const sec = keys[0]!;
    (by[sec] ||= []).push({ kick: n.kick, head: n.head, body: n.body, sector: sec });
  }
  return by;
})();

export function Newsreel({ onClose }: { onClose: () => void }) {
  const { state } = useTrove();
  const stateRef = useRef(state);
  stateRef.current = state;
  const loopRef = useRef(0);

  // Build the loop as per-industry segments: a title card, then ~5 in-depth
  // stories for that industry, with data interludes + a bumper between segments.
  const buildSlides = useCallback((): Slide[] => {
    const s = stateRef.current;
    // feature the most active industries first, rotating which lead each loop
    const ordered = [...sectorKeys].sort(
      (a, b) => Math.abs((s.sectorIdx[b] ?? 1) - 1) - Math.abs((s.sectorIdx[a] ?? 1) - 1),
    );
    const off = loopRef.current % ordered.length;
    const featured = [...ordered.slice(off), ...ordered.slice(0, off)].slice(0, 3);
    loopRef.current += 1;

    const slides: Slide[] = [{ type: "ident", dur: 4800 }];
    featured.forEach((sec, i) => {
      slides.push({ type: "segment", sector: sec, dur: 4600 });
      const pool = STORIES_BY_SECTOR[sec] ?? [];
      const startK = pool.length ? (loopRef.current * 5) % pool.length : 0;
      for (let k = 0; k < Math.min(5, pool.length); k++) {
        const story = pool[(startK + k) % pool.length]!;
        slides.push({
          type: "headline",
          story,
          dur: clamp(12000, (story.body?.length ?? 90) * 52, 19000),
        });
      }
      if (i < featured.length - 1) {
        slides.push(i % 2 === 0 ? { type: "movers", dur: 12000 } : { type: "standings", dur: 12000 });
        if (i === 1) slides.push({ type: "bumper", dur: 30000 });
      }
    });
    slides.push({ type: "standings", dur: 12000 });
    return slides;
  }, []);

  const slidesRef = useRef<Slide[]>([]);
  const [, force] = useState(0);
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const ambient = useRef(createAmbient());

  const advance = useCallback(() => {
    setIdx((prev) => {
      const next = prev + 1;
      if (next >= slidesRef.current.length) {
        slidesRef.current = buildSlides();
        force((n) => n + 1);
        return 0;
      }
      return next;
    });
  }, [buildSlides]);

  // auto-advance timer
  useEffect(() => {
    if (!started || paused) return;
    const dur = slidesRef.current[idx]?.dur ?? 12000;
    const t = setTimeout(advance, dur);
    return () => clearTimeout(t);
  }, [idx, started, paused, advance]);

  useEffect(() => {
    const a = ambient.current;
    return () => a.stop();
  }, []);

  const start = () => {
    slidesRef.current = buildSlides();
    setIdx(0);
    setStarted(true);
    ambient.current.start();
  };
  const toggleMute = () => {
    setMuted((m) => {
      ambient.current.setMuted(!m);
      return !m;
    });
  };
  const close = () => {
    ambient.current.stop();
    onClose();
  };

  const mins = Math.floor((state.cycleFrac % 1) * 24 * 60);
  const clock = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const tape = moversByAbsMove(state).slice(0, 12);

  const slide = slidesRef.current[idx];
  const slideSector =
    slide?.type === "headline"
      ? slide.story.sector
      : slide?.type === "segment"
        ? slide.sector
        : undefined;
  const bgName =
    slide?.type === "headline" || slide?.type === "segment"
      ? (slideSector ?? "bumper")
      : "bumper";

  return (
    <div className="reel" role="dialog" aria-label="Trove News Network">
      {/* background */}
      <div className="reel-bg" key={`bg-${bgName}-${idx}`} style={{ background: meta(slideSector).grad }}>
        <img
          className="reel-photo"
          src={bgUrl(bgName)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <div className="reel-scrim" />
      </div>

      {/* top bar */}
      <div className="reel-bar">
        <span className="reel-live">
          <i /> LIVE
        </span>
        <span className="reel-net">TNN · TROVE NEWS NETWORK · {clock}</span>
        <div className="reel-tools">
          <button className="reel-tool" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className="reel-tool" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"} disabled={!started}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button className="reel-tool" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* slide content */}
      {started && slide && (
        <div className="reel-stage" key={idx}>
          {slide.type === "ident" && (
            <div className="reel-ident">
              <Newspaper size={44} />
              <div className="reel-ident-name">TROVE NEWS NETWORK</div>
              <div className="reel-ident-sub">The floor, around the clock</div>
            </div>
          )}

          {slide.type === "segment" && (
            <div className="reel-segment">
              <div className="reel-segment-eyebrow">Now reporting</div>
              <div className="reel-segment-name">{sectorLabel(slide.sector)}</div>
              <div className="reel-segment-rule" />
            </div>
          )}

          {slide.type === "headline" && (
            <div className="reel-lower">
              <div className="reel-kick">{slide.story.kick}</div>
              <h1 className="reel-head">{slide.story.head}</h1>
              {slide.story.body && <p className="reel-body">{slide.story.body}</p>}
            </div>
          )}

          {slide.type === "movers" && (
            <div className="reel-panel">
              <div className="reel-panel-h">On the Move</div>
              <div className="reel-list">
                {moversByAbsMove(state)
                  .filter((m) => m.it.edition === null || m.it.remaining > 0)
                  .slice(0, 7)
                  .map((m) => (
                    <div className="reel-row" key={m.it.id}>
                      <span className="reel-row-nm">
                        <span className="bd">{m.it.brand}</span>
                        {m.it.name}
                      </span>
                      <span className="reel-row-pr">{money(m.it.value)}</span>
                      <span className={`reel-row-chg ${m.dp >= 0 ? "up" : "dn"}`}>
                        {m.dp >= 0 ? "▲" : "▼"} {Math.abs(m.dp).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {slide.type === "standings" && (
            <div className="reel-panel">
              <div className="reel-panel-h">Standings</div>
              <div className="reel-list">
                {[
                  { name: "YOU", w: netWorth(state, "YOU") },
                  ...state.traders.map((t) => ({ name: t.name, w: netWorth(state, t.name) })),
                ]
                  .sort((a, b) => b.w - a.w)
                  .map((e, i) => (
                    <div className={`reel-row ${e.name === "YOU" ? "me" : ""}`} key={e.name}>
                      <span className="reel-row-nm">
                        <span className="rk">{i + 1}</span>
                        {e.name}
                      </span>
                      <span className="reel-row-pr">{money(e.w)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {slide.type === "bumper" && (
            <div className="reel-bumper">
              <Newspaper size={40} />
              <div className="reel-bumper-t">We&apos;ll be right back</div>
              <div className="reel-bumper-bar">
                <i style={{ animationDuration: `${slide.dur}ms` }} />
              </div>
              <div className="reel-bumper-sub">Trove News Network · stay with us</div>
            </div>
          )}
        </div>
      )}

      {/* persistent ticker */}
      <div className="reel-ticker">
        <div className="reel-ticker-run">
          {[...tape, ...tape].map((m, i) => (
            <span key={i}>
              <b>{m.it.brand} {m.it.name}</b> {money(m.it.value)}{" "}
              <span className={m.dp >= 0 ? "up" : "dn"}>
                {m.dp >= 0 ? "▲" : "▼"}
                {Math.abs(m.dp).toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      </div>

      {!started && (
        <button className="reel-start" onClick={start}>
          <Play size={20} /> Start the news wheel
        </button>
      )}
    </div>
  );
}
