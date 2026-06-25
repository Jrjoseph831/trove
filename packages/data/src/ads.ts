/**
 * TNN off-peak commercials — fictional in-world ads that run as filler between
 * the bells. Pure comic-relief world-building: none of these are real catalog
 * brands. `tone` drives the backdrop art (news-bg/ad-<tone>.png) + accent.
 * Keep them short, fictional, and tongue-in-cheek.
 */
export type AdTone = "tech" | "food" | "smoke" | "lux" | "street" | "studio";

export interface AdSpot {
  id: string;
  /** The fictional sponsor. */
  brand: string;
  /** The headline tagline. */
  line: string;
  /** A small kicker / fine-print gag under it. */
  sub?: string;
  tone: AdTone;
}

export const ads: AdSpot[] = [
  // ── Tech ───────────────────────────────────────────────────────────────
  { id: "nimbus", brand: "NimbusOS 12", line: "Now with feelings. (Beta.)", sub: "Your laptop may cry. This is normal.", tone: "tech" },
  { id: "quanta", brand: "QuantaCharge", line: "Your whole life, charged in four seconds.", sub: "Side effects may include mild time travel.", tone: "tech" },
  { id: "halcyon", brand: "Halcyon Earbuds", line: "Hear everything. Regret most of it.", sub: "Noise-cancelling, conscience optional.", tone: "tech" },
  { id: "orbital", brand: "Orbital Wi-Fi", line: "Internet so fast, your regrets load instantly.", sub: "Coverage not guaranteed indoors. Or outdoors.", tone: "tech" },
  { id: "bullhorn", brand: "Bullhorn Coin", line: "It can only go up.*", sub: "*Down. It can also go down.", tone: "tech" },

  // ── Edible products ─────────────────────────────────────────────────────
  { id: "gribble", brand: "Gribble's Microwave Lasagna", line: "It's basically Italy.", sub: "Eight minutes on high. Cool for a geological age.", tone: "food" },
  { id: "megagulp", brand: "MEGAGULP Energy", line: "Sleep is a competitor. Crush it.", sub: "Do not operate feelings while consuming.", tone: "food" },
  { id: "tinsel", brand: "Tinsel Snack Cakes", line: "Sixty percent air. One hundred percent joy.", sub: "Now in a slightly smaller box for the same price.", tone: "food" },
  { id: "boyardunno", brand: "Chef Boyar-Dunno", line: "Dinner. Probably.", sub: "A meal-adjacent experience for the whole family.", tone: "food" },
  { id: "petunia", brand: "Aunt Petunia's Pickled Everything", line: "If it fits in a jar, we've pickled it.", sub: "Yes. Even that. Especially that.", tone: "food" },

  // ── Cigarettes & smokes (retro, satirical) ──────────────────────────────
  { id: "camembert", brand: "Camembert Cigarettes", line: "The smooth taste of poor decisions.", sub: "Doctors no longer return our calls.", tone: "smoke" },
  { id: "pemberton", brand: "Lord Pemberton's Pipe Tobacco", line: "For the gentleman who has quietly given up.", sub: "Pairs with brandy and a long, hard look out the window.", tone: "smoke" },
  { id: "vaporbaron", brand: "Vapor Baron", line: "Clouds bigger than your problems.", sub: "Flavors: Mango, Mystery, and Regret.", tone: "smoke" },

  // ── Luxury & lifestyle ──────────────────────────────────────────────────
  { id: "onyxoak", brand: "Onyx & Oak", line: "Smell like a man who owns a boat he never uses.", sub: "Notes of teak, ambition, and unpaid dockage.", tone: "lux" },
  { id: "meridian", brand: "Meridian Timepieces", line: "Tell time like you mean it.", sub: "Water-resistant to depths you will never visit.", tone: "lux" },
  { id: "velveteen", brand: "Velveteen Recliners", line: "Sit down. Stay down.", sub: "The last chair you'll ever need to leave.", tone: "lux" },

  // ── Street & cool ───────────────────────────────────────────────────────
  { id: "apex", brand: "Apex Sneakers", line: "Run from your responsibilities. Faster.", sub: "Now with 12% more bounce, 0% more accountability.", tone: "street" },
  { id: "mastodon", brand: "Mastodon Pickups", line: "Overcompensate. Responsibly.", sub: "Tows anything, including your sense of self-worth.", tone: "street" },

  // ── Finance / meta / absurd ─────────────────────────────────────────────
  { id: "solvent", brand: "Solvent Mutual Insurance", line: "We'll be there. Probably.", sub: "Coverage subject to a clause we hope you don't read.", tone: "studio" },
  { id: "existential", brand: "Existential Mattresses", line: "Why are we here? At least be comfortable.", sub: "100-night trial. The void is forever.", tone: "studio" },
  { id: "gravelking", brand: "Gravel King Cement", line: "We're not soft. Neither is this.", sub: "If you can read this, you're standing on us.", tone: "studio" },
  { id: "ferris", brand: "Ferris & Dunne Brokerage", line: "Buy high. We won't judge.", sub: "Past performance is a cry for help, not a guarantee.", tone: "studio" },
];
