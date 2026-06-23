# 01 — Overview

## What VAULT is
A real-time, **shared-world** market game. Every player trades in the same economy
against the same prices and the same AI traders. The assets are **physical things** —
fasteners, steel, cable, tires, gloves, forklifts, excavators, watches, 1-of-1
collectibles — not stock tickers. Prices move on a **news-driven sector economy**:
fictional headlines shift sector demand, demand cascades to the items in those
sectors, and supply scarcity firms prices further.

The feeling target: an **auction-house / dealing-room terminal** with a collector's
soul. Dopamine from reading the room, spotting a move, and owning the rare thing —
not from staring at candlestick charts.

## The core loop
1. The **front page turns** (every 12h of real time = one "cycle"). A new story
   lands. It reads as journalism — e.g. *"Atlas Freight unveils 40-hub national
   network"* — and **never says what to buy**.
2. The player **infers**: a new logistics giant → they'll need handling equipment →
   forklifts, pallets, drones may rise. They act, or wait.
3. Under the hood the story moved **sector demand** (hidden). AI traders read the
   hidden signal and trade accordingly, so the floor moves *in agreement with the
   story* without anything being announced.
4. Prices **settle once per cycle** with an overnight gap; intraday is gentle drift.
   Real-world cadence, not minute-to-minute whiplash.
5. Player buys/sells, watches net worth move, climbs the leaderboard.

## Why it's not "just a stock sim"
Honest framing: mechanically it *is* a market. What differentiates it, in order of
strength:
- **Physical assets, not tickers.** You own forklifts and ingots.
- **News-as-story you interpret**, never data that tells you the move.
- **Owned editions / 1-of-1s** — a collector layer stocks can't have. You can own
  *the only one*, and it vanishes from the floor when claimed.
- **Anti-finance presentation** — a newspaper masthead, a brass ticker, a vault.
- **Two planned phases stocks can't do:** Factories (you *produce* supply and affect
  everyone's prices) and Public Vaults (your vault becomes a tradeable asset other
  players buy into). These are what make it defensible long-term.

The uniqueness is the *combination + tone*: commodity market + collector scarcity +
interpret-the-news + dopamine-first skin. Pre-phases it's already a differentiated,
shippable product; the phases make it undeniable.

## Modes
- **Live Market** — the real shared world. Fixed global clock, no fast-forward.
- **Sandbox** — a private, separate world with a fast clock + warp controls, for
  tuning the economy. Must never bleed into Live. (Prototype demonstrates both.)

## Player starting state
- Starting cash (prototype uses $25,000).
- Empty vault.
- A credit line: borrow up to 50% of asset value, interest accrues per cycle.
- Net worth = cash + asset value − debt.

## Glossary
- **Cycle** — one game-day (12h real time at 1×). Prices settle at cycle rollover.
- **Sector** — a demand group (Construction, Logistics, …). News moves sectors.
- **Edition** — a finite collectible (run of 1–12). Vanishes when fully claimed.
- **Open item** — unlimited-supply commodity; you trade the price, not the unit.
- **Intrinsic value / IV** — real worth of holdings (matters in Public Vaults phase).
