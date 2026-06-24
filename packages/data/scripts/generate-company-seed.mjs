#!/usr/bin/env node
/**
 * Trove — seed the company memory store (companies.json).
 *
 * Every brand becomes an AI-owned "house" with a persistent record: a CEO, a
 * personality (how volatile / how often it makes news), its founding, and an
 * append-only event log seeded with a profile beat. The newsroom generator
 * later reads this memory and writes each house's next in-character beat, so
 * storylines have continuity ("their second CEO in six months").
 *
 * Deterministic, free. Run: npm run gen:company-seed -w @trove/data
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");
const read = (n) => JSON.parse(readFileSync(join(catalogDir, n), "utf8"));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(424242);
const rand = () => rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round = (n) => Math.round(n * 100) / 100;

const brands = read("brands.json");
const lore = read("lore.json");

// volatility by home sector — how often a house tends to make news + how hard
const VOL_BAND = {
  technology: [0.62, 0.9], automotive: [0.6, 0.88], luxury: [0.58, 0.86], energy: [0.55, 0.82],
  construction: [0.4, 0.62], logistics: [0.4, 0.62], manufacturing: [0.4, 0.6],
  consumer: [0.38, 0.58], hospitality: [0.4, 0.6],
  agriculture: [0.24, 0.42], medical: [0.26, 0.44], textiles: [0.24, 0.4],
};
const TRAITS = {
  high: ["restless and acquisitive", "prone to bold, public swings", "fast-moving and headline-hungry", "ambitious, often turbulent"],
  mid: ["steady, with the occasional bold move", "measured but opportunistic", "competent and rarely dramatic", "disciplined, quietly expanding"],
  low: ["quiet and conservative", "slow-moving, long-horizon", "unflashy and dependable", "patient, allergic to drama"],
};
const FIRSTS = ["Vale", "Dorian", "Mara", "Cole", "Iris", "Soren", "Lena", "Theo", "Nadia", "Rhys", "Cora", "Emil", "Sable", "Lorne", "Petra", "Quinn", "Halden", "Mira", "Bram", "Yvette", "Orla", "Kestrel", "Aurelia", "Dunmore"];
const LASTS = ["Mercer", "Thorne", "Halloran", "Brandt", "Ashby", "Kessler", "Marrow", "Vossen", "Dray", "Holt", "Garr", "Orne", "Steg", "Calder", "Fenn", "Wold", "Carrow", "Skarn", "Veldt", "Throne", "Bramm", "Aldous"];

const ceoName = () => `${pick(FIRSTS)} ${pick(LASTS)}`;
const band = (v) => (v >= 0.58 ? "high" : v >= 0.4 ? "mid" : "low");

const companies = {};
for (const b of brands) {
  const [lo, hi] = VOL_BAND[b.homeSector] ?? [0.4, 0.6];
  const volatility = round(lo + rand() * (hi - lo));
  const l = lore[b.name];
  const founded = l?.founded ?? 1950;
  companies[b.name] = {
    aiOwned: true,
    homeSector: b.homeSector,
    founded,
    ceo: ceoName(),
    ceoSince: founded,
    personality: { volatility, trait: pick(TRAITS[band(volatility)]) },
    // 0 = idle; the newsroom raises this when a house has a live storyline
    arc: null,
    lastEventCycle: 0,
    events: [
      {
        cycle: 0,
        kind: "profile",
        size: "standard",
        head: `${b.name}${l?.tagline ? ` — ${l.tagline}` : ""}`,
        body: l?.story ?? `${b.name}, a house of the Trove floor.`,
        effects: {},
      },
    ],
  };
}

const json = JSON.stringify(companies, null, 2) + "\n";
writeFileSync(join(catalogDir, "companies.json"), json);
writeFileSync(join(rootDataDir, "companies.json"), json);

const byBand = { high: 0, mid: 0, low: 0 };
for (const c of Object.values(companies)) byBand[band(c.personality.volatility)]++;
console.log(`seeded ${Object.keys(companies).length} companies`);
console.log(`volatility bands:`, JSON.stringify(byBand));
console.log(`sample:`, JSON.stringify(companies["Veldt Drive"] ?? Object.values(companies)[0], null, 2).slice(0, 400));
