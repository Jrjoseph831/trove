#!/usr/bin/env node
/**
 * Trove — generate the TRADING HOUSES (houses.json).
 *
 * The 100 brands in brands.json manufacture: they own product lines in the
 * catalog. These are the rest of the economy — the firms that move, finance,
 * store, broker and resell what those brands make. They hold treasuries, trade
 * the floor, send order-desk contracts, appear in the Deal Room and carry a
 * public website, but they own no catalog SKUs of their own.
 *
 * Why they exist as a separate file: the whole shared world is persisted as ONE
 * DynamoDB record with a hard 400KB ceiling. A catalog item costs ~87 bytes of
 * that budget, a firm ~115. Giving 400 new companies product lines would add
 * ~6,000 items (~520KB) and break the world outright; adding them as houses
 * costs ~46KB. So the economy grows in the dimension that's cheap.
 *
 * Every name and every biography must be unique. Deterministic — same seed in,
 * same world out. Run: npm run gen:houses -w @trove/data
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");
const read = (n) => JSON.parse(readFileSync(join(catalogDir, n), "utf8"));

const TARGET = Number(process.env.HOUSES ?? 400);

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
const rng = mulberry32(90210);
const rand = () => rng();
const pick = (a) => a[Math.floor(rand() * a.length)];
const round2 = (n) => Math.round(n * 100) / 100;

// ── Names ───────────────────────────────────────────────────────────────────
// Built from parts rather than a hand-written list of 400: a list that long is
// where duplicates and near-duplicates hide. Combinatorial + an explicit
// uniqueness check is the only way to actually guarantee it.
const ROOTS = [
  "Alder", "Ashgrove", "Barrow", "Beckett", "Blackwell", "Bramble", "Briar", "Calder",
  "Cardwell", "Carrick", "Chandler", "Colefax", "Corvin", "Crandall", "Darrow", "Deverel",
  "Dunmore", "Eastgate", "Elmsworth", "Fairweather", "Fallow", "Farrow", "Fenwick", "Fielding",
  "Foxwell", "Gable", "Garrick", "Glenmore", "Granger", "Greaves", "Hadley", "Halloway",
  "Harlow", "Hastings", "Hawkridge", "Hollis", "Ironside", "Kelmscott", "Kestrel", "Langley",
  "Larkin", "Lathrop", "Ledger", "Linden", "Lockwood", "Marchmont", "Marlowe", "Mayfield",
  "Merrick", "Middleton", "Norbury", "Northrop", "Oakhurst", "Orwell", "Paddock", "Pemberly",
  "Pinehall", "Quarry", "Radcliffe", "Ravenswood", "Redmayne", "Ridgeway", "Rookwood", "Rutherford",
  "Saltmarsh", "Sanderson", "Selby", "Sheffield", "Sinclair", "Southwick", "Stanhope", "Sterling",
  "Stonebridge", "Sutcliffe", "Swanwick", "Tallow", "Thackeray", "Thornbury", "Tidewater", "Tolliver",
  "Underhill", "Vanbrugh", "Verity", "Wakefield", "Waverly", "Westbrook", "Wharton", "Whitlock",
  "Wickham", "Winlock", "Wolvercote", "Wrenfield", "Yarborough", "Ashcombe", "Bellhaven", "Cransley",
  "Drummond", "Ellerby", "Foulkes", "Grimsby", "Hartnell", "Inglewood", "Jessop", "Kingsley",
  "Lamplough", "Morrow", "Netherby", "Ovington", "Prescott", "Quennell", "Rossiter", "Stapleton",
  "Trenholm", "Uppingham", "Vexley", "Warburton", "Yelverton", "Ziegler", "Ambrose", "Blythe",
  "Carrowmore", "Dunhaven", "Everly", "Frostwick", "Galbraith", "Hollinger", "Ivorleigh", "Jarrow",
];
const SUFFIX = [
  "Partners", "Holdings", "Group", "Trading Co.", "& Co.", "Capital", "Ventures", "Associates",
  "Brothers", "Exchange", "Trust", "Logistics", "Freight", "Supply", "Distribution", "Merchants",
  "Commodities", "Consolidated", "Enterprises", "Syndicate", "Union", "Works", "Yards", "Wharf",
  "Depot", "Terminal", "Bureau", "Agency", "Traders", "Mercantile",
];

/** Every distinct way a firm can be named, so the directory doesn't read as one
 *  pattern repeated four hundred times. */
