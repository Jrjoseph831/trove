# TROVE — Status & Handoff

_Last updated: 2026-09-02. This file travels with the repo — read it first to pick up where we left off (especially on a fresh machine, where local Claude "memory" does NOT exist)._

## What TROVE is
A real-time, shared-world market/economy game for fictional physical goods. **Streaming-first**: the #1 design driver is 3h+ live YouTube solo-empire-building streams — judge every feature by _"does this make a better stream?"_
- **Prod:** https://trove.ceo (and www.trove.ceo) — `main` branch.
- **Beta:** https://beta.trove.ceo — `beta` branch (where all active work happens).
- GitHub: github.com/Jrjoseph831/trove

## Working rules (IMPORTANT)
1. **Work on `beta` ONLY. Never merge to `main`/prod without Joe's explicit OK.** (Exactly one approved merge has happened: 2026-06-28.)
2. **Never commit or push secrets** (keys/tokens/PII). The OpenAI key lives only in a gitignored `.env`.
3. Joe runs all AWS IAM/OIDC/bootstrap himself in CloudShell — don't attempt it.
4. Keep beta green: `npm run -w @trove/web build` must pass before every commit.
5. Design bar: **senior-Apple-designer** restraint. Remove "AI"/"floor"/"house" jargon (prefer firms / market; the only allowed "floor" is the literal **manufacturing floor**). Don't surface god-view data that makes the game "too easy."

## Architecture (quick map)
npm-workspaces monorepo:
- `apps/web` — Next 16 / React 19 / Tailwind v4. **NOT vanilla Next.js** — read `apps/web/AGENTS.md` before touching it.
- `packages/engine` — deterministic TS economy engine.
- `packages/data` — catalog JSON (items, companies, properties, newsroom) + loaders.
- `packages/server` — DynamoDB repo + Lambda handlers.
- `infra` — CDK v2.

