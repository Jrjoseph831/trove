# TROVE — Build Plan

> Working name: **Trove** (handoff package calls it VAULT). A real-time, shared-world
> market game for *physical* assets, priced by a news-driven economy. See
> `README.md` + `specs/01`–`05` for the full vision; this file is the **how/when**.

**Stack decision:** Next.js 16 + TypeScript + React (matches MYTRN). Engine is a
framework-free TS module so it runs both client-side (single-player / sandbox) and
server-side (Lambda settlement) unchanged. AWS comes online only when we go to the
shared "Live" world.

---

## Source of truth
- **Behavior/feel:** `prototype/vault-terminal.html` — a complete, runnable build of
  the core loop. When in doubt, match what it *does*.
- **Why/how:** `specs/01`–`05` + the two `PHASE_*` specs.
- **Content:** `data/*.json` (1,456 items, 76 brands, 69 news, 12 sectors) +
  the two Python generators to expand it.

## Non-negotiables (carry into every phase)
1. News never recommends and never mentions AI/traders. Player infers; effects hidden.
2. One global, **server-owned** clock for Live. Sandbox uses a fast clock and must
   never touch Live state.
3. Editions are finite and **vanish when claimed**; copy number revealed *after*
   purchase, never shown as a counter on the floor.
4. **Zero runtime AI** — news is pre-generated; code only sequences it.
5. Integrity & anti-harassment beat thrill (esp. Public Vaults phase).

---

## Phases

### Phase 0 — Repo scaffold *(next, ~small)*
- `npx create-next-app@latest` (TS, App Router) at the trove root.
- Workspace layout:
  - `packages/engine/` — pure TS port of the prototype engine (DOM-free).
  - `packages/data/` — the JSON catalog + typed loaders (copied from `data/`).
  - `app/` — the Next.js terminal UI.
- Design tokens from the prototype (`--bg`, `--oxblood`, `--brass`, `--hot`, `--cool`,
  `--edition`, Georgia/Inter) into CSS variables / Tailwind theme.
- **Exit criteria:** app boots, engine package imports, data loads & type-checks.

### Phase 1 — Engine module + tests
Port the block between `░░ DATA LAYER ░░` and `░░ VIEW LAYER ░░` to typed functions:
`freshState`, `itemDemand`, `scarcity`, `priceItem`, `advance`, `settleCycle`,
`traderAct`, buy/sell, debt. Wire the **full** `data/*.json` in place of the inline
slice (per spec 03 §"How it replaces the prototype's inline data").
- **Invariant tests** (spec 02 §Determinism): unique ids; `remaining ≤ edition`; no
  wealth from nothing; fast-restock variance ≪ slow-restock under equal demand.
- **Exit criteria:** headless sim runs N cycles; tests green; numbers feel like the
  prototype.

### Phase 2 — Local web app (single-player + sandbox)
Build the real terminal UI against the engine, client-side, on the full catalog:
- Shell: fixed rail + topbar ticker + tabbed view.
- **Trending** (the hero — masthead lead, Heating Up bars, On the Move, Worth
  Watching, vault glance + activity).
- **Catalog** (commodity table + glowing edition cards) — needs **virtualized scroll
  + filtering** for 1,456 items; brand facet (76 brands).