const FORMS = [
  (a, b) => `${a} ${b}`,
  (a, b) => `${a} ${b}`,
  (a, b) => `${a} ${b}`,
  (a, b, c) => `${a} & ${c}`,
  (a, b, c) => `${a}-${c} ${b}`,
  (a, b) => `The ${a} ${b}`,
];

// ── What a house actually does ──────────────────────────────────────────────
// The archetype drives the biography, the tagline and the sector lean together,
// so a freight broker never reads like a bonded warehouse.
const ARCHETYPES = [
  {
    id: "broker",
    what: "brokers bulk lots between producers and buyers",
    verbs: ["brokers", "places", "clears"],
    nouns: ["lots", "consignments", "parcels"],
    taglines: ["The lot moves or we don't eat", "Between the maker and the buyer", "Every lot has a home", "We find the other side"],
  },
  {
    id: "freight",
    what: "moves goods — road, rail and water",
    verbs: ["hauls", "runs", "moves"],
    nouns: ["freight", "loads", "containers"],
    taglines: ["On the road before dawn", "Loaded, sealed, gone", "Distance is a solved problem", "It leaves when we say it leaves"],
  },
  {
    id: "warehouse",
    what: "stores and releases inventory on demand",
    verbs: ["holds", "stores", "stages"],
    nouns: ["stock", "pallets", "inventory"],
    taglines: ["Dry, counted, insured", "Room for the whole run", "We hold it until you need it", "Nothing walks out unlogged"],
  },
  {
    id: "finance",
    what: "finances inventory and takes positions in the firms it lends to",
    verbs: ["finances", "underwrites", "backs"],
    nouns: ["positions", "books", "facilities"],
    taglines: ["Patient money, hard terms", "We lend against what's real", "The balance sheet is the product", "Capital, quietly"],
  },
  {
    id: "wholesale",
    what: "buys deep and resells to smaller houses",
    verbs: ["buys", "breaks", "resells"],
    nouns: ["bulk", "case lots", "volume"],
    taglines: ["Buy the pallet, sell the case", "Volume is the whole trick", "Cheaper by the thousand", "We break bulk so you don't"],
  },
  {
    id: "salvage",
    what: "buys distressed and overrun stock and finds it a second buyer",
    verbs: ["clears", "recovers", "rescues"],
    nouns: ["overruns", "distressed lots", "seconds"],
    taglines: ["One firm's write-off", "Nothing is worthless yet", "We buy the mistake", "The last stop before scrap"],
  },
  {
    id: "export",
    what: "handles cross-border trade and the paperwork that comes with it",
    verbs: ["ships", "clears", "consolidates"],
    nouns: ["shipments", "manifests", "cargo"],
    taglines: ["Papers in order", "Across any border", "Cleared before it lands", "The stamp that matters"],
  },
  {
    id: "procure",
    what: "sources hard-to-find materials on contract",
    verbs: ["sources", "secures", "hunts"],
    nouns: ["contracts", "shortages", "scarce stock"],
    taglines: ["If it exists, we'll find it", "The call you make when it's gone", "Sourced, not promised", "Scarcity is the business"],
  },
];

