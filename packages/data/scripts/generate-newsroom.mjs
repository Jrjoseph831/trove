#!/usr/bin/env node
/**
 * Trove — the Newsroom (Stage 1 of the living economy).
 *
 * Each run: pick the houses "due" for a development (driven by their volatility
 * and how long they've been quiet — most stay calm), feed Claude each one's
 * MEMORY, and have it write that house's next in-character beat. Beats are
 * appended to companies.json (continuity) and compiled into newsroom.json (the
 * on-air feed the site reads). Hidden effects move the economy.
 *
 * Cadence: 6h cycles. Story lifetime by size — flash 1 (6h), standard 2 (12h),
 * major 8 (~2 days).
 *
 * ENV: ANTHROPIC_API_KEY (required; skips cleanly without it).
 *      NEWSROOM_MODEL (default claude-opus-4-8).
 * Run: npm run gen:newsroom -w @trove/data
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");
const read = (n) => JSON.parse(readFileSync(join(catalogDir, n), "utf8"));

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.NEWSROOM_MODEL || "claude-opus-4-8";
if (!KEY) {
  console.warn("No ANTHROPIC_API_KEY — skipping newsroom run (memory unchanged).");
  process.exit(0);
}

const SIZE_MAG = { flash: 0.06, standard: 0.13, major: 0.22 };
const SIZE_DUR = { flash: 1, standard: 2, major: 8 };
const NEG = new Set(["recall", "scandal", "lawsuit", "earnings_miss", "outage", "safety_probe", "restructure", "departure"]);
const POS = new Set(["expansion", "product_launch", "major_deal", "earnings_beat", "breakthrough", "award", "funding"]);
const KINDS = "expansion, product_launch, major_deal, earnings_beat, breakthrough, award, funding, leadership_change, rebrand, restructure, recall, scandal, lawsuit, earnings_miss, outage, safety_probe";

const companies = read("companies.json");
const brands = read("brands.json");
const catBy = {};
for (const b of brands) catBy[b.name] = b.categories.join(", ");

const cycle = Math.floor(Date.now() / 21_600_000); // 6h cycles since epoch

// choose houses due for a beat
const names = Object.keys(companies);
const scored = names.map((n) => {
  const c = companies[n];
  const quiet = Math.max(0, cycle - (c.lastEventCycle || 0));
  const prob = Math.min(0.95, c.personality.volatility * (0.4 + 0.06 * quiet));
  return { n, prob };
});
const due = scored.filter((s) => Math.random() < s.prob).sort((a, b) => b.prob - a.prob).slice(0, 8);
if (!due.length) {
  console.log("Quiet cycle — no houses developed news.");
  process.exit(0);
}

// build one prompt covering all due houses
const memos = due.map(({ n }, i) => {
  const c = companies[n];
  const recent = c.events.slice(-3).map((e) => `    - [${e.kind}] ${e.head}`).join("\n");
  return `${i + 1}. ${n} (${c.homeSector}; makes: ${catBy[n]})\n   CEO: ${c.ceo} (since ${c.ceoSince}); personality: ${c.personality.trait}\n   recent:\n${recent}`;
}).join("\n\n");

const prompt = `You are the editor of TNN, a fictional market-news channel. Write the NEXT news beat for each company below, continuing its story in character. Most are AI-run "houses" that trade physical goods.

For each, choose a kind from: ${KINDS}. Pick a "size": flash (minor), standard, or major (a big, defining moment — use sparingly). Higher-volatility houses can swing harder; calm ones get smaller, rarer beats. Continue from the recent events (e.g., if a CEO just left, a successor or fallout; build arcs over time).

HARD RULES: never tell anyone to buy/sell/trade; never mention AI, algorithms, or traders; describe a real-world-style corporate event the viewer infers from. Fictional — no real companies/people/places.

For each beat: head = a broadcast headline naming the company; body = 2-3 sentences of in-depth detail (figures, names, context). If kind is leadership_change, include "newCeo": a plausible new executive name.

COMPANIES:
${memos}

Return ONLY a JSON array (no prose, no code fence), one object per company IN ORDER:
{"company": "<exact name>", "kind": "...", "size": "flash|standard|major", "head": "...", "body": "...", "newCeo": "<only if leadership_change>"}`;

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
const data = await res.json();
const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
const beats = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));

// apply beats to memory
for (const beat of beats) {
  const c = companies[beat.company];
  if (!c) continue;
  const size = SIZE_MAG[beat.size] ? beat.size : "standard";
  const sign = NEG.has(beat.kind) ? -1 : POS.has(beat.kind) ? 1 : 0;
  const effects = sign ? { [c.homeSector]: Math.round(SIZE_MAG[size] * sign * 1000) / 1000 } : {};
  c.events.push({ cycle, kind: beat.kind, size, head: beat.head, body: beat.body, effects });
  c.lastEventCycle = cycle;
  if (beat.kind === "leadership_change" && beat.newCeo) {
    c.ceo = beat.newCeo;
    c.ceoSince = new Date().getFullYear();
  }
  if (c.events.length > 24) c.events = c.events.slice(-24);
}

// compile the on-air feed from all still-live beats
const onAir = [];
for (const [name, c] of Object.entries(companies)) {
  for (const e of c.events) {
    if (e.kind === "profile") continue;
    const dur = SIZE_DUR[e.size] ?? 2;
    if (cycle - e.cycle < dur) {
      onAir.push({ company: name, sector: c.homeSector, kind: e.kind, size: e.size, head: e.head, body: e.body, cycle: e.cycle, dur });
    }
  }
}
onAir.sort((a, b) => b.cycle - a.cycle);

const cJson = JSON.stringify(companies, null, 2) + "\n";
const nJson = JSON.stringify({ generatedAt: new Date().toISOString(), beats: onAir.slice(0, 30) }, null, 2) + "\n";
for (const dir of [catalogDir, rootDataDir]) {
  writeFileSync(join(dir, "companies.json"), cJson);
  writeFileSync(join(dir, "newsroom.json"), nJson);
}
console.log(`newsroom: ${beats.length} new beats (cycle ${cycle}); ${onAir.length} on air. model ${MODEL}`);
