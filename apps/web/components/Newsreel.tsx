"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Car,
  Cloud,
  CloudLightning,
  CloudSun,
  Cpu,
  Factory,
  Gem,
  HardHat,
  type LucideIcon,
  Megaphone,
  Newspaper,
  Pause,
  Play,
  ShoppingBag,
  Shirt,
  Sprout,
  Stethoscope,
  Sun,
  Timer,
  Truck,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import {
  ads,
  news as newsBank,
  newsroom,
  sectorKeys,
  sectorLabel,
  type AdSpot,
  type AdTone,
  type SectorKey,
} from "@trove/data";
import { netWorth, type WorldState } from "@trove/engine";
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
  | { type: "bumper"; dur: number }
  | { type: "weather"; dur: number; sectors: SectorKey[] }
  | { type: "ad"; dur: number; ad: AdSpot }
  | { type: "comingup"; dur: number };

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── Off-peak filler ──────────────────────────────────────────────────────────
/** Backdrop gradient per ad tone (shown under the optional ad-<tone>.png art). */
const AD_GRAD: Record<AdTone, string> = {
  tech: "linear-gradient(135deg,#10243f,#070b12)",
  food: "linear-gradient(135deg,#3a2412,#0d0805)",
  smoke: "linear-gradient(135deg,#241c16,#0b0907)",
  lux: "linear-gradient(135deg,#3a2c0e,#100b05)",
  street: "linear-gradient(135deg,#1c1c22,#08080a)",
  studio: "linear-gradient(135deg,#222329,#0a0b0e)",
};

/** A sector's "weather" from its index — playful, but it tracks the real floor. */
function forecast(idx: number): { Icon: LucideIcon; sky: string; note: string } {
  if (idx >= 1.06) return { Icon: Sun, sky: "Sunny", note: "warming · indices firm" };
  if (idx >= 1.0) return { Icon: CloudSun, sky: "Mild", note: "steady" };
  if (idx >= 0.94) return { Icon: Cloud, sky: "Overcast", note: "easing" };
  return { Icon: CloudLightning, sky: "Storm warning", note: "under pressure" };
}

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

// Live company beats from the newsroom, grouped by their home sector. These
// drive each segment first — the featured houses ARE the story.
const BEATS_BY_SECTOR: Record<string, Story[]> = (() => {
  const by: Record<string, Story[]> = {};
  for (const b of newsroom.beats ?? []) {
    (by[b.sector] ||= []).push({
      kick: b.company.toUpperCase(),
      head: b.head,
      body: b.body,
      sector: b.sector,
    });
  }
  return by;
})();

/** Off-peak filler rundown: ident → weather → ads (with a bumper) → coming up. */
function buildFiller(s: WorldState, loop: { current: number }): Slide[] {
  const slides: Slide[] = [{ type: "ident", dur: 4200 }];
  const wsect = [...sectorKeys]
    .sort(
      (a, b) =>
        Math.abs((s.sectorIdx[b] ?? 1) - 1) - Math.abs((s.sectorIdx[a] ?? 1) - 1),
    )
    .slice(0, 6) as SectorKey[];
  slides.push({ type: "weather", dur: 13000, sectors: wsect });

  // Rotate through the commercial bank, 3 spots per filler block.
  const start = (loop.current * 3) % Math.max(1, ads.length);
  for (let i = 0; i < 3; i++) {
    const ad = ads[(start + i) % ads.length]!;
    slides.push({ type: "ad", dur: 8500, ad });
    if (i === 0) slides.push({ type: "bumper", dur: 8000 });
  }
  slides.push({ type: "comingup", dur: 12000 });
  loop.current += 1;
  return slides;
}

export function Newsreel({ onClose }: { onClose: () => void }) {
  return <Wheel mode="news" onClose={onClose} />;
}

