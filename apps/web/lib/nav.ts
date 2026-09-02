import {
  Briefcase,
  Building2,
  ClipboardList,
  Factory,
  FileBarChart,
  Globe,
  LayoutGrid,
  type LucideIcon,
  Newspaper,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Trophy,
  Vault,
} from "lucide-react";
import type { TabId } from "@/lib/trove";

/**
 * The single source of truth for the command bar, the mobile drawer and the
 * shortcut sheet. One list, so a destination can never be in the nav but
 * missing from the keyboard map (or the other way round).
 */
export interface Dest {
  id: TabId;
  /** Full screen name — the big title in the command bar. */
  title: string;
  /** Short form for the tile label; the icons are small and 13 of them share a row. */
  label: string;
  Icon: LucideIcon;
  /** Tile colour. Jewel-toned rather than candy — the icons are the only
   *  saturated thing in an otherwise editorial UI, so they carry the "game"
   *  read on their own without the rest of the page shouting. */
  tone: string;
  group: "market" | "firm";
  /** One line on what the screen is for, shown in its header. A game names
   *  its screens and then says what they do; without this every screen opens
   *  with a title that only repeats the tile you just clicked. */
  note: string;
}

export const DESTS: Dest[] = [
  { id: "trending",   title: "Trending",   label: "Trending",   Icon: TrendingUp,    tone: "#c8851f", group: "market", note: "The front page — what moved, what broke, and who is winning." },
  { id: "catalog",    title: "Catalog",    label: "Catalog",    Icon: LayoutGrid,    tone: "#6f61c8", group: "market", note: "Every product on the market. Filter it, compare it, acquire it." },
  { id: "wire",       title: "The Wire",   label: "Wire",       Icon: Newspaper,     tone: "#c0492b", group: "market", note: "Breaking stories, and the prices they move." },
  { id: "companies",  title: "Companies",  label: "Firms",      Icon: Globe,         tone: "#2f8f9b", group: "market", note: "Storefronts and firms trading in this world." },
  { id: "vault",      title: "My Vault",   label: "Vault",      Icon: Vault,         tone: "#4a7ba8", group: "firm", note: "Everything you own, and the credit line behind it." },
  { id: "orders",     title: "Order Desk", label: "Orders",     Icon: ClipboardList, tone: "#3f8f57", group: "firm", note: "Contracts from firms who want what you can supply." },
  { id: "factory",    title: "Factory",    label: "Factory",    Icon: Factory,       tone: "#a8642c", group: "firm", note: "Turn raw material into finished goods under your own mark." },
  { id: "estates",    title: "Trove Estates", label: "Estates", Icon: Building2,     tone: "#5f7689", group: "firm", note: "Property on the market — buy it, hold it, collect on it." },
  { id: "deals",      title: "Deal Room",  label: "Deals",      Icon: Briefcase,     tone: "#8a5296", group: "firm", note: "Equity stakes, buyouts, and the firms in play." },
  { id: "studio",     title: "Studio",     label: "Studio",     Icon: Sparkles,      tone: "#b0568a", group: "firm", note: "Your brand: the images, names and storefront it wears." },
  { id: "goals",      title: "Goals",      label: "Goals",      Icon: Trophy,        tone: "#9c7b34", group: "firm", note: "Milestones worth chasing, and what each one opens up." },
  { id: "report",     title: "Reports",    label: "Reports",    Icon: FileBarChart,  tone: "#54748c", group: "firm", note: "Day by day: net worth, revenue, and where it went." },
  { id: "reputation", title: "Reputation", label: "Standing",   Icon: ShieldAlert,   tone: "#7a7264", group: "firm", note: "Your standing on both sides of the market, and the heat on you." },
];

export const DEST_BY_ID: Record<string, Dest | undefined> = Object.fromEntries(
  DESTS.map((d) => [d.id, d]),
);

/** Keyboard map: 1–9 then 0 reach the first ten destinations, the way a game
 *  binds its hotbar. Everything past ten is mouse/drawer only — a hotkey
 *  nobody can reach without looking it up isn't a hotkey. */
export const HOTKEYS: { key: string; id: TabId }[] = DESTS.slice(0, 10).map(
  (d, i) => ({ key: i === 9 ? "0" : String(i + 1), id: d.id }),
);

export function screenTitle(id: TabId): string {
  return DEST_BY_ID[id]?.title ?? "Trove";
}
