"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { broadcast, sectorLabel, type BroadcastSegment } from "@trove/data";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const withBase = (p: string) =>
  `${BASE}/${p.replace(/^\/+/, "")}`;

type AnchorId = "A" | "B";

/** A flat black news-anchor silhouette (head, neck, shoulders), two variants. */
function Anchor({ variant }: { variant: AnchorId }) {
  return (
    <svg className="anchor-svg" viewBox="0 0 200 200" aria-hidden>
      {variant === "A" ? (
        <>
          <path d="M2 200 C2 150 40 116 100 116 C160 116 198 150 198 200 Z" />
          <rect x="85" y="80" width="30" height="46" rx="12" />
          <ellipse cx="100" cy="54" rx="33" ry="39" />
        </>
      ) : (
        <>
          <path d="M0 200 C0 145 38 112 100 112 C162 112 200 145 200 200 Z" />
          <rect x="85" y="76" width="30" height="46" rx="12" />
          <ellipse cx="100" cy="50" rx="35" ry="39" />
          <path d="M61 44 C70 12 130 12 139 44 C130 26 70 26 61 44 Z" />
        </>
      )}
    </svg>
  );
}

export function Studio({ onClose }: { onClose: () => void }) {
  const segs = broadcast.segments;
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [story, setStory] = useState<BroadcastSegment["story"] | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voicesRef = useRef<{ A?: SpeechSynthesisVoice; B?: SpeechSynthesisVoice }>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idxRef = useRef(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  // Pick two distinct browser voices (fallback when there's no pre-rendered audio).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const all = speechSynthesis.getVoices();
      const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
      const pool = en.length ? en : all;
      voicesRef.current = { A: pool[0], B: pool.find((v) => v !== pool[0]) ?? pool[0] };
    };
    load();
    speechSynthesis.onvoiceschanged = load;
    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const stopAll = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (typeof window !== "undefined" && window.speechSynthesis) {
      speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    setPlaying(false);
  }, []);

  const playFrom = useCallback(
    (i: number) => {
      stopAll();
      if (i >= segs.length) {
        finish();
        return;
      }
      idxRef.current = i;
      setIdx(i);
      const seg = segs[i]!;
      if (seg.story) setStory(seg.story);
      setPlaying(true);

      const advance = () => {
        if (idxRef.current !== i) return; // superseded
        playFrom(i + 1);
      };

      // 1) pre-rendered cloud audio (consistent voices)
      if (seg.audio && !mutedRef.current) {
        const a = new Audio(withBase(seg.audio));
        audioRef.current = a;
        a.onended = advance;
        a.onerror = advance;
        a.play().catch(() => advance());
        return;
      }
      // 2) free browser speech
      if (!mutedRef.current && typeof window !== "undefined" && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(seg.text);
        const v = voicesRef.current[seg.anchor];
        if (v) u.voice = v;
        u.rate = 0.98;
        u.pitch = seg.anchor === "B" ? 0.92 : 1.06; // differentiate the two
        u.onend = advance;
        u.onerror = advance;
        speechSynthesis.speak(u);
        return;
      }
      // 3) muted — hold for a readable beat, then advance
      timerRef.current = setTimeout(advance, Math.max(2200, seg.text.length * 45));
    },
    [segs, stopAll, finish],
  );

  const start = useCallback(() => {
    setStarted(true);
    playFrom(0);
  }, [playFrom]);

  const restart = useCallback(() => playFrom(0), [playFrom]);

  const togglePause = useCallback(() => {
    if (playing) {
      stopAll();
      setPlaying(false);
    } else {
      playFrom(idxRef.current);
    }
  }, [playing, stopAll, playFrom]);

  useEffect(() => () => stopAll(), [stopAll]);

  const close = () => {
    stopAll();
    onClose();
  };

  const cur = segs[idx];
  const speaking = playing ? cur?.anchor : null;

  return (
    <div className="studio" role="dialog" aria-label="Trove News Network broadcast">
      <div className="studio-bar">
        <span className="studio-live">
          <i /> LIVE
        </span>
        <span className="studio-net">
          TNN · TROVE NEWS NETWORK · No. {broadcast.edition}
        </span>
        <div className="studio-tools">
          <button
            className="studio-tool"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className="studio-tool" onClick={close} aria-label="Close broadcast">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="stage">
        <div className="stage-back">
          {story ? (
            <div className={`stage-story s-${story.sector ?? "none"}`}>
              <div className="stage-kick">{story.kick}</div>
              <div className="stage-head">{story.head}</div>
              {story.sector && (
                <div className="stage-sector">{sectorLabel(story.sector)}</div>
              )}
            </div>
          ) : (
            <div className="stage-ident">TNN</div>
          )}
        </div>

        <div className="stage-anchors">
          <div className={`anchor ${speaking === "A" ? "talking" : ""}`}>
            <span className="spotlight" />
            <Anchor variant="A" />
            <span className="nameplate">{broadcast.anchors.A}</span>
          </div>
          <div className={`anchor b ${speaking === "B" ? "talking" : ""}`}>
            <span className="spotlight" />
            <Anchor variant="B" />
            <span className="nameplate">{broadcast.anchors.B}</span>
          </div>
        </div>

        <div className="desk">
          <span className="desk-logo">TNN</span>
        </div>

        {started && cur && (
          <div className="studio-caption" key={idx}>
            <b>{cur.anchor === "A" ? broadcast.anchors.A : broadcast.anchors.B}:</b>{" "}
            {cur.text}
          </div>
        )}

        {!started && (
          <button className="studio-start" onClick={start}>
            <Play size={20} /> Start the broadcast
          </button>
        )}
      </div>

      <div className="studio-controls">
        <button className="studio-btn" onClick={togglePause} disabled={!started}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Pause" : "Play"}
        </button>
        <button className="studio-btn" onClick={restart} disabled={!started}>
          <RotateCcw size={15} /> Restart
        </button>
        <div className="seg-dots">
          {segs.map((s, i) => (
            <i key={i} className={i === idx && started ? "on" : ""} />
          ))}
        </div>
      </div>
    </div>
  );
}