- **The Wire** (front page + archive + sector demand + leaderboard).
- **My Vault** (holdings P/L, edition #s, credit line).
- Edition **reveal modal**; Live/Sandbox switch with warp controls in sandbox only.
- **Exit criteria:** a playable, good-looking single-player Trove. Shippable as a
  differentiated product on its own (per spec 01).

### Phase 3 — AWS backbone (the shared Live world)
Per `specs/04`: EventBridge global clock → Settlement Lambda → DynamoDB
(`items`, `ownership`, `players`, `sectors`, `market`, `news`, `brands`). Trade
Lambda with **conditional writes** for editioned scarcity (`remaining > 0`). AI
trader Lambda on a jittered/Poisson schedule. News `effects` stay server-side.
- **Exit criteria:** one shared clock no client can advance; two players can't grab
  the last copy; sandbox fully isolated from Live.

### Phase 4 — Factory phase
Players produce supply (`PHASE_factory.md`). New `factories` table; settlement gains
a production step feeding the existing `stock`/`restock` spine; archetype-based build
cost/rate/upkeep; market-integrity guards (caps, upkeep, build cooldown).

### Phase 5 — Public Vaults (build last)
Player IPOs (`PHASE_public-vaults.md`). **IV vs Share Price** two-number model;
tiered unlock; mandatory integrity guards (soft tether, circuit breaker, churn fees,
lockups, anti-collusion) and anti-harassment rules (no shorting v1, no comment
surface, right to go private). Highest-risk system — safety before thrill.

---

## Open questions to settle as we go
- Auth/accounts + persistence layer for Live (Supabase like MYTRN, or pure AWS?).
- Monorepo tooling (npm workspaces vs Turborepo).
- Sandbox: separate table namespace vs client-only fast clock.
- Per-archetype factory cost/rate/upkeep curves; Public Vaults tether/breaker/fee
  values — all need sandbox tuning, same as the core economy.

## Status
- [x] Handoff package read end-to-end, copied into `trove/`.
- [x] Stack + sequencing decided (this doc).
- [x] **Phase 0 scaffold — done.** npm-workspaces monorepo (Next 16 + React 19 +
  Tailwind v4). Layout: `apps/web` (terminal UI), `packages/engine` (pure TS:
  types, constants, `freshState`, pricing fns — full sim loop is Phase 1),
  `packages/data` (catalog JSON + typed loaders). App boots, engine imports,
  full 1,456-item catalog loads & type-checks; `/` prerenders a boot check.
  **Deviation from plan:** app lives in `apps/web`, not repo root — root was
  already populated by the handoff, and `create-next-app` needs a clean dir.
- [x] **Phase 1 — done.** Full engine ported (`advance`, `settleCycle`,
  `traderAct`, `playerBuy`/`playerSell`, debt, weighted news sequencing) over
  the full catalog. Injectable RNG (`./rng`) makes the whole sim deterministic.
  15 invariant tests green (vitest): unique ids, supply bounds across 200
  cycles, unit conservation under pure trades, net-worth-neutral buys,
  fast-restock dampening vs slow-restock swing, edition firm-and-vanish,
  determinism, headless smoke. `npm test` from root.
- [x] **Phase 2 — done (pending your visual sign-off).** Full terminal UI in
  React, driven live by the engine via a requestAnimationFrame game loop
  (`lib/trove.tsx`), throttled to ~5 renders/s. Both worlds (Live + Sandbox)
  advance every frame; Sandbox gets warp ×200/×2k + jump.
  - Shell: fixed rail (net worth, nav, mode switch, quiet clock, warp) + oxblood
    topbar with the scrolling brass ticker.
  - TRENDING: masthead lead (front story + inferred-reading line), Heating Up
    sector bars (click → filtered Catalog), On the Move, Worth Watching, vault
    glance + floor activity.
  - CATALOG: virtualized commodity list (@tanstack/react-virtual, all 1,456
    items) + glowing edition cards, sector chips + brand facet + search.
  - THE WIRE: front page + archive, sector demand, leaderboard.
  - MY VAULT: holdings P/L + edition #s, credit line (borrow/repay).
  - Edition reveal modal; toasts; reduced-motion + focus-visible.
  - Verified: typecheck + production build clean, `/` SSRs the boot shell with
    no errors. NOT yet visually screenshotted (Chrome extension wasn't
    connected this session) — run `npm run dev` and open localhost:3000.
- [ ] Phase 3 — AWS backbone (shared Live world).

## Verify Phase 0 locally
```
cd ~/Desktop/trove
npm install
npm run typecheck   # all 3 workspaces clean
npm run build       # next build, prerenders /
npm run dev         # http://localhost:3000 — boot check page
```