### Deployment facts
- **Prod backend:** `https://gxk49f7clg.execute-api.us-east-1.amazonaws.com` (CDK stack `TroveShared`, AWS acct `243413538293`, us-east-1). Where **G&H Holdings** (Joe's real account) lives.
- **Staging backend:** `https://x5p7r5nsh4.execute-api.us-east-1.amazonaws.com` (CDK stack `TroveStaging`). Beta points here.
- **Frontend:** Vercel project `trove-web`. `trove.ceo` = prod (main), `beta.trove.ceo` = beta.
- **CRITICAL — env var scoping:** `NEXT_PUBLIC_TROVE_API` is baked at build time and MUST be per-scope: **Production → prod API (gxk49f7clg)**, **Preview → staging API (x5p7r5nsh4)**. (A 2026-06-28 incident: it was set to "Production and Preview" with the staging value, so trove.ceo rendered the staging world. Fixed by splitting the scopes. If prod ever shows the wrong account again, check this first.)
- **Deploy triggers:** push `main` → Vercel prod **+ AWS prod CDK deploy** (`.github/workflows/deploy-aws.yml`, paths: `infra/**`, `packages/server|engine|data/**`). push `beta` → Vercel preview + AWS staging stack. **So any infra/server/engine/data change merged to main redeploys the live prod stack** — always review the infra diff for DynamoDB table / construct-logical-ID changes (replacement = world-data loss risk) before merging to prod.
- Staging is isolated: separate DynamoDB tables; reuses the prod Cognito pool (`us-east-1_E51s2w3Kx`), so the same login maps to a different player record per world (e.g. "Shore Holdings" in staging vs "G&H Holdings" in prod — expected, not corruption). The `/dev` tools route (fund / summon buyout) is staging-only (`if (!isProd)`).

## Merged to PROD 2026-08-12 — data integrity + a 501-firm world
Everything below that was "beta, awaiting OK" is now on `main`/prod. What this merge carried, and the traps it left behind:

- **Player writes are guarded.** `Player.rev` + `guardedPut`; every whole-record write is conditional and callers retry from a fresh read (`withPlayer` / `retryOnConflict`). Before this, production rewrote whole player records every 5 min from a snapshot taken at tick start, so an interleaving purchase silently vanished. **Never reintroduce a bare `savePlayer` from a stale read.**
- **Player goods moved OFF the world doc** onto `Player.holdings`. The world doc is ONE 400KB DynamoDB record — it was ~284KB before any player holdings, and 1,000 players × 20 items each would add ~508KB and stop the world entirely. AI-house holdings stay in the doc (bounded by the roster, needed globally each settlement). `holdingsOf()` reads record-first with a doc fallback; the production tick backfills every account and strips only ids it can PROVE are migrated. **`holdings: {}` means migrated-and-empty, not unmigrated.**
- **Two IAM grants were missing for writes the handlers already made** — Portfolio (`UpdateItem` on players, for `lastSeenAt`) and Factory (market write, for bulk supply orders). Both surfaced as a bare 500 / a misleading "the floor moved". **When a handler starts writing, check the CDK grant.**
- **Economy**: AI buyers now take delivery of what they pay for; reseller contracts clear the player's real sourcing cost (100% were unwinnable); one valuation for a firm everywhere (`/standings` was missing property + stakes); factory lines consume real floor stock.
- **501 companies** (101 brands + 400 trading houses, `scripts/generate-houses.mjs`). Houses own no catalog line on purpose — a firm costs ~115 bytes of the doc, a product ~87, so companies are the cheap axis and SKUs are not.
- **GitHub Pages auto-deploy is off.** `/[handle]` needs `dynamicParams: true`, which Next refuses to combine with `output: export`. Vercel serves prod. The workflow is dispatch-only, not deleted.

Still open: Deal Room / Order Desk card redesign; human-firm acquisition routed through the order desk (partial stakes priced + requested, 100% only by the seller's consent — AI stays as-is).

## Previous state (2026-08-11)
- **PROD (trove.ceo) shipped & stable** at merge `17f5aa9`: full bento UI, unified boards + firms/market terminology, acquisition confirmation screens, **live-player M&A** (consensual buyouts; full buyout = seller keeps the cash) + equity stakes/dividends, **Property Market** (Trove Estates), reputation + Auto-Fulfill fixes, collapsible Factory line upgrades. Post-deploy verified: real account intact, hits prod backend, AWS deploy passed the economy-invariant tests, **no DynamoDB table changes**.
- **BETA** was merged to prod on 2026-08-12 (see above). What it contained:
  - **Front-cover landing page** (`d77d7af`): signed-out visitors now see a masthead + live Ticker + premise + two CTAs ("Sign In to Trade" / "Browse the market →") before the terminal, instead of dropping straight in. Invites rather than blocks — public no-login browsing still works exactly as before, only Acquire/sell needs an account. Skipped entirely for already-signed-in players; dismissed once per browser session.
  - **AI economy: virtual consumption + the ripple multiplier** (`45de51d`..`1ab88c5`, 5 commits) — the fix for "I got rich fast and the world didn't respond." AI companies now (a) draw real material from the same shared item stock a player's factory uses, sized per-company from a "representative item" in their sector, reusing the existing recipe/tier machinery — no new per-company state, no new Lambda cost; (b) have income + trading aggression that scale (bounded, [1.0, 1.5]) with how much real players are actually doing, via a rolling EMA of real-player item-holdings footprint; (c) feed a small, clamped depletion signal into the sector-demand cascade so a scarce raw material's price pressure ripples to the finished goods made from it, not just its own price. All additive — a dormant world (no real players) behaves byte-identically to before. Full design + formulas in `specs/02_ENGINE.md`'s new "AI companies" section. 41 engine tests passing, including new invariant coverage for every piece.
  - **Player-to-player standing supply orders** (`cae1df9`..`2c2ce76`, 8 commits) — phase 1 of "make the world feel alive": a factory input can now auto-recur from a SPECIFIC other real player's storefront ("Bob's Holdings sells uranium, my factory buys it from him automatically"), not just the abstract shared market. Built entirely on top of the manual P2P trading that already existed (`handlers/orders.ts`) rather than a parallel system — settles directly against the seller's live listed price inside the production Lambda (no PvpOrder, no human accept needed, since a recurring buy at a posted price has nothing to negotiate). Sellers must explicitly opt in (`SiteConfig.autoSupply`, default off) — nobody's storefront is drained without consent. The settlement math (`packages/server/src/standingOrders.ts`) is proven in isolation with 9 fixture tests covering partial fills, no-oversell-across-buyers, and the DynamoDB 100-item transaction cap — this is also `packages/server`'s first test suite (vitest, mirroring the engine's). Full design in the plan history; the engine package itself only holds inert config (`Factory.standingSources`) — sandbox is untouched. UI: set up from the seller's storefront card (Companies), read-only display + clear on the Factory panel. Not yet verified live in a browser this session (Chrome extension disconnected mid-check) — worth a manual spot-check on beta.
  - **AI companies actually produce, then trade with each other by name** (`2e49ff3`, `1a69d70`) — phase 2 of "make the world feel alive." Part 1: `aiVirtualConsumption` now credits real output to a company's own holdings (`owners[companyName]`) instead of vanishing it, so a company's production genuinely grows its inventory/valuation over time — `traderAct`'s existing sell branch is what puts it back on the floor, no new mechanism needed. Part 2: when a company needs a recipe input, it now checks whether another AI company is that item's natural producer and buys directly from them by name (cash + goods move company-to-company, logged), falling back to the abstract floor for whatever isn't covered — reroutes some consumption to a named counterparty without changing the aggregate. Testing found the catalog had zero overlap between companies' representative items (always finished goods) and recipe inputs (always raw/part materials), so a fraction of companies now specialize in materials (`representativeItem` picks from the real cross-catalog recipe-input pool), and raw-tier reps are now themselves productive via a cash-gated extraction path — 58 real natural-producer pairs exist now. UI visibility for AI-to-AI activity is deferred to its own mockup checkpoint; `state.log` already has correct data, nothing renders it yet.
  - **"While You Were Away" recap** (`a90d3dd`) — gives the world a pulse: an inline bento card on Trending summarizing what happened since your last visit (net worth delta, production/sales flow, one relevant news headline), built entirely from data that already existed (per-player `reports[]`, the shared news archive) plus one new field (`Player.lastSeenAt`, stamped on portfolio fetch, throttled to once/5min). Only shows once at least one real 6h settlement has passed while away, so it naturally matches "check in once or twice a day" instead of firing on ordinary tab-switches. Reuses the daily-report card's `flowRows`/up-down styling rather than a parallel system. Push/email notifications and a per-player trade event log were both explicitly deferred — this is the fast, backend-light version.
  - **Deferred, separate project** (explicitly NOT started): AI releasing brand-new products over time (the catalog is a static seed today).
  - **Follow-up requested, not yet built**: a full wipe (world state + ALL player progress → fresh) on **beta only, never prod without explicit OK** — deliberately deferred until the AI economy work above has had time to be played/felt out on beta first, so it isn't wiped twice.

## The "bento" UI standard (active design system)
Apple-keynote **bento grid** of modular rounded card tiles — the "clean embedded look" Joe chose. Reusable, defined in `apps/web/app/globals.css`:
- `.bento` (12-col grid) + `.bento-card` (tile) + `.col-N` span helpers; `.bc-h` in-tile headers.
- Centering: `.view > .bento { max-width:1200px; margin:0 auto }`; `.page-col { max-width:1100px; margin:0 auto }` for non-grid pages; `.cat-wrap` (Catalog); `.desk-wrap` + `.desk-grid` (Order Desk).
- Shared tokens: `--bento-r` (16px radius), `--bento-gap`, `--paper` surface. **No per-page one-off radii** — that consistency is the whole point.
- Conversion pattern: center the view's content column → give each panel the `--paper`/`--line`/`--bento-r` tile surface → section titles as `.bc-h` → align gaps to `--bento-gap`.

### The command bar (game-style shell) — new 2026-09-02
The left rail is gone. Navigation, identity and the readouts now live in one
**command bar** across the top (`components/CommandBar.tsx`), with a thin
**bottom rail** (`components/StatusBar.tsx`) carrying the shortcut hint, the
ticker tape and the turn countdown. The reference is a management-sim HUD: a
row of coloured, fixed-position icon tiles you hit from muscle memory rather
than a list you read.

- **One list drives everything**: `lib/nav.ts` holds the 13 destinations
  (title, short tile label, icon, tone colour, group). The deck, the mobile
  drawer, the F1 sheet and the hotkey map all read from it, so a destination
  can't exist in one and be missing from another. Add a screen there, not in
  three places.
- **Layout**: screen title + firm name on the left; the tile deck (Market ·
  Your firm, split by a hairline) in the centre; cash/rank/day/clock chips and
  a settings gear on the right. The cash chip opens the firm sheet (net worth,
  cash/assets/debt, rank ladder — the old rail's `.worth` and `.ladder` markup,
  reused verbatim); the gear opens theme / account / sandbox / shortcuts.
- **Keyboard**: 1–9 then 0 jump to the first ten destinations, Esc backs out
  one layer at a time (panel → drawer → Trending), F1 opens the sheet.
  Shortcuts are suppressed while focus is in a field.
- **Responsive ladder** — the bar sheds weight in order, and the deck is never
  cut off mid-tile (verified by sweeping widths and asserting
  `scrollWidth === clientWidth`): ≤1520 drops the countdown, ≤1400 the day and
  rank, ≤1220 the tile labels (icon-only), ≤1080 the deck becomes a
  full-screen drawer off a burger, ≤640 trims the bottom rail.
- **Removed with the rail**: `Rail.tsx`, `.topbar`/`.tlabel`, the drawer +
  scrim + edge-handle machinery (`.nav-peek`, `.nav-collapse`, `.nav-menu`,
  `.rail-close`), and the orphaned `.brand`/`.clock`/`.navbadge` styles. The
  product page's own `.page-peek` handle stays. `navOpen` still exists in the
  Trove context but nothing in the shell reads it any more.

### Every screen wears the HUD (2026-09-02, same pass)
The command bar's vocabulary — a tone-coloured tile, chip readouts, controls
you press — now runs through the views themselves. All thirteen screens share
one anatomy, the Factory and the Catalog included.

- **`components/ScreenHead.tsx`** is the header every screen opens with:
  the screen's colour and glyph, its purpose line (from `lib/nav.ts`'s new
  `note` field), and its live readouts on the right as `<Stat>` chips. It
  replaced `.cat-head`/`.est-head` — a 27px serif title that just repeated
  the nav item you had clicked, followed by a hairline. Pass `tab` and the
  colour, icon, title and note all come from the one nav list; `title`
  overrides only where the screen names a thing you own (the Factory carries
  the plant's name).
- **One content column.** `--col: 1180px` replaced five different maxima
  (1100/1180/1200/1280), so switching screens no longer nudges the left edge.
  Note the trap: a `max-width` + `margin: 0 auto` on `.view` ITSELF collapses
  the screen to its content, because `.view` is a flex item of `.main` and
  auto margins eat the free space before `flex-grow` sees it. Always wrap in
  an inner `.page-col` (Estates, Deal Room, Reputation were fixed this way).
- **Shared parts** in `globals.css`: `.screenhead`/`.sh-*`, `.hud-stat`,
  `.segbar`/`.segrow`/`.segnote` (the Factory's Lines/Floor switch),
  `.hud-btn` (+ `.ghost`, `.wide`) for the pressable action, and `.hud-note`
  for a screen explaining itself (the Factory intro and the Order Desk note
  both use it). Section labels (`.desk-sec`, Trending's `.trend-sec > .bc-h`)
  run a rule out from the words.
- **Factory**: contained in the column, ScreenHead with Cash/Lines/Bays,
  tabs on the `.segbar`, line bays (`.bay`) widened to the full column with
  their running state on the leading edge. NB `.facline` and its `.fl-*`
  children were DEAD CSS (the component renders `.bay`) and were deleted —
  only `.fl-demolish` was live.
- **Catalog**: the storefront is the one screen that stays full-bleed (its
  filter rail and virtualized grid want the width), but it opens with the
  same ScreenHead — the search sits in the readout slot. The filter rail is
  a panel, and each department carries a colour from the new
  `lib/sectors.ts` (also used by the Factory's industry picker). Acquire got
  the deck's press.
- **The Wire** keeps its newspaper masthead — a paper is what the screen is —
  but the masthead now sits on the same panel every other header does.

### Bento rollout progress
- **DONE:** every screen. Trending, My Vault, Order Desk, Companies, Estates,
  Deal Room, Catalog, Reports, Goals, Reputation, Studio, The Wire, Factory.
- The Factory keeps its own line-bay treatment (upgrades collapsible via
  `<details>`), but it is contained, headed and panelled like the rest now.

## The autonomous polish loop (how we work)
Joe asked for a continuous, self-sustaining polish loop on beta. Each iteration: pick ONE focused area → improve (design/flow/logic/copy/companies) → `npm run -w @trove/web build` (green) → commit → push `beta` → verify on beta.trove.ceo with the browser tools → post a brief progress update → repeat. In Claude Code this self-schedules via wake-ups.

**Verifying a beta change (reliable method):** Vercel beta lags up to ~3 min. Wait ~90–120s, navigate the beta tab fresh with a new `?r=N`, click the target nav item **programmatically** (find the nav element by exact text and `.click()` — coordinate clicks are flaky), then confirm the NEW build is live by checking a NEW marker's computed value (e.g. a tile's `borderTopLeftRadius === "16px"`, or `.page-col` present) BEFORE screenshotting. If stale, wait ~40s and re-navigate. NB: the test browser is zoomed out (~2304 CSS px) so contained columns look gutter-heavy — that's not a bug.

## How to continue on another machine
1. `git clone` (or `git pull`), then **`git checkout beta`** — active work + the latest of this file live on `beta`.
2. `npm install`.
3. Read this `STATUS.md` + `apps/web/AGENTS.md`.
4. Continue the bento rollout (Goals, The Wire) or the next polish item, following the Working Rules above. Beta only; never merge to prod without Joe's explicit OK.

## Blocked / gotchas
- **Custom AI icons** (`scripts/gen-icons.mjs`) are **BLOCKED** — the OpenAI account is at its billing hard limit (all image calls 400). Do NOT run it until Joe raises the limit. `ItemIcon` currently uses crisp Lucide glyphs (fine).
- New catalog items appear in the live world automatically after deploy (`repo.ts` `docToWorld` rebuilds from the full catalog, overlaying stored stock/value/owners).
- Lambdas must bundle as **CJS** (`OutputFormat.CJS`) — the AWS SDK does `require("node:https")`.

## Roadmap (next big things)
- M&A (Deal Room) and Property Market: **built + live on prod**.
- **Streaming** (north star): rank/tiers/unlocks shipped (Phase 1); Phases 2–4 of the streamer roadmap pending.
- **Monetization** (later): Stripe + paid news-wheel ads. Bake in security now — card data stays in Stripe, server-verify via webhooks, harden tokens. Don't retrofit.
- **Beta full wipe (pending, not yet built)**: after playing/tuning the new AI-economy work (above) on beta, a full reset — world state AND all player progress back to fresh — so testing starts clean under the new rules. **Beta only; never touch prod without Joe's explicit OK**, same as everything else. `packages/server/src/repo.ts`'s `seedWorld()` is create-only/idempotent today (fails silently if the world already exists) — this needs a new, genuinely destructive admin operation that overwrites the world doc AND clears every `players` record. Treat it with the same care as any other irreversible production-data action.
