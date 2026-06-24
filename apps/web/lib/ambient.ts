/**
 * A subtle synthesized instrumental bed for the news wheel — a slow ambient
 * pad cycling a gentle chord progression. Pure Web Audio: no files, no tokens.
 * Must be started from a user gesture (browsers block autoplay audio).
 */
export interface Ambient {
  start: () => void;
  stop: () => void;
  setMuted: (m: boolean) => void;
}

const LEVEL = 0.6;

export function createAmbient(): Ambient {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let voices: { o: OscillatorNode; g: GainNode }[] = [];
  let muted = false;
  let i = 0;

  // Low, warm minor-key pad progression.
  const chords = [
    [196.0, 246.94, 329.63],
    [174.61, 220.0, 261.63],
    [164.81, 207.65, 246.94],
    [220.0, 261.63, 329.63],
  ];

  function playChord(freqs: number[]) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    for (const { o, g } of voices) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 1.8);
      o.stop(t + 2);
    }
    voices = [];
    freqs.forEach((f, k) => {
      const o = ctx!.createOscillator();
      o.type = k === 0 ? "triangle" : "sine";
      o.frequency.value = f;
      o.detune.value = (k - 1) * 4;
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 2.4);
      g.gain.linearRampToValueAtTime(0.034, t + 6.8);
      o.connect(g).connect(master!);
      o.start(t);
      voices.push({ o, g });
    });
  }

  return {
    start() {
      if (ctx) return;
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : LEVEL;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1100;
      master.connect(lp).connect(ctx.destination);
      i = 0;
      playChord(chords[0]!);
      timer = setInterval(() => {
        i = (i + 1) % chords.length;
        playChord(chords[i]!);
      }, 7000);
    },
    setMuted(m: boolean) {
      muted = m;
      if (ctx && master) {
        master.gain.linearRampToValueAtTime(m ? 0 : LEVEL, ctx.currentTime + 0.4);
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (ctx) {
        const c = ctx;
        try {
          for (const { o, g } of voices) {
            g.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
            o.stop(c.currentTime + 0.5);
          }
        } catch {
          /* already stopped */
        }
        voices = [];
        setTimeout(() => c.close().catch(() => {}), 600);
        ctx = null;
        master = null;
      }
    },
  };
}