// ── Biography parts ─────────────────────────────────────────────────────────
// Four independent slots. A house's story is one draw from each, and no two
// houses are allowed the same combination — see the dedupe below.
// Every origin is a DEPENDENT clause. The story is assembled as
// "{origin}, {name} {what}." — a self-contained sentence here would splice.
const ORIGINS = [
  (n, y) => `Founded in ${y} out of a single rented office`,
  (n, y) => `Started in ${y} with one truck and a handshake`,
  (n, y) => `On the ledgers since ${y}`,
  (n, y) => `Chartered in ${y} by a family that had been trading informally for decades`,
  (n, y) => `Set up in ${y} to serve a single client and never quite stopped growing`,
  (n, y) => `Grown out of a ${y} side business that outlived the business it was beside`,
  (n, y) => `Formed in ${y} when the founders bought out their employer and kept the customer list`,
  (n, y) => `Trading since ${y} from an address nobody has bothered to change`,
  (n, y) => `Incorporated in ${y}, though the sign above the door is older`,
  (n, y) => `Open since ${y} and never once shut`,
  (n, y) => `Built on two partners, one warehouse and a ${y} lease that turned permanent`,
  (n, y) => `Salvaged from a ${y} bankruptcy nobody else wanted to touch`,
];
const HABITS = [
  "The firm is famously slow to sign and impossible to shake once it has.",
  "It keeps a reputation for paying on time and expecting the same.",
  "Nobody here has ever been accused of moving quickly, or of being wrong twice.",
  "It prefers a small number of large relationships to the other way round.",
  "The house is known for turning down more work than it takes.",
  "Its people are dull in meetings and ruthless on price.",
  "It has outlasted three downturns by refusing to be interesting during them.",
  "Handshakes here are still worth something, which is why the terms are brutal.",
  "The firm negotiates hard, then honours the deal to the letter.",
  "It has never advertised and has never needed to.",
  "Staff turnover is close to zero, which tells you most of what you need.",
  "It answers the phone at hours its competitors do not.",
  "The books are conservative to the point of being boring.",
  "It moves early when everyone else is still holding meetings.",
  "Its rivals call it stubborn; its clients call it reliable.",
  "There is no sales team, only people who have done the job.",
];
const CLOSERS = [
  "Margins are thin and the volume is not.",
  "The work is unglamorous and the counterparties keep coming back.",
  "It does not win awards. It wins renewals.",
  "The floor notices when it starts buying.",
  "Quiet quarters, then a very loud one.",
  "It is the sort of firm that shows up in other firms' footnotes.",
  "Nothing about the operation is flashy, and none of it is accidental.",
  "The name means less to the public than it does to anyone in the trade.",
  "It is not the largest in its lane, and it is rarely the one that fails.",
  "Ask a competitor about them and the answer takes a while.",
  "Growth has been steady, deliberate and almost entirely unremarked.",
  "It survives on knowing exactly what a thing is worth.",
];

const FIRSTS = [
  "Vale", "Dorian", "Mara", "Cole", "Iris", "Soren", "Lena", "Theo", "Nadia", "Rhys",
  "Cora", "Emil", "Sable", "Lorne", "Petra", "Quinn", "Halden", "Mira", "Bram", "Yvette",
  "Orla", "Kestrel", "Aurelia", "Dunmore", "Ines", "Tobias", "Saskia", "Rafe", "Odile", "Gideon",
  "Wren", "Marlow", "Esme", "Caspar", "Delia", "Hugo", "Rosalind", "Ivo", "Beatrix", "Anselm",
];
const LASTS = [
  "Mercer", "Thorne", "Halloran", "Brandt", "Ashby", "Kessler", "Marrow", "Vossen", "Dray", "Holt",
  "Garr", "Orne", "Steg", "Calder", "Fenn", "Wold", "Carrow", "Skarn", "Veldt", "Throne",
  "Bramm", "Aldous", "Ferris", "Nance", "Purcell", "Rooke", "Sallow", "Tarrant", "Vane", "Wexford",
  "Aubry", "Beddoe", "Crale", "Dunning", "Ellory", "Fairbairn", "Gorse", "Hennessy", "Ibbot", "Jarnac",
];
const TRAITS = {
  high: ["restless and acquisitive", "prone to bold, public swings", "fast-moving and headline-hungry", "ambitious, often turbulent"],
  mid: ["steady, with the occasional bold move", "measured but opportunistic", "competent and rarely dramatic", "disciplined, quietly expanding"],
  low: ["quiet and conservative", "slow-moving, long-horizon", "unflashy and dependable", "patient, allergic to drama"],
};
const band = (v) => (v >= 0.58 ? "high" : v >= 0.4 ? "mid" : "low");

const SECTORS = [
  "construction", "logistics", "automotive", "technology", "energy", "agriculture",
  "manufacturing", "medical", "hospitality", "consumer", "textiles", "luxury",
];
const VOL_BAND = {
  technology: [0.62, 0.9], automotive: [0.6, 0.88], luxury: [0.58, 0.86], energy: [0.55, 0.82],
  construction: [0.4, 0.62], logistics: [0.4, 0.62], manufacturing: [0.4, 0.6],
  consumer: [0.38, 0.58], hospitality: [0.4, 0.6],
  agriculture: [0.24, 0.42], medical: [0.26, 0.44], textiles: [0.24, 0.4],
};

// ── Build ───────────────────────────────────────────────────────────────────
const brands = read("brands.json");
const taken = new Set(brands.map((b) => b.name.toLowerCase()));
taken.add("open_index");

/** A name nobody else has. Falls back to a wider form rather than appending a
 *  number, which would read as filler in the directory. */
