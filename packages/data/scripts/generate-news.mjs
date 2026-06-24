#!/usr/bin/env node
/**
 * Trove — News Scenario Bank Generator (deterministic, ZERO runtime AI).
 *
 * Builds the pre-written news bank the engine sequences at runtime. A big,
 * varied pool so stories don't recycle. Node port + expansion of the original
 * data/generate_news.py. Run:  node packages/data/scripts/generate-news.mjs
 *
 * HARD RULES (enforced by construction + validated at the end):
 *   1. A story NEVER states a recommendation ("buy X", "sell Y").
 *   2. A story NEVER mentions AI, traders, or "the market will react".
 *   3. The story describes a WORLD EVENT; the player infers. Hidden `effects`
 *      move sector demand (positive = demand up, negative = down). Nothing in
 *      the body says so.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");

// ── seeded RNG (mulberry32) ──────────────────────────────────────────────────
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
const rng = mulberry32(20260624);
const rand = () => rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const uni = (a, b) => Math.round((a + rand() * (b - a)) * 1000) / 1000;

// ── world vocabulary ─────────────────────────────────────────────────────────
const SECTORS = [
  "construction", "logistics", "automotive", "technology", "energy",
  "agriculture", "manufacturing", "medical", "hospitality", "consumer",
  "textiles", "luxury",
];

const FIRMS = {
  logistics: ["Atlas Freight", "Meridian Haul", "Vantor Logistics", "Cardinal Carriers"],
  construction: ["Halcrow Build Group", "Ironcrest Contracting", "Stonebridge Developments"],
  automotive: ["Marrowgear Motors", "Veldt Drive", "Kessel Automotive"],
  technology: ["Veldt Systems", "Corvon Compute", "Aperture Networks"],
  energy: ["Cindral Power", "Boreas Energy", "Greywater Utilities"],
  agriculture: ["Harrow Agro", "Greenmarsh Farms", "Tillage Co-op"],
  manufacturing: ["Forgewright Industrial", "Brunhaus Mfg", "Carrow Works"],
  medical: ["Thal Medical", "Ardent Health Supply", "Vossen Devices"],
  hospitality: ["Carrow Hospitality", "Maison Group", "Hearthstone Resorts"],
  consumer: ["Drust Goods", "Wold Retail", "Bramm Brands"],
  textiles: ["Fenn Mills", "Garrweave", "Orne Fabrics"],
  luxury: ["Halcyon Maison", "Thronehaus", "Erret & Co."],
};
const REGIONS = [
  "the eastern corridor", "the gulf ports", "the northern belt", "the inland hubs",
  "the western basin", "the capital region", "the river valley", "the coastal zone",
  "the southern reach", "the lake district", "the highland counties", "the delta plains",
];

const firm = (s) => pick(FIRMS[s]);
const region = () => pick(REGIONS);
const label = (s) => (s === "luxury" ? "luxury" : s[0].toUpperCase() + s.slice(1));
const cap = (s) => label(s)[0].toUpperCase() + label(s).slice(1);

// fill {f}/{reg}/{l}/{L} placeholders
function fill(str, ctx) {
  return str
    .replaceAll("{f}", ctx.f)
    .replaceAll("{reg}", ctx.reg)
    .replaceAll("{l}", ctx.l)
    .replaceAll("{L}", ctx.L);
}

// ── single-sector templates ──────────────────────────────────────────────────
// Each: { kick, heads[], bodies[], range:[lo,hi], sign, dur[] }.
const POS_TEMPLATES = [
  {
    kick: "Industry",
    heads: [
      "{f} unveils major {l} expansion across {reg}",
      "{f} breaks ground on sweeping {l} buildout in {reg}",
      "{f} commits to multi-season {l} program in {reg}",
    ],
    bodies: [
      "{f} confirmed a large-scale buildout this morning, with aggressive hiring and procurement slated to begin within weeks. Suppliers in {reg} are bracing for a surge in orders as the program ramps.",
      "The announcement lands after months of speculation, and operators across {reg} say the scale of the plan will pull forward orders that had been on hold.",
    ],
    range: [0.16, 0.26], dur: [4, 5, 5, 6],
  },
  {
    kick: "Policy",
    heads: [
      "Lawmakers pass package favoring {l} over coming seasons",
      "New public program directs sustained funds toward {l}",
      "Legislators clear long-stalled {l} spending bill",
    ],
    bodies: [
      "A long-debated spending package cleared its final vote overnight, directing sustained public funds toward {l} programs. Operators say the certainty alone is enough to unlock projects that had been sitting on the shelf.",
      "After repeated delays the measure finally passed, and firms tied to {l} are dusting off plans they had shelved pending clearer conditions.",
    ],
    range: [0.18, 0.28], dur: [5, 6, 6],
  },
  {
    kick: "Materials",
    heads: [
      "Supply of key {l} inputs tightens as disruption drags on",
      "{L} inputs grow scarce as bottlenecks persist",
      "Lead times stretch for critical {l} components",
    ],
    bodies: [
      "A prolonged disruption has squeezed availability of critical {l} inputs, with lead times stretching and buyers watching inventories nervously. No quick resolution appears to be in sight.",
      "Procurement desks report thinning stock of essential {l} components, and several operators have begun rationing what they hold.",
    ],
    range: [0.1, 0.18], dur: [3, 4],
  },
  {
    kick: "Demand",
    heads: [
      "Unexpected wave of demand catches {l} suppliers flat-footed",
      "{L} orders spike sharply, straining suppliers",
      "Sudden run on {l} goods empties supplier shelves",
    ],
    bodies: [
      "A sharp, unplanned spike in {l} orders has left several suppliers scrambling to keep shelves stocked. Analysts are split on whether the run-up will hold or fade by season's end.",
      "Order books for {l} goods filled faster than anyone forecast this week, and producers are racing to add shifts.",
    ],
    range: [0.12, 0.22], dur: [3, 4],
  },
  {
    kick: "Industry",
    heads: [
      "{f} secures major backing to scale {l} capacity",
      "Investors pour fresh capital into {f}'s {l} push",
    ],
    bodies: [
      "{f} closed a sizable funding round aimed squarely at expanding {l} output across {reg}, and suppliers expect the spend to flow downstream quickly.",
      "Backers lined up behind {f}'s plan to widen its {l} footprint, with the firm signalling an aggressive build timeline.",
    ],
    range: [0.14, 0.24], dur: [4, 5, 6],
  },
  {
    kick: "Trade",
    heads: [
      "{L} export orders climb on strong overseas appetite",
      "Overseas buyers lift {l} order books to multi-season highs",
    ],
    bodies: [
      "Fresh figures show overseas orders for {l} goods climbing well past forecasts, and producers in {reg} are adding capacity to keep pace.",
      "Strong foreign appetite has {l} order books at their fullest in seasons, with shipments out of {reg} running hot.",
    ],
    range: [0.12, 0.2], dur: [4, 5],
  },
  {
    kick: "Labor",
    heads: [
      "Labor action halts output, squeezing {l} supply",
      "Walkout at major {l} operations tightens availability",
    ],
    bodies: [
      "A walkout across several {l} operations has idled output, and downstream operators are already feeling the pinch as available stock thins.",
      "Stoppages rippled through {l} producers in {reg} this week, leaving buyers competing for a shrinking pool of supply.",
    ],
    range: [0.1, 0.18], dur: [3, 4],
  },
];

const NEG_TEMPLATES = [
  {
    kick: "Markets",
    heads: [
      "{L} oversupply pulls prices off recent highs",
      "Glut leaves {l} producers with excess to clear",
    ],
    bodies: [
      "A wave of new capacity has flooded the {l} space faster than buyers can absorb it. Operators that leaned into the boom are now trimming the excess they'd built up.",
      "Inventories of {l} goods have swelled well past comfortable levels, and producers are quietly marking down to move stock.",
    ],
    range: [0.14, 0.22], dur: [3, 4, 4],
  },
  {
    kick: "Recall",
    heads: [
      "{f} issues sweeping recall, rattling {l} confidence",
      "Fault reports trigger broad {f} recall across {l}",
    ],
    bodies: [
      "{f} announced a broad recall after fault reports surfaced in its flagship line. The news cast a chill over the wider {l} category heading into a closely watched stretch.",
      "A widening recall at {f} has unsettled the {l} category, with operators bracing for a softer season.",
    ],
    range: [0.16, 0.24], dur: [3, 4],
  },
  {
    kick: "Markets",
    heads: [
      "{L} activity slumps on cost and rate jitters",
      "Higher costs drag {l} activity to a standstill",
    ],
    bodies: [
      "Fresh figures show {l} activity falling sharply as higher costs spook operators. Several large commitments were quietly shelved pending clearer conditions.",
      "Rising costs have cooled {l} sharply, and planners across {reg} are pushing commitments out rather than locking them in.",
    ],
    range: [0.14, 0.2], dur: [4, 5],
  },
  {
    kick: "Markets",
    heads: [
      "{L} backlog clears faster than forecast",
      "Pressure eases as {l} bottlenecks unwind",
    ],
    bodies: [
      "The strain that had gripped {l} for months has eased ahead of schedule, and conditions are normalizing. Operators are unwinding the surge capacity they'd leaned on.",
      "Conditions in {l} have loosened quicker than expected, and the premium operators had been paying for scarce capacity is fading.",
    ],
    range: [0.1, 0.16], dur: [3, 4],
  },
  {
    kick: "Policy",
    heads: [
      "New rules add fresh headwind for {l} operators",
      "Tighter oversight clouds the outlook for {l}",
    ],
    bodies: [
      "A fresh round of oversight lands on {l} this season, and operators warn the added cost of compliance will weigh on activity across {reg}.",
      "Regulators tightened the rules governing {l}, and firms say the change will slow projects already running on thin margins.",
    ],
    range: [0.12, 0.2], dur: [4, 5],
  },
  {
    kick: "Markets",
    heads: [
      "Margin squeeze forces {l} operators to pull back",
      "{L} order pipeline thins as confidence wavers",
    ],
    bodies: [
      "Squeezed margins have {l} operators trimming plans and deferring orders, and the pullback is showing up across {reg}.",
      "A thinning pipeline has cooled the {l} category, with several firms holding back rather than committing into uncertainty.",
    ],
    range: [0.12, 0.18], dur: [3, 4],
  },
];

function singleSector(t, s, sign) {
  const ctx = { f: firm(s), reg: region(), l: label(s), L: cap(s) };
  const mag = uni(t.range[0], t.range[1]) * (sign === "neg" ? -1 : 1);
  return {
    kick: fill(t.kick, ctx) === "Demand" ? cap(s) : t.kick,
    head: fill(pick(t.heads), ctx),
    body: fill(pick(t.bodies), ctx),
    effects: { [s]: Math.round(mag * 1000) / 1000 },
    dur: pick(t.dur),
  };
}

// ── cross-sector cascades ────────────────────────────────────────────────────
const CROSS_PAIRS = [
  ["construction", "energy", "A grid-and-infrastructure program ties construction to power buildout"],
  ["logistics", "construction", "A distribution-network rollout pulls both freight and buildout demand"],
  ["automotive", "energy", "An EV push lifts both vehicle and power-storage demand"],
  ["technology", "energy", "A data-center wave drives compute and the power to run it"],
  ["agriculture", "logistics", "A bumper harvest strains storage and freight capacity"],
  ["manufacturing", "construction", "A reshoring drive fuels factory and facility buildout"],
  ["hospitality", "consumer", "A tourism surge lifts food service and everyday goods"],
  ["medical", "manufacturing", "A health-system stockpiling push pulls device manufacturing"],
  ["textiles", "consumer", "An apparel cycle lifts raw cloth and finished goods together"],
  ["luxury", "consumer", "A wealth-effect quarter lifts both the top end and broad retail"],
  ["technology", "manufacturing", "An automation rollout couples compute with factory tooling"],
  ["energy", "agriculture", "A fuel-cost swing reshapes both power and farm input demand"],
  ["construction", "manufacturing", "A public-works wave pulls structural materials and machinery"],
  ["logistics", "consumer", "A delivery-network expansion lifts freight and retail flow"],
];
function crossPos(pair) {
  const [a, b, desc] = pair;
  const ctx = { f: firm(a), reg: region(), l: label(a), L: cap(a) };
  return {
    kick: "Industry",
    head: `${ctx.f} program links ${label(a)} and ${label(b)} in ${ctx.reg}`,
    body: `${cap(desc[0]) + desc.slice(1)}. ${ctx.f} said the initiative, centered on ${ctx.reg}, would run for several seasons and draw heavily on connected supply chains. Knock-on demand is expected to spread beyond the headline sector.`,
    effects: { [a]: uni(0.18, 0.26), [b]: uni(0.06, 0.12) },
    dur: pick([4, 5, 6]),
  };
}

const CROSS_NEG = [
  ["automotive", "manufacturing", "An auto downturn ripples into parts manufacturing"],
  ["construction", "energy", "A building slowdown softens tied power demand"],
  ["logistics", "consumer", "A freight glut signals cooling consumer flow"],
  ["technology", "energy", "A compute pullback eases data-center power draw"],
  ["hospitality", "consumer", "A travel slump drags on everyday spending"],
  ["manufacturing", "textiles", "A factory slowdown thins raw-cloth orders"],
];
function crossNeg(pair) {
  const [a, b, desc] = pair;
  const reg = region();
  return {
    kick: "Markets",
    head: `${cap(a)} pullback spills into ${label(b)}`,
    body: `${cap(desc[0]) + desc.slice(1)}. The softness that began in ${label(a)} is bleeding into ${label(b)} as orders thin across ${reg}. Operators are watching to see how far it spreads.`,
    effects: { [a]: -uni(0.14, 0.2), [b]: -uni(0.05, 0.1) },
    dur: pick([3, 4]),
  };
}

// ── luxury auctions + quiet/weather texture ──────────────────────────────────
const AUCTION_HEADS = [
  "Record gavel: a rare piece shatters its auction estimate",
  "Marquee evening sale clears far above its top estimate",
  "Collectors chase a trophy lot to a record result",
  "A single-owner sale reignites the high end of the market",
];
const AUCTION_BODIES = [
  "A closely watched evening sale produced a result several multiples above its low estimate, reigniting chatter about the very top of the collectibles market. Specialists say confidence at the high end tends to feed on itself.",
  "Bidding ran long past the published estimates, and specialists left the room talking about renewed appetite at the rarefied end of the market.",
];
function auction() {
  return {
    kick: "Luxury",
    head: pick(AUCTION_HEADS),
    body: pick(AUCTION_BODIES),
    effects: { luxury: uni(0.16, 0.24) },
    dur: pick([3, 4]),
  };
}

const QUIET = [
  ["Markets", "A quiet session across the floor", "No major catalysts moved the market today. Trading was thin and prices drifted on their own momentum."],
  ["Markets", "Holiday lull keeps activity subdued", "With much of the trade away, volumes thinned to a trickle. Few were willing to commit ahead of the coming week."],
  ["Weather", "Storms snarl movement in scattered regions", "Severe weather briefly disrupted activity in parts of the country, but operators expect normal conditions to resume shortly."],
  ["Markets", "Prices drift in a featureless session", "Little of note crossed the wires, and the floor coasted on its own momentum into the close."],
  ["Weather", "A calm spell settles over the regions", "Mild conditions and a light calendar kept activity muted, with most desks content to wait for the next catalyst."],
];
function quiet() {
  const [k, h, b] = pick(QUIET);
  return { kick: k, head: h, body: b, effects: {}, dur: 1 };
}

// ── build the bank ───────────────────────────────────────────────────────────
function build() {
  const bank = [];
  // single-sector: every sector × every template (both signs)
  for (const s of SECTORS) {
    for (const t of POS_TEMPLATES) bank.push(singleSector(t, s, "pos"));
    for (const t of NEG_TEMPLATES) bank.push(singleSector(t, s, "neg"));
  }
  for (const p of CROSS_PAIRS) bank.push(crossPos(p));
  for (const p of CROSS_NEG) bank.push(crossNeg(p));
  for (let i = 0; i < 8; i++) bank.push(auction());
  for (let i = 0; i < 14; i++) bank.push(quiet());

  // dedupe by exact headline; keep stable order
  const seen = new Set();
  const deduped = bank.filter((sc) => {
    if (seen.has(sc.head)) return false;
    seen.add(sc.head);
    return true;
  });

  return deduped.map((sc, i) => ({
    id: `news_${String(i).padStart(3, "0")}`,
    kick: sc.kick,
    head: sc.head,
    body: sc.body,
    effects: Object.fromEntries(
      Object.entries(sc.effects).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
    ),
    dur: sc.dur,
    weight: Object.keys(sc.effects).length ? 1 : 0.4,
  }));
}

const bank = build();

// validation: no banned phrases
const banned = ["buy ", "sell ", "you should", "ai ", "trader", "recommend", "invest in", "portfolio"];
const flags = [];
for (const sc of bank) {
  const text = `${sc.head} ${sc.body}`.toLowerCase();
  for (const b of banned) if (text.includes(b)) flags.push([sc.id, b, sc.head]);
}

const pos = bank.filter((s) => Object.values(s.effects).some((v) => v > 0)).length;
const neg = bank.filter((s) => Object.values(s.effects).some((v) => v < 0)).length;
const quietN = bank.filter((s) => !Object.keys(s.effects).length).length;
const cross = bank.filter((s) => Object.keys(s.effects).length > 1).length;

const json = JSON.stringify(bank, null, 2) + "\n";
writeFileSync(join(catalogDir, "news.json"), json);
writeFileSync(join(rootDataDir, "news.json"), json);

console.log(`news scenarios: ${bank.length}  (pos~${pos}, neg~${neg}, quiet ${quietN}, cross ${cross})`);
console.log(`banned-phrase flags: ${flags.length} ${flags.length ? JSON.stringify(flags) : "(clean)"}`);
console.log("samples:");
for (const sc of [bank[3], bank[40], bank[120], bank[bank.length - 5]]) {
  console.log(`  [${sc.kick}] ${sc.head}  ${JSON.stringify(sc.effects)} dur=${sc.dur}`);
}
if (flags.length) process.exit(1);
