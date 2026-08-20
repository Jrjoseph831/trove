# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two co-equal primary audiences:

**The streamer** — builds a live economic empire in front of an audience. The session IS a broadcast; every decision, price swing, and milestone is content. Session length: 3h+. Judges the product by watchability and clip-worthy drama.

**The solo empire-builder** — plays for personal satisfaction: compounding net worth, optimizing factories, reading the market, watching rivals rise and fall on the leaderboard. Session shape: occasional deep sessions and frequent 10–15 min check-ins (factory management + market scan).

Secondary acquisition path: viewers pulled in by watching a TROVE stream who sign up mid-broadcast. First-session hook and onboarding speed matter for this audience.

## Product Purpose

TROVE is a real-time shared-world market simulation game for fictional physical goods. Players build economic empires — trading on the market, running factories, filling bulk orders, acquiring other firms — inside a live economy where a pre-generated news engine drives sector prices and hundreds of AI companies act as real economic counterparties.

Success looks like: 3h+ live streaming sessions that are watchable, dramatic, and clip-worthy; a leaderboard that creates genuine competitive tension; and a market that fights back so no empire feels inevitable.

## Positioning

The combination of a shared singleton economy (one buy/sell changes prices for everyone), total firm transparency (every company's full balance sheet is public), and a news-driven demand engine that operates on its own logic — not the player's — makes TROVE feel like a Bloomberg terminal crossed with a sandbox empire game where the market is an adversary, not a backdrop.

No individual player commands the economy. That distinction — structural market resistance, not just difficulty tuning — is what no neighboring product can truthfully copy.

## Operating Context

- Live web game at **trove.ceo**; no mobile app; mobile web is incidental
- Sign-in via Google or email (AWS Cognito); named holding = the player's firm
- Real market ticks every **6 hours** (00/06/12/18 UTC); factory production every **5 minutes**
- All firms — human and AI — appear in a public leaderboard with full balance sheet transparency
- **News engine**: 202+ pre-generated sector stories; no runtime AI anywhere in the product
- 1,753 catalog items, 100+ brands, 500+ AI trading houses; shared singleton DynamoDB world document
- Trade, M&A, standing supply orders, Order Desk negotiation, and multiplayer P2P deals are live
- Active beta at **beta.trove.ceo** (staging world, team-only via Vercel protection); prod is trove.ceo

## Capabilities and Constraints

**Hard constraints:**
- Zero runtime AI — all news pre-generated; no OpenAI calls at request time
- Shared singleton world document (DynamoDB, 400 KB ceiling) — adding entities has a real per-byte cost
- Beta branch only; merge to prod requires explicit user sign-off
- Dev tools (fund/reset/summon-buyout) are staging-only — never visible in prod
- AWS IAM/OIDC/bootstrap is run by the user in CloudShell; Claude does not attempt it

**Live mechanics:**
- Editions (limited-run items) and scarcity are core game mechanics — remaining stock is hidden until claimed
- All firms are fully transparent: net worth, cash, and top holdings are public for everyone
- Factory upkeep is real: a mothballed line stops billing but must be deliberately restarted
- Player goods live on `Player.holdings` (not the world doc); guarded writes with `rev` CAS prevent silent overwrites

**Terminology rules:**
- "market" not "floor"; "firms" not "houses"; "floor" only for the literal manufacturing floor
- Never surface "AI" to players — firms feel real whether human or algorithmic
- "Trove day" = 12 real hours (2 settlements); use in-game calendar, not real dates

## Brand Commitments

- **Name**: TROVE. **Domain**: trove.ceo
- **Design bar**: senior Apple designer restraint — clean, editorial, premium
- **Visual system**: bento grid tile system across all pages (`.bento` / `.bento-card` / `.col-N`); `--bento-r` 16px radius; `--bento-gap` spacing; consistent `.bc-h` tile headers
- **Palette**: paper background (`--paper`), ink hairline rules (`--line`), serif numerals, bronze = rising, steel = cooling; no neon, no dark auction-house skin
- **Copy voice**: dry financial terminal register with moments of theater in news and market events; not casual, not gamey; TNN (Trove News Network) sets the in-world editorial tone
- **Icon system**: lucide-react line icons mapped by subcategory (no emoji in UI)
- **Streaming-first rule**: every feature is judged by "does this make a better stream?"

## Evidence on Hand

- Live prod game at trove.ceo with real player accounts (G&H Holdings, ~$62M net worth at last check)
- 1,753-item catalog, 100 brands, 500+ trading companies, 202 pre-generated news stories, 12 sector backdrop photos
- Fully deployed stack: Vercel (web), AWS Lambda + DynamoDB + EventBridge + Cognito + CDK v2, GitHub OIDC deploy
- Engine test suite: 41+ vitest invariants covering economy accounting, company solvency, and production correctness
- Beta branch active with ongoing bento UI rollout; Goals and The Wire pages remaining

No invented testimonials, benchmarks, or player counts. Do not fabricate these.

## Product Principles

1. **The market fights back.** No single player should feel invincible. Structural pushback — news, AI economy, heat, scarcity — is more interesting than difficulty sliders.
2. **Drama is the deliverable.** Every price swing, bust, rank-up, and market event should be watchable and clip-worthy. If it doesn't read on a stream, it doesn't ship.
3. **Optimization is a multiplier, never a gate.** Advanced mechanics (factory sourcing, skill trees, supply chains) deepen experienced players without blocking newcomers. Auto-defaults work; manual control is the reward.
4. **Total transparency, genuine competition.** Every firm's balance sheet is public. Tension comes from knowing exactly where you stand — not from hidden information.
5. **Complexity ships invisibly.** The deepest mechanics surface only when the player reaches for them. Nothing is cryptic at first glance; everything rewards mastery.
