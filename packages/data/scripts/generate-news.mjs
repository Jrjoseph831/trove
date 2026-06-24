#!/usr/bin/env node
/**
 * Trove — News Scenario Bank Generator (deterministic, ZERO runtime AI).
 *
 * Builds a large, varied pool of in-depth stories the engine sequences at
 * runtime and the news wheel groups into per-industry segments. Each sector
 * gets many distinct multi-paragraph stories so a segment can run ~5 without
 * repeating. Run:  npm run gen:news -w @trove/data
 *
 * HARD RULES (validated at the end):
 *   1. Never states a recommendation ("buy X", "sell Y").
 *   2. Never mentions AI, traders, or "the market will react".
 *   3. Describes a world event; the player infers. Hidden `effects` move sector
 *      demand (positive = up, negative = down). Nothing in the body says so.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");

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
const rng = mulberry32(20260625);
const rand = () => rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pick2 = (arr) => {
  const a = pick(arr);
  let b = pick(arr);
  let guard = 0;
  while (b === a && arr.length > 1 && guard++ < 8) b = pick(arr);
  return [a, b];
};
const uni = (a, b) => Math.round((a + rand() * (b - a)) * 1000) / 1000;
const intB = (a, b) => Math.floor(a + rand() * (b - a + 1));

const SECTORS = [
  "construction", "logistics", "automotive", "technology", "energy",
  "agriculture", "manufacturing", "medical", "hospitality", "consumer",
  "textiles", "luxury",
];

const FIRMS = {
  logistics: ["Atlas Freight", "Meridian Haul", "Vantor Logistics", "Cardinal Carriers", "Drayton Shipping"],
  construction: ["Halcrow Build Group", "Ironcrest Contracting", "Stonebridge Developments", "Marrow Civil Works"],
  automotive: ["Marrowgear Motors", "Veldt Drive", "Kessel Automotive", "Brunmark Vehicles"],
  technology: ["Veldt Systems", "Corvon Compute", "Aperture Networks", "Halhold Data"],
  energy: ["Cindral Power", "Boreas Energy", "Greywater Utilities", "Vossen Grid"],
  agriculture: ["Harrow Agro", "Greenmarsh Farms", "Tillage Co-op", "Korrgrave Growers"],
  manufacturing: ["Forgewright Industrial", "Brunhaus Mfg", "Carrow Works", "Steg Tooling"],
  medical: ["Thal Medical", "Ardent Health Supply", "Vossen Devices", "Castle Health"],
  hospitality: ["Carrow Hospitality", "Maison Group", "Hearthstone Resorts", "Marrowmoor Hotels"],
  consumer: ["Drust Goods", "Wold Retail", "Bramm Brands", "Ornewright Stores"],
  textiles: ["Fenn Mills", "Garrweave", "Orne Fabrics", "Holtgate Cloth"],
  luxury: ["Halcyon Maison", "Thronehaus", "Erret & Co.", "Varnvale House"],
};
const REGIONS = [
  "the eastern corridor", "the gulf ports", "the northern belt", "the inland hubs",
  "the western basin", "the capital region", "the river valley", "the coastal zone",
  "the southern reach", "the lake district", "the highland counties", "the delta plains",
];
const TIMELINES = ["within weeks", "over the coming season", "by the next quarter", "before year's end", "in the months ahead"];

const label = (s) => (s === "luxury" ? "luxury" : s[0].toUpperCase() + s.slice(1));
const cap = (s) => label(s)[0].toUpperCase() + label(s).slice(1);

function ctxFor(s) {
  const [f, f2] = pick2(FIRMS[s]);
  const [reg, reg2] = pick2(REGIONS);
  return { f, f2, reg, reg2, l: label(s), L: cap(s), tl: pick(TIMELINES), pct: intB(8, 24), pct2: intB(5, 18) };
}
function fill(str, c) {
  return str
    .replaceAll("{f2}", c.f2).replaceAll("{f}", c.f)
    .replaceAll("{reg2}", c.reg2).replaceAll("{reg}", c.reg)
    .replaceAll("{L}", c.L).replaceAll("{l}", c.l)
    .replaceAll("{tl}", c.tl).replaceAll("{pct2}", String(c.pct2)).replaceAll("{pct}", String(c.pct));
}

// Each template: kick, heads[], bodies[] (rich, 3–4 sentences), range, dur.
const POS = [
  {
    kick: "Industry",
    heads: ["{f} unveils major {l} expansion across {reg}", "{f} breaks ground on a sweeping {l} program in {reg}", "{f} commits to a multi-season {l} buildout in {reg}"],
    bodies: [
      "{f} confirmed a large-scale {l} buildout across {reg} this morning, with the first phase alone running well into the hundreds of millions. Hiring and procurement are slated to begin {tl}, and suppliers say order books are already filling. {f2} and other operators in {reg2} are weighing similar moves, raising the prospect of a broader {l} cycle that could stretch for years.",
      "The plan from {f} lands after months of speculation, and the scale — a roughly {pct}% lift to regional capacity — caught even seasoned operators off guard. Work crews are being assembled across {reg}, with the buildout expected to draw heavily on connected supply chains {tl}. Rivals are reported to be accelerating their own {l} timetables in response.",
    ],
    range: [0.16, 0.26], dur: [4, 5, 5, 6],
  },
  {
    kick: "Policy",
    heads: ["Lawmakers pass a package favoring {l} over coming seasons", "Legislators clear a long-stalled {l} spending bill", "New public program steers sustained funds toward {l}"],
    bodies: [
      "A long-debated spending package cleared its final vote overnight, directing sustained public funds toward {l} programs across {reg}. Operators say the certainty alone is enough to restart projects that had been shelved since the last downturn, and {f} is among those already revising plans upward. The first disbursements are expected {tl}.",
      "After repeated delays the measure finally passed, earmarking funds for {l} over several seasons. Industry groups put the figure at roughly {pct}% above the prior cycle, and firms tied to {l} in {reg} are dusting off proposals they had quietly paused. {f} called the move a turning point for the category.",
    ],
    range: [0.18, 0.28], dur: [5, 6, 6],
  },
  {
    kick: "Materials",
    heads: ["Supply of key {l} inputs tightens as disruption drags on", "{L} inputs grow scarce as bottlenecks persist", "Lead times stretch for critical {l} components"],
    bodies: [
      "A prolonged disruption has squeezed availability of critical {l} inputs, with lead times now stretching {tl} and buyers watching inventories nervously. Procurement desks at {f} and {f2} have begun rationing what they hold, and spot availability across {reg} has thinned to a trickle. No quick resolution appears to be in sight.",
      "Essential {l} components have grown scarce as bottlenecks in {reg} persist into a third week. Several operators report orders slipping by {tl}, and some have started paying premiums to secure the little supply that remains. {f} warned that the squeeze could outlast the season.",
    ],
    range: [0.1, 0.18], dur: [3, 4],
  },
  {
    kick: "Demand",
    heads: ["Unexpected wave of demand catches {l} suppliers flat-footed", "{L} orders spike sharply, straining suppliers", "A sudden run on {l} goods empties supplier shelves"],
    bodies: [
      "A sharp, unplanned spike in {l} orders — up an estimated {pct}% on the prior period — has left suppliers across {reg} scrambling to keep shelves stocked. {f} added shifts overnight, while {f2} reported its fullest order book in seasons. Analysts are split on whether the run-up will hold or fade {tl}.",
      "Demand for {l} goods filled order books faster than anyone forecast this week, and producers are racing to add capacity in {reg}. The surge has reached well beyond the usual buyers, and lead times are creeping out {tl}. {f} said it was prioritising existing customers as the wave builds.",
    ],
    range: [0.12, 0.22], dur: [3, 4],
  },
  {
    kick: "Industry",
    heads: ["{f} secures major backing to scale {l} capacity", "Fresh capital flows into {f}'s {l} push"],
    bodies: [
      "{f} closed a sizeable funding round aimed squarely at expanding {l} output across {reg}, and suppliers expect the spend to flow downstream {tl}. The raise — among the largest in the category this cycle — will fund new lines and a hiring push of several hundred. {f2} is said to be lining up its own round.",
      "Backers lined up behind {f}'s plan to widen its {l} footprint, with the firm signalling an aggressive build timetable. Roughly {pct}% of the new capital is earmarked for {reg}, where capacity has lagged demand for months. Construction and equipment orders are expected to follow {tl}.",
    ],
    range: [0.14, 0.24], dur: [4, 5, 6],
  },
  {
    kick: "Trade",
    heads: ["{L} export orders climb on strong overseas appetite", "Overseas buyers lift {l} order books to multi-season highs"],
    bodies: [
      "Fresh figures show overseas orders for {l} goods climbing roughly {pct}% past forecasts, and producers in {reg} are adding capacity to keep pace. Shipments out of the gulf ports are running hot, and {f} has chartered extra freight to clear the backlog {tl}. Trade groups expect the strength to persist.",
      "Strong foreign appetite has {l} order books at their fullest in seasons, with {f} and {f2} both reporting record overseas bookings. The orders span {reg} and {reg2}, and operators are weighing whether to expand lines {tl}.",
    ],
    range: [0.12, 0.2], dur: [4, 5],
  },
  {
    kick: "Labor",
    heads: ["Labor action halts output, squeezing {l} supply", "A walkout at major {l} operations tightens availability"],
    bodies: [
      "A walkout across several {l} operations in {reg} has idled output, and downstream operators are already feeling the pinch as available stock thins. {f} said talks had stalled, with no return-to-work date set; {f2} is rerouting orders to other regions at higher cost. Buyers are bracing for tighter supply {tl}.",
      "Stoppages rippled through {l} producers this week, leaving buyers competing for a shrinking pool of supply. With roughly {pct}% of regional capacity offline, lead times have jumped and some orders have been deferred {tl}. {f} warned customers to expect delays.",
    ],
    range: [0.1, 0.18], dur: [3, 4],
  },
  {
    kick: "Outlook",
    heads: ["Analysts lift {l} forecasts after a stronger-than-expected run", "Confidence builds across {l} as the season turns"],
    bodies: [
      "A run of stronger-than-expected figures has analysts revising {l} forecasts upward, with several now pencilling in a {pct}% expansion across {reg} this cycle. {f} pointed to firm order books and easing input costs, and {f2} echoed the optimism. The improved mood is feeding plans that had been on hold.",
      "Sentiment across {l} has brightened markedly, and operators in {reg} say the pipeline is the healthiest it has looked in seasons. {f} expects the momentum to carry {tl}, with hiring and capacity decisions likely to follow.",
    ],
    range: [0.12, 0.2], dur: [4, 5],
  },
];

const NEG = [
  {
    kick: "Markets",
    heads: ["{L} oversupply pulls prices off recent highs", "A glut leaves {l} producers with stock to clear"],
    bodies: [
      "A wave of new capacity has flooded the {l} space across {reg} faster than buyers can absorb it. Operators that leaned into the boom — {f} among them — are now trimming the excess they built up, and inventories sit well above comfortable levels. The overhang is expected to weigh on the category {tl}.",
      "Inventories of {l} goods have swelled roughly {pct}% past normal, and producers are quietly marking down to move stock. {f} and {f2} have both eased output in {reg}, but the backlog will take time to clear.",
    ],
    range: [0.14, 0.22], dur: [3, 4, 4],
  },
  {
    kick: "Recall",
    heads: ["{f} issues a sweeping recall, rattling {l} confidence", "Fault reports trigger a broad {f} recall across {l}"],
    bodies: [
      "{f} announced a broad recall after fault reports surfaced in its flagship line, pulling tens of thousands of units from {reg}. The news cast a chill over the wider {l} category heading into a closely watched stretch, and {f2} moved to reassure customers. Operators expect a softer season as confidence steadies.",
      "A widening recall at {f} has unsettled the {l} category, with the firm halting shipments while it investigates. Early estimates put the affected run at a meaningful share of recent output, and buyers across {reg} are holding back {tl}.",
    ],
    range: [0.16, 0.24], dur: [3, 4],
  },
  {
    kick: "Markets",
    heads: ["{L} activity slumps on cost and rate jitters", "Higher costs drag {l} activity toward a standstill"],
    bodies: [
      "Fresh figures show {l} activity falling sharply as higher costs spook operators across {reg}. Several large commitments were quietly shelved pending clearer conditions, and {f} flagged a softer pipeline {tl}. Planners say they would rather wait than lock in at current prices.",
      "Rising costs have cooled {l} markedly, with activity off an estimated {pct}% from the recent peak. {f} and {f2} are both deferring orders, and the pullback is showing up across {reg}.",
    ],
    range: [0.14, 0.2], dur: [4, 5],
  },
  {
    kick: "Markets",
    heads: ["{L} backlog clears faster than forecast", "Pressure eases as {l} bottlenecks unwind"],
    bodies: [
      "The strain that had gripped {l} for months has eased ahead of schedule, and conditions across {reg} are normalising. Operators are unwinding the surge capacity they leaned on, and {f} said the premium customers had been paying for scarce supply is fading. The category looks calmer heading {tl}.",
      "Conditions in {l} have loosened quicker than expected, with lead times back near normal across {reg}. {f} and {f2} are trimming the extra capacity built during the squeeze.",
    ],
    range: [0.1, 0.16], dur: [3, 4],
  },
  {
    kick: "Policy",
    heads: ["New rules add a fresh headwind for {l} operators", "Tighter oversight clouds the outlook for {l}"],
    bodies: [
      "A fresh round of oversight lands on {l} this season, and operators warn the added cost of compliance will weigh on activity across {reg}. {f} estimated the rules could shave a meaningful slice off output {tl}, and smaller firms say the burden falls hardest on them. The category is bracing for a slower stretch.",
      "Regulators tightened the rules governing {l}, and firms say the change will slow projects already running on thin margins. {f} and {f2} are reviewing plans in {reg}, with some commitments likely to be pushed out {tl}.",
    ],
    range: [0.12, 0.2], dur: [4, 5],
  },
  {
    kick: "Markets",
    heads: ["A margin squeeze forces {l} operators to pull back", "{L} order pipeline thins as confidence wavers"],
    bodies: [
      "Squeezed margins have {l} operators trimming plans and deferring orders across {reg}. {f} pointed to costs rising faster than it could pass on, and {f2} described the thinnest pipeline in seasons. The pullback is expected to linger {tl}.",
      "A thinning pipeline has cooled the {l} category, with several firms holding back rather than commit into uncertainty. Activity across {reg} has slipped an estimated {pct}%, and operators are watching for a clearer signal before moving.",
    ],
    range: [0.12, 0.18], dur: [3, 4],
  },
  {
    kick: "Outlook",
    heads: ["Analysts trim {l} forecasts as momentum fades", "Caution returns to {l} after a softer run"],
    bodies: [
      "A run of softer figures has analysts cutting {l} forecasts, with several now expecting activity to contract across {reg} this cycle. {f} cited weaker orders and stubborn costs, and the cautious tone is spreading. Plans that looked solid a season ago are being revisited.",
      "Sentiment across {l} has cooled, and operators in {reg} describe a wait-and-see mood. {f} expects the soft patch to persist {tl} before conditions steady.",
    ],
    range: [0.12, 0.18], dur: [3, 4],
  },
];

const CROSS_PAIRS = [
  ["construction", "energy", "A grid-and-infrastructure program ties construction to power buildout"],
  ["logistics", "construction", "A distribution-network rollout pulls both freight and buildout demand"],
  ["automotive", "energy", "An electrification push lifts both vehicle and power-storage demand"],
  ["technology", "energy", "A data-center wave drives compute and the power to run it"],
  ["agriculture", "logistics", "A bumper harvest strains storage and freight capacity"],
  ["manufacturing", "construction", "A reshoring drive fuels factory and facility buildout"],
  ["hospitality", "consumer", "A tourism surge lifts food service and everyday goods"],
  ["medical", "manufacturing", "A health-system stockpiling push pulls device manufacturing"],
  ["textiles", "consumer", "An apparel cycle lifts raw cloth and finished goods together"],
  ["luxury", "consumer", "A wealth-effect quarter lifts both the top end and broad retail"],
  ["technology", "manufacturing", "An automation rollout couples compute with factory tooling"],
  ["energy", "agriculture", "A fuel-cost swing reshapes both power and farm-input demand"],
  ["construction", "manufacturing", "A public-works wave pulls structural materials and machinery"],
  ["logistics", "consumer", "A delivery-network expansion lifts freight and retail flow"],
];

function singleSector(t, s, sign) {
  const c = ctxFor(s);
  const mag = uni(t.range[0], t.range[1]) * (sign === "neg" ? -1 : 1);
  return {
    kick: t.kick,
    head: fill(pick(t.heads), c),
    body: fill(pick(t.bodies), c),
    effects: { [s]: Math.round(mag * 1000) / 1000 },
    dur: pick(t.dur),
  };
}
function crossPos(pair) {
  const [a, b, desc] = pair;
  const c = ctxFor(a);
  return {
    kick: "Industry",
    head: `${c.f} program links ${label(a)} and ${label(b)} in ${c.reg}`,
    body: `${cap(desc[0]) + desc.slice(1)}. ${c.f} said the initiative, centred on ${c.reg}, would run for several seasons and draw heavily on connected supply chains. Knock-on demand is expected to spread well beyond the headline sector, with ${label(b)} suppliers in ${c.reg2} already reporting fresh enquiries. Operators expect the program to ramp ${c.tl}.`,
    effects: { [a]: uni(0.18, 0.26), [b]: uni(0.06, 0.12) },
    dur: pick([4, 5, 6]),
  };
}

const AUCTION = {
  heads: ["Record gavel: a rare piece shatters its auction estimate", "A marquee evening sale clears far above its top estimate", "Collectors chase a trophy lot to a record result"],
  bodies: [
    "A closely watched evening sale produced a result several multiples above its low estimate, reigniting chatter about the very top of the collectibles market. Bidding ran long past the published guides, and specialists left the room talking about renewed appetite at the rarefied end. Confidence at the high end, they note, tends to feed on itself.",
    "A single-owner sale drew fierce competition, with a trophy lot hammering well beyond expectations after a protracted bidding war. Houses report fuller consignment books heading into the season, a sign sellers sense the moment.",
  ],
};
function auction() {
  return { kick: "Luxury", head: pick(AUCTION.heads), body: pick(AUCTION.bodies), effects: { luxury: uni(0.16, 0.24) }, dur: pick([3, 4]) };
}

const QUIET = [
  ["Markets", "A quiet session across the floor", "No major catalysts moved the market today. Trading was thin and prices drifted on their own momentum, with most desks content to wait for the next signal."],
  ["Markets", "A holiday lull keeps activity subdued", "With much of the trade away, volumes thinned to a trickle. Few were willing to commit ahead of the coming week, and the floor coasted into the close."],
  ["Weather", "Storms snarl movement in scattered regions", "Severe weather briefly disrupted activity in parts of the country, delaying shipments and shuttering a handful of sites. Operators expect normal conditions to resume shortly."],
  ["Markets", "Prices drift in a featureless session", "Little of note crossed the wires, and the floor coasted on its own momentum. Desks reported light, orderly trade with no clear direction."],
  ["Weather", "A calm spell settles over the regions", "Mild conditions and a light calendar kept activity muted. Most operators were content to wait for the next catalyst before committing."],
];
function quiet() {
  const [k, h, b] = pick(QUIET);
  return { kick: k, head: h, body: b, effects: {}, dur: 1 };
}

function build() {
  const bank = [];
  for (const s of SECTORS) {
    for (const t of POS) bank.push(singleSector(t, s, "pos"));
    for (const t of NEG) bank.push(singleSector(t, s, "neg"));
  }
  for (const p of CROSS_PAIRS) bank.push(crossPos(p));
  for (let i = 0; i < 10; i++) bank.push(auction());
  for (let i = 0; i < 12; i++) bank.push(quiet());

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
    effects: Object.fromEntries(Object.entries(sc.effects).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    dur: sc.dur,
    weight: Object.keys(sc.effects).length ? 1 : 0.4,
  }));
}

const bank = build();

const banned = ["buy ", "sell ", "you should", "ai ", "trader", "recommend", "invest in", "portfolio"];
const flags = [];
for (const sc of bank) {
  const text = `${sc.head} ${sc.body}`.toLowerCase();
  for (const b of banned) if (text.includes(b)) flags.push([sc.id, b, sc.head]);
}

// per-sector single-sector counts (for segment depth)
const perSector = {};
for (const sc of bank) {
  const keys = Object.keys(sc.effects);
  if (keys.length === 1) perSector[keys[0]] = (perSector[keys[0]] ?? 0) + 1;
}
const avgWords = Math.round(bank.reduce((a, s) => a + s.body.split(/\s+/).length, 0) / bank.length);

const json = JSON.stringify(bank, null, 2) + "\n";
writeFileSync(join(catalogDir, "news.json"), json);
writeFileSync(join(rootDataDir, "news.json"), json);

console.log(`news scenarios: ${bank.length}  (avg ${avgWords} words/body)`);
console.log(`per-sector single-sector stories:`, JSON.stringify(perSector));
console.log(`banned-phrase flags: ${flags.length} ${flags.length ? JSON.stringify(flags) : "(clean)"}`);
if (flags.length) process.exit(1);
