# 03 — Data Schema

All game data lives in `data/*.json`, generated from rules by `generate_economy.py`
(catalog) and `generate_news.py` (news). **~1,450 items, 76 brands, 12 sectors, 26
categories, 67 subcategories, 69 news scenarios.** Regenerate/expand by editing the
generator rules and rerunning (deterministic seeds).

## sectors.json
```jsonc
{ "construction": { "label": "Construction", "blurb": "Buildings, infrastructure, heavy materials" }, ... }
```
12 sectors. Keys are used as the canonical sector id everywhere.

## items.json — THE CATALOG
```jsonc
{
  "id": 0,                       // stable unique int (primary key)
  "name": "HD Cordless Drill",
  "brand": "Throneworks",        // FK → brands.json
  "tier": "premium",             // mass | mid | premium | luxury
  "category": "Hardware & Tools",
  "sub": "Power Tools",
  "archetype": "component",      // supply-behavior class (see Engine §price)
  "icon": "🛠️",
  "weights": { "consumer":0.6, "construction":0.6, "manufacturing":0.4 }, // sector cascade weights
  "base": 1427.88,               // baseline price
  "stockNormal": 2462,           // normal floor units (open items)
  "restock": 143,                // units returned per cycle (0 for editions)
  "edition": null,               // null = open; N = finite run of N
  "elaborate": 0.402             // 0..1 volatility beta + collectible glow
}
```
Runtime adds (engine, not stored in seed): `stock, remaining, owners{}, value,
prevValue, myCopies[], buyAt`.

**Archetypes** (price/stock/restock bands, baked into each record):
`micro_consumable, bulk_consumable, commodity, component, light_equipment,
heavy_equipment, vehicle, luxury_good, collectible`. Kept on the record for filtering
and the Factory phase; engine doesn't need it at runtime.

**Editions:** only `collectible` and `luxury_good` archetypes are ever editioned
(runs 1/2/3/5/8/12). ~34 exist. They vanish when claimed.

## brands.json — THE BRAND BIBLE
```jsonc
{ "name":"Throneworks", "homeSector":"manufacturing",
  "tiers":["mid","premium"], "categories":["Hardware & Tools","Industrial Machines"],
  "sectors":["manufacturing","construction"] }
```
76 invented brands. ~34 span multiple categories (believable conglomerates).
`homeSector` lets news name a brand plausibly.

## taxonomy.json
```jsonc
{ "Hardware & Tools": { "sectors": {"consumer":0.6,...}, "subs": { "Power Tools": ["Cordless Drill", ...] } } }
```
The catalog tree. Useful for browse UIs and for understanding item grouping.

## news.json — THE NEWS BANK
```jsonc
{
  "id": "news_002",
  "kick": "Policy",                      // eyebrow/category label
  "head": "Lawmakers pass package favoring Logistics over coming seasons",
  "body": "A long-debated spending package cleared its final vote overnight, ...",
  "effects": { "logistics": 0.228 },     // HIDDEN sector deltas (not shown to player)
  "dur": 6,                              // cycles the effect influences demand
  "weight": 1                            // selection weight (quiet days = 0.4)
}
```
69 scenarios: single-sector positive/negative, 13 cross-sector cascades, luxury
auctions, and quiet days. **`body`/`head` never state a recommendation, never
mention AI/traders** — validated in the generator (banned-phrase check passes clean).
Engine shows `head`/`body`/`kick`; `effects` stay server-side.

## stats.json
Summary counts for balancing reference. Regenerated each run.

## How it replaces the prototype's inline data
The prototype hardcodes `SECTORS`, `ITEMDEFS`, `NEWSBANK`. To go full-data:
1. `SECTORS` ← `sectors.json`.
2. In `freshState()`, build `items` by mapping `items.json` records (every needed
   field is present: `base, weights, stockNormal, restock, edition, elaborate, icon,
   brand, name`). Initialize runtime fields exactly as the prototype does.
3. `NEWSBANK` ← `news.json` (respect `weight` when selecting).
4. `brands.json` powers brand filters and the news brand-naming.
Pricing math (`itemDemand/scarcity/priceItem`) is unchanged.

## Growing the world
Edit `TAXONOMY` / `ARCHETYPES` / brand morphemes in `generate_economy.py`, or the
templates in `generate_news.py`, then rerun. Counts scale automatically; ids stay
deterministic for a given ruleset + seed.
