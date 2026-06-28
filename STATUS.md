# TROVE — Status & Handoff

_Last updated: 2026-06-28. This file travels with the repo — read it first to pick up where we left off (especially on a fresh machine, where local Claude "memory" does NOT exist)._

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

## Current state (2026-06-28)
- **PROD (trove.ceo) shipped & stable** at merge `17f5aa9`: full bento UI, unified boards + firms/market terminology, acquisition confirmation screens, **live-player M&A** (consensual buyouts; full buyout = seller keeps the cash) + equity stakes/dividends, **Property Market** (Trove Estates), reputation + Auto-Fulfill fixes, collapsible Factory line upgrades. Post-deploy verified: real account intact, hits prod backend, AWS deploy passed the economy-invariant tests, **no DynamoDB table changes**.
- **BETA** is ~1 commit ahead of prod (Reports → bento) and is the active branch. Not merged (awaiting OK).

## The "bento" UI standard (active design system)
Apple-keynote **bento grid** of modular rounded card tiles — the "clean embedded look" Joe chose. Reusable, defined in `apps/web/app/globals.css`:
- `.bento` (12-col grid) + `.bento-card` (tile) + `.col-N` span helpers; `.bc-h` in-tile headers.
- Centering: `.view > .bento { max-width:1200px; margin:0 auto }`; `.page-col { max-width:1100px; margin:0 auto }` for non-grid pages; `.cat-wrap` (Catalog); `.desk-wrap` + `.desk-grid` (Order Desk).
- Shared tokens: `--bento-r` (16px radius), `--bento-gap`, `--paper` surface. **No per-page one-off radii** — that consistency is the whole point.
- Conversion pattern: center the view's content column → give each panel the `--paper`/`--line`/`--bento-r` tile surface → section titles as `.bc-h` → align gaps to `--bento-gap`.

### Bento rollout progress
- **DONE:** Trending, My Vault, Order Desk, Companies, Estates, Deal Room, Catalog, Reports.
- **REMAINING:** Goals (`Goals.tsx`), The Wire (`Wire.tsx`). (Factory has its own treatment; its line upgrades are collapsible via `<details>`.)

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