function newName() {
  for (let i = 0; i < 400; i++) {
    const form = pick(FORMS);
    const n = form(pick(ROOTS), pick(SUFFIX), pick(ROOTS)).replace(/\s+/g, " ").trim();
    if (/^(\w+) & \1$/.test(n)) continue; // "Alder & Alder"
    if (!taken.has(n.toLowerCase())) {
      taken.add(n.toLowerCase());
      return n;
    }
  }
  throw new Error("ran out of unique names — widen ROOTS/SUFFIX");
}

const houses = {};
const lore = {};
const usedStory = new Set(); // origin|habit|closer tuples, so no two read alike
const usedTagline = new Set();

for (let i = 0; i < TARGET; i++) {
  const name = newName();
  const arch = pick(ARCHETYPES);
  const sector = pick(SECTORS);
  const founded = 1890 + Math.floor(rand() * 120);

  // A biography nobody else has. Distinct on the COMBINATION, not just on one
  // sentence — four hundred firms sharing an opening line would be obvious.
  let origin, habit, closer, key;
  for (let t = 0; ; t++) {
    origin = Math.floor(rand() * ORIGINS.length);
    habit = Math.floor(rand() * HABITS.length);
    closer = Math.floor(rand() * CLOSERS.length);
    key = `${origin}|${habit}|${closer}`;
    if (!usedStory.has(key) || t > 60) break;
  }
  usedStory.add(key);

  let tagline;
  for (let t = 0; ; t++) {
    tagline = pick(arch.taglines);
    if (!usedTagline.has(tagline) || t > 20) break;
  }
  usedTagline.add(tagline);

  const story = [
    `${ORIGINS[origin](name, founded)}, ${name} ${arch.what}.`,
    HABITS[habit],
    CLOSERS[closer],
  ].join(" ");

  const [lo, hi] = VOL_BAND[sector] ?? [0.4, 0.6];
  const volatility = round2(lo + rand() * (hi - lo));

  houses[name] = {
    aiOwned: true,
    homeSector: sector,
    kind: "house", // trades and finances; owns no catalog line
    trade: arch.id,
    founded,
    ceo: `${pick(FIRSTS)} ${pick(LASTS)}`,
    ceoSince: founded + Math.floor(rand() * 40),
    personality: { volatility, trait: pick(TRAITS[band(volatility)]) },
    arc: null,
    lastEventCycle: 0,
    events: [
      {
        cycle: 0,
        kind: "profile",
        size: "standard",
        head: `${name} — ${tagline}`,
        body: story,
        effects: {},
      },
    ],
  };
  lore[name] = { tagline, founded, story, trade: arch.id, what: arch.what };
}

writeFileSync(join(catalogDir, "houses.json"), JSON.stringify(houses, null, 2) + "\n");
writeFileSync(join(catalogDir, "houses-lore.json"), JSON.stringify(lore, null, 2) + "\n");
try {
  writeFileSync(join(rootDataDir, "houses.json"), JSON.stringify(houses, null, 2) + "\n");
} catch {
  /* the root mirror is optional */
}

// ── Report (and fail loudly if the world got repetitive) ─────────────────────
const names = Object.keys(houses);
const stories = Object.values(lore).map((l) => l.story);
const dupNames = names.length - new Set(names.map((n) => n.toLowerCase())).size;
const dupStories = stories.length - new Set(stories).size;
const bySector = {};
for (const h of Object.values(houses)) bySector[h.homeSector] = (bySector[h.homeSector] ?? 0) + 1;
const byTrade = {};
for (const h of Object.values(houses)) byTrade[h.trade] = (byTrade[h.trade] ?? 0) + 1;

console.log(`generated ${names.length} houses`);
console.log(`duplicate names   : ${dupNames}`);
console.log(`duplicate stories : ${dupStories}`);
console.log(`collisions with brands: ${names.filter((n) => brands.some((b) => b.name.toLowerCase() === n.toLowerCase())).length}`);
console.log("by sector:", JSON.stringify(bySector));
console.log("by trade :", JSON.stringify(byTrade));
console.log(`bytes in the world doc: ~${Math.round((names.length * 115) / 1024)}KB of the 400KB cap`);
if (dupNames || dupStories) {
  console.error("REPETITION DETECTED — not writing a world that reads copy-pasted");
  process.exit(1);
}
console.log("\nsample:\n" + JSON.stringify(Object.entries(lore).slice(0, 3), null, 2));
