#!/usr/bin/env node
/**
 * Trove — twice-daily news broadcast generator.
 *
 * Pipeline (offline; runs in CI on a cron, or locally):
 *   1. Pick a few stories from the news pool.
 *   2. Claude writes a two-anchor segment (intro → stories → sign-off) as JSON.
 *   3. (optional) A TTS service renders each line to mp3 with FIXED voices.
 *   4. Write broadcast.json (+ audio under apps/web/public/broadcast-audio).
 *
 * The site plays broadcast.json: it uses the pre-rendered mp3s when present
 * (same voices everywhere), and falls back to free browser speech otherwise.
 *
 * ENV:
 *   ANTHROPIC_API_KEY   required for the script (Claude). Without it, this exits
 *                       cleanly and leaves the existing broadcast.json in place.
 *   BROADCAST_MODEL     Claude model (default claude-opus-4-8). Set to
 *                       claude-haiku-4-5 to cut script cost to a few cents/month.
 *   OPENAI_API_KEY      optional. If set, renders fixed-voice mp3s via OpenAI TTS.
 *                       (Swap TTS provider in `synthesize()` if you prefer
 *                       Google / Azure / Polly — same shape, cheaper free tiers.)
 *   VOICE_A, VOICE_B    TTS voice ids (defaults: onyx, nova).
 *
 * Run:  node packages/data/scripts/generate-broadcast.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");
const audioDir = join(here, "..", "..", "..", "apps", "web", "public", "broadcast-audio");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.BROADCAST_MODEL || "claude-opus-4-8";
const VOICE_A = process.env.VOICE_A || "onyx";
const VOICE_B = process.env.VOICE_B || "nova";

if (!ANTHROPIC_API_KEY) {
  console.warn("No ANTHROPIC_API_KEY set — skipping broadcast generation (keeping existing broadcast.json).");
  process.exit(0);
}

// ── 1. pick a few stories from the pool ──────────────────────────────────────
const news = JSON.parse(readFileSync(join(catalogDir, "news.json"), "utf8"));
const withEffects = news.filter((n) => Object.keys(n.effects || {}).length);
function dominantSector(n) {
  let best = null;
  let mag = 0;
  for (const [s, v] of Object.entries(n.effects)) {
    if (Math.abs(v) > mag) {
      mag = Math.abs(v);
      best = s;
    }
  }
  return best;
}
// rotate by day so each broadcast differs without an LLM call to choose
const seed = Math.floor(Date.now() / 43_200_000); // changes every 12h
const picks = [];
for (let i = 0; i < 4; i++) {
  picks.push(withEffects[(seed * 7 + i * 13) % withEffects.length]);
}
const storyList = picks
  .map((n, i) => `${i + 1}. [${n.kick}] ${n.head}  (sector: ${dominantSector(n)})\n   ${n.body}`)
  .join("\n");

// ── 2. Claude writes the two-anchor segment ─────────────────────────────────
const prompt = `You are scripting a short evening news segment for "TNN — the Trove News Network", a fictional market-news channel. Two anchors, Vale Mercer (A) and Dorian Cole (B), read the rundown.

Write a natural broadcast script covering the stories below. Structure: a brief two-line intro (one line each anchor), then ONE segment per story (anchors alternate, with a short hand-off phrase), then a two-line sign-off. Keep each spoken line 1–3 sentences, conversational broadcast cadence.

HARD RULES:
- Never tell the viewer to buy, sell, or trade anything. No financial advice.
- Never mention AI, algorithms, traders, or "the market will react". These are world-news stories; the viewer infers.
- Keep it grounded and brand-safe. Fictional world.

STORIES:
${storyList}

Return ONLY valid JSON (no prose, no code fence): an array of segments, each:
{"anchor":"A"|"B","kind":"intro"|"story"|"handoff"|"signoff","text":"...","story":{"kick":"...","head":"...","sector":"..."}}
Include the "story" object ONLY on story/handoff segments, using the kick/head/sector from the matching story above. Intro and signoff segments omit "story".`;

async function callClaude() {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return JSON.parse(json);
}

// ── 3. optional TTS (fixed voices) ───────────────────────────────────────────
async function synthesize(text, anchor, i) {
  if (!OPENAI_API_KEY) return undefined;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: anchor === "A" ? VOICE_A : VOICE_B,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(audioDir, { recursive: true });
  const file = `seg-${String(i).padStart(2, "0")}.mp3`;
  writeFileSync(join(audioDir, file), buf);
  return `broadcast-audio/${file}`;
}

// ── 4. assemble + write ──────────────────────────────────────────────────────
const segments = await callClaude();
if (existsSync(audioDir)) rmSync(audioDir, { recursive: true, force: true });

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const audio = await synthesize(seg.text, seg.anchor, i);
  if (audio) seg.audio = audio;
}

const out = {
  generatedAt: new Date().toISOString(),
  edition: 1000 + (seed % 9000),
  anchors: { A: "Vale Mercer", B: "Dorian Cole" },
  segments,
};
const json = JSON.stringify(out, null, 2) + "\n";
writeFileSync(join(catalogDir, "broadcast.json"), json);
writeFileSync(join(rootDataDir, "broadcast.json"), json);

console.log(
  `broadcast: ${segments.length} segments, model ${MODEL}, audio ${OPENAI_API_KEY ? "rendered" : "skipped (browser-speech fallback)"}`,
);