export function Wheel({
  mode = "news",
  embedded = false,
  onClose,
}: {
  mode?: "news" | "filler";
  embedded?: boolean;
  onClose?: () => void;
}) {
  const { state } = useTrove();
  const stateRef = useRef(state);
  stateRef.current = state;
  const loopRef = useRef(0);

  // Build the loop as per-industry segments: a title card, then ~5 in-depth
  // stories for that industry, with data interludes + a bumper between segments.
  const buildSlides = useCallback((): Slide[] => {
    const s = stateRef.current;
    if (mode === "filler") return buildFiller(s, loopRef);
    // feature industries with live company news first, then the most active —
    // rotating which lead each loop so the wheel stays fresh.
    const ordered = [...sectorKeys].sort((a, b) => {
      const beatGap = (BEATS_BY_SECTOR[b]?.length ?? 0) - (BEATS_BY_SECTOR[a]?.length ?? 0);
      if (beatGap !== 0) return beatGap;
      return Math.abs((s.sectorIdx[b] ?? 1) - 1) - Math.abs((s.sectorIdx[a] ?? 1) - 1);
    });
    const off = loopRef.current % ordered.length;
    const featured = [...ordered.slice(off), ...ordered.slice(0, off)].slice(0, 3);
    loopRef.current += 1;

    const slides: Slide[] = [{ type: "ident", dur: 4800 }];
    featured.forEach((sec, i) => {
      slides.push({ type: "segment", sector: sec, dur: 4600 });
      // lead with the house storylines, then fill with the in-depth bank
      const beats = BEATS_BY_SECTOR[sec] ?? [];
      const bank = STORIES_BY_SECTOR[sec] ?? [];
      const lead = beats.slice(0, 3);
      const fill: Story[] = [];
      const need = 5 - lead.length;
      const startK = bank.length ? (loopRef.current * 5) % bank.length : 0;
      for (let k = 0; k < Math.min(need, bank.length); k++) {
        fill.push(bank[(startK + k) % bank.length]!);
      }
      for (const story of [...lead, ...fill]) {
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
  }, [mode]);

  const slidesRef = useRef<Slide[]>([]);
  const [, force] = useState(0);
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(embedded);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const ambient = useRef(embedded ? null : createAmbient());

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

  // Embedded: autostart, and rebuild the deck whenever the mode flips (the
  // front page swaps news↔filler at the top-of-hour bell automatically).
  useEffect(() => {
    if (!embedded) return;
    slidesRef.current = buildSlides();
    setIdx(0);
    force((n) => n + 1);
  }, [embedded, buildSlides]);

  // auto-advance timer
  useEffect(() => {
    if (!started || paused) return;
    const dur = slidesRef.current[idx]?.dur ?? 12000;
    const t = setTimeout(advance, dur);
    return () => clearTimeout(t);
  }, [idx, started, paused, advance]);

  useEffect(() => {
    const a = ambient.current;
    return () => a?.stop();
  }, []);

  const start = () => {
    slidesRef.current = buildSlides();
    setIdx(0);
    setStarted(true);
    ambient.current?.start();
  };
  const toggleMute = () => {
    setMuted((m) => {
      ambient.current?.setMuted(!m);
      return !m;
    });
  };
  const close = () => {
    ambient.current?.stop();
    onClose?.();
  };

  // real broadcast clock (UTC) — the channel runs on the same 6h marks the
  // world settles on, so the time on screen is the time the floor turns.
  const nowUtc = new Date();
  const clock = `${String(nowUtc.getUTCHours()).padStart(2, "0")}:${String(nowUtc.getUTCMinutes()).padStart(2, "0")} UTC`;
  const tape = moversByAbsMove(state).slice(0, 12);

  const slide = slidesRef.current[idx];
  const slideSector =
    slide?.type === "headline"
      ? slide.story.sector
      : slide?.type === "segment"
        ? slide.sector
        : undefined;
  // Ads + weather have their own optional art (ad-<tone>.png / weather.png); the
  // rest use the sector photo or bumper plate. Missing images degrade to the
  // gradient (which for ads is tone-tinted).
  const bgName =
    slide?.type === "weather"
      ? "weather"
      : slide?.type === "ad"
        ? `ad-${slide.ad.tone}`
        : (slideSector ?? "bumper");
  const bgGrad =
    slide?.type === "ad" ? AD_GRAD[slide.ad.tone] : meta(slideSector).grad;

  return (
    <div
      className={`reel ${embedded ? "embedded" : ""}`}
      role="dialog"
      aria-label="Trove News Network"
    >
      {/* background */}
      <div className="reel-bg" key={`bg-${bgName}-${idx}`} style={{ background: bgGrad }}>
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
        {mode === "filler" ? (
          <span className="reel-live offpeak">OFF-PEAK</span>
        ) : (
          <span className="reel-live">
            <i /> LIVE
          </span>
        )}
        <span className="reel-net">TNN · TROVE NEWS NETWORK · {clock}</span>
        {!embedded && (
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
        )}
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

          {slide.type === "weather" && (
            <div className="reel-panel">
              <div className="reel-panel-h">Trove Forecast</div>
              <div className="reel-wx">
                {slide.sectors.map((sec) => {
                  const f = forecast(state.sectorIdx[sec] ?? 1);
                  return (
                    <div className="reel-wxrow" key={sec}>
                      <f.Icon size={22} className="reel-wxic" />
                      <span className="reel-wxsec">{sectorLabel(sec)}</span>
                      <span className="reel-wxsky">{f.sky}</span>
                      <span className="reel-wxnote">{f.note}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {slide.type === "ad" && (
            <div className={`reel-ad fadein tone-${slide.ad.tone}`}>
              <div className="reel-ad-eyebrow">
                <Megaphone size={14} /> A word from our sponsors
              </div>
              <div className="reel-ad-brand">{slide.ad.brand}</div>
              <div className="reel-ad-tag">{slide.ad.line}</div>
              {slide.ad.sub && <div className="reel-ad-foot">{slide.ad.sub}</div>}
            </div>
          )}

          {slide.type === "comingup" && (
            <div className="reel-panel">
              <div className="reel-panel-h">
                <Timer size={14} /> Coming up
              </div>
              <div className="reel-cu-bell">
                Live coverage returns in{" "}
                <b>~{((1 - (state.cycleFrac ?? 0)) * 12).toFixed(1)}h</b> at the next
                bell.
              </div>
              <div className="reel-cu-sub">Watch for</div>
              <div className="reel-list">
                {moversByAbsMove(state)
                  .filter((m) => m.it.edition === null || m.it.remaining > 0)
                  .slice(0, 5)
                  .map((m) => (
                    <div className="reel-row" key={m.it.id}>
                      <span className="reel-row-nm">
                        <span className="bd">{m.it.brand}</span>
                        {m.it.name}
                      </span>
                      <span className={`reel-row-chg ${m.dp >= 0 ? "up" : "dn"}`}>
                        {m.dp >= 0 ? "▲" : "▼"} {Math.abs(m.dp).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
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
