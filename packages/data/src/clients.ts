/**
 * @trove/data — Order Desk client companies.
 *
 * These are fictional END-USER businesses that BUY goods (a hospital, a shipping
 * line, a builder) — deliberately distinct from the seller-brands on the floor,
 * which are producers. A client only orders goods in its own sector, so requests
 * read true: "Cardinal Carriers needs 40 pallet jacks." Names avoid the
 * Holdings/Capital/& Sons style used by brands so clients never read as a holding.
 */
import type { SectorKey } from "./types";

const CLIENTS: Record<string, string[]> = {
  construction: [
    "Ironside Builders",
    "Granite Peak Contractors",
    "Keystone Civil Works",
    "Harborline Construction",
  ],
  manufacturing: [
    "Forgeline Manufacturing",
    "Pinnacle Industrial Works",
    "Axleton Fabrication",
  ],
  automotive: [
    "Apex Auto Group",
    "Redline Motorworks",
    "Continental Fleet Services",
  ],
  energy: [
    "Helios Power",
    "Gridworks Utility",
    "Stormfront Energy",
    "Deepwell Resources",
  ],
  consumer: [
    "Everyday Retail Co.",
    "Hearthstone Goods",
    "Brightway Stores",
  ],
  hospitality: [
    "Lumen Hotels",
    "Coastline Dining Group",
    "Grandview Resorts",
    "Wanderlux Hospitality",
  ],
  technology: [
    "Nexel Systems",
    "Quanta Devices",
    "Cloudspire Technologies",
  ],
  logistics: [
    "Cardinal Carriers",
    "Vantor Logistics",
    "Freightline Express",
    "Portside Distribution",
  ],
  luxury: [
    "Maison Verel",
    "Étoile Boutiques",
    "Aurelian Collection",
  ],
  agriculture: [
    "Harvest Valley Farms",
    "Greenfield Agronomy",
    "Furrow & Field Co-op",
  ],
  medical: [
    "Meridian Health System",
    "St. Caro Medical",
    "Vantage Clinics",
    "BioCare Labs",
  ],
  textiles: [
    "Loomcraft Apparel",
    "Northweave Textiles",
    "Atelier Mill Co.",
  ],
};

/** Every client across all sectors (fallback pool). */
const ALL_CLIENTS = Object.values(CLIENTS).flat();

/** Clients that buy in a sector. */
export function clientsForSector(sector: SectorKey): string[] {
  return CLIENTS[sector] ?? [];
}

/** Pick a buyer for a sector; falls back to any client if the sector is empty. */
export function pickClient(
  sector: SectorKey,
  rng: () => number = Math.random,
): string {
  const pool = CLIENTS[sector]?.length ? CLIENTS[sector]! : ALL_CLIENTS;
  return pool[Math.floor(rng() * pool.length)]!;
}
