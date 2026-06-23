# 05 — UI Spec

Reference implementation: `prototype/vault-terminal.html`. It's a full-screen,
tabbed, desktop-first **auction-house terminal**. Match the structure and feel;
the prototype's CSS is a usable starting point.

## Aesthetic
- **Auction-house / dealing-room**, not a finance app. Dark warm browns (felt/
  leather depth), **oxblood** mastheads/rules, **brass** accent + highlight,
  Georgia serif for display/prices, Inter for data/labels.
- Heat = warmth: **amber/brass** rising, **steel-blue** cooling. Never red/green
  ticker clichés.
- **Editioned glow:** soft purple halo + ✦ glint + a quiet word. Never a stock
  counter on the floor.
- Signature element: the **front-page masthead + live brass ticker**. It should
  read like opening a dealing-room paper.

## Layout: fixed full-viewport shell
```
┌──────────┬────────────────────────────────────────────┐
│  RAIL    │  TOPBAR: live ticker (headline + price tape) │
│ (fixed)  ├────────────────────────────────────────────┤
│ brand    │  TAB VIEW (one of):                          │
│ networth │   • TRENDING  • CATALOG  • THE WIRE • VAULT   │
│ nav tabs │                                              │
│ mode/    │   (panels scroll internally; shell does not) │
│ clock    │                                              │
└──────────┴────────────────────────────────────────────┘
```
- **Left rail:** identity, net worth (cash/assets/debt), tab nav (Trending,
  Catalog, The Wire, My Vault, + Factory "soon"), mode switch (Live/Sandbox), quiet
  clock ("front page turns in ~Xh" — **no cycle counter shown**), sandbox warp
  controls (only visible in sandbox).
- Responsive: rail collapses to a drawer under ~780px.

## TRENDING (the hero page — get this right)
Not a raw market, not a boring dashboard. Editorial pulse:
1. **Masthead lead** — the front-page story rendered like newspaper copy
   (paper name, edition line, kick, headline, body). One quiet inferred-reading
   line: *"On the floor: Logistics, Construction in focus"* — names **sectors as
   reading**, never "buy X".
2. **Heating Up** — sector demand bars (click → jump to Catalog filtered).
3. **On the Move** — tile rail of biggest movers since the page turned.
4. **Worth Watching** — tile rail of marquee editions still on the floor (glowing).
5. **Two-up:** your vault glance + floor activity log.

## CATALOG (the deep dive for gold)
- **Mix presentation:** commodities as a tight **data table** (item, sector, supply
  state, price, Δ, acquire); collectible editions as **glowing cards** in a side
  column.
- Sector filter chips + brand/item search.
- Supply state shown qualitatively ("in stock / tight / scarce"), not raw numbers.

## THE WIRE (news)
- Current front page + readable archive of past stories.
- Sector demand + leaderboard alongside. Read the world, reason about it.

## MY VAULT
- Holdings table with per-item P/L and edition numbers ("#2 of 3").
- Credit line panel (borrow/repay, interest).

## Key interactions
- **Acquire (open item):** instant, toast "Acquired".
- **Acquire (edition):** triggers the **reveal modal** — shows the exact copy number
  ("№ 2 of 3", "1 of 1", or "the final copy"). The collector's unwrap.
- **Let go:** sell, toast with realized P/L.
- **Sector bar click:** deep-link into Catalog filtered to that sector.

## Quality floor
Keyboard focus visible, reduced-motion respected, mobile-survivable. Spend the
boldness on the masthead/ticker; keep everything else disciplined.

## What the full data changes vs the prototype
- ~1,450 items means the Catalog table needs **pagination or virtualized scroll**
  and good filtering (the prototype's slice didn't need it).
- Trending's "On the Move"/"Worth Watching" rails should sample from the full set.
- Brand filter becomes genuinely useful with 76 brands — add a brand facet.
