export type RepBranch = "shadow" | "legit";
export type HeatTier = "CLEAN" | "WATCHED" | "FLAGGED" | "UNDER INVESTIGATION";

export interface RepNode {
  id: string;
  branch: RepBranch;
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  /** Lifetime rep in this branch required to unlock. */
  repRequired: number;
  /** Base cash cost before cross-branch friction. */
  baseCost: number;
}

export const SKILL_NODES: RepNode[] = [
  {
    id: "fixer-contacts",
    branch: "shadow",
    tier: 1,
    name: "Fixer Contacts",
    description: "A network of low-profile brokers who keep your riskier moves quiet. Heat decays twice as fast while this is active.",
    repRequired: 50,
    baseCost: 25_000,
  },
  {
    id: "shell-brands",
    branch: "shadow",
    tier: 2,
    name: "Shell Brands",
    description: "Front companies absorb regulatory scrutiny. Scandal price shocks on your produced goods are halved (−8% instead of −15%).",
    repRequired: 150,
    baseCost: 100_000,
  },
  {
    id: "market-manipulation",
    branch: "shadow",
    tier: 3,
    name: "Market Manipulation Suite",
    description: "Rumor seeding, short bursts, coordinated exits. Bulk supply orders earn double Shadow Rep per action.",
    repRequired: 400,
    baseCost: 500_000,
  },
  {
    id: "audit-familiarity",
    branch: "legit",
    tier: 1,
    name: "Audit Familiarity",
    description: "Six quarters of clean filings and a compliance officer on retainer. FLAGGED regulatory overhead costs are cut in half.",
    repRequired: 50,
    baseCost: 25_000,
  },
  {
    id: "institutional-access",
    branch: "legit",
    tier: 2,
    name: "Institutional Access",
    description: "A seat at the exchange's advisory panel. Deals you close as seller earn double Legit Rep.",
    repRequired: 150,
    baseCost: 100_000,
  },
  {
    id: "regulatory-immunity",
    branch: "legit",
    tier: 3,
    name: "Regulatory Immunity",
    description: "Formal recognition as a market-stabilizing force. Bust probability drops 5× (0.4% per tick vs 2%) — institutional cover, not immunity. The commission still looks, just rarely acts.",
    repRequired: 400,
    baseCost: 500_000,
  },
];

export const HEAT_BANDS: { min: number; name: HeatTier }[] = [
  { min: 0,  name: "CLEAN" },
  { min: 25, name: "WATCHED" },
  { min: 50, name: "FLAGGED" },
  { min: 75, name: "UNDER INVESTIGATION" },
];

export function heatTierOf(heat: number): HeatTier {
  let tier: HeatTier = "CLEAN";
  for (const b of HEAT_BANDS) {
    if (heat >= b.min) tier = b.name;
  }
  return tier;
}

/** Cross-branch friction: +5% to cost per opposing node already purchased. */
export const CROSS_FRICTION = 0.05;

/** Effective cash cost for a node given the player's current unlocks. */
export function nodeCost(node: RepNode, unlockedNodes: string[]): number {
  const opposing = node.branch === "shadow" ? "legit" : "shadow";
  const count = SKILL_NODES.filter(
    (n) => n.branch === opposing && unlockedNodes.includes(n.id),
  ).length;
  return Math.round(node.baseCost * (1 + count * CROSS_FRICTION));
}

export function nodeById(id: string): RepNode | undefined {
  return SKILL_NODES.find((n) => n.id === id);
}
