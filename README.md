# TROVE

A real-time, shared-world market game. Every player trades inside **one** live
economy — the same prices, the same stock, the same news, moving whether you're
watching or not. You hold physical goods rather than tickers: pallets of bolts,
excavators, CT scanners, one-of-one timepieces. You read the news, work out what
is about to get scarce, and get there first.

**Live at [trove.ceo](https://trove.ceo).**

---

## What's in the world

| | |
|---|---|
| Goods in the catalogue | 1,866 |
| Brands that make them | 100 |
| Firms trading against you | 501 |
| Real-estate assets | 54 |
| News scenarios | 202 |
| Demand sectors | 12 |

The market settles every 6 hours; production lines run every 5 minutes. A
scheduled newsroom writes original company stories — a named house, a sector, a
real event — which run on **The Wire** and move the sectors they touch.

## The loop

1. **Trade the floor.** Prices move on real demand and breaking news. Buy ahead
   of a story, sell into it.
2. **Build.** Stand up production lines, buy the inputs or feed them from your
   own lines, and sell what you make under your own manufacturing name.
3. **Take contracts.** The Order Desk brings buyers to you. Counter their offers
   when the numbers don't work.
4. **Deal.** Buy stakes in other firms through the Deal Room, or buy one
   outright if it will sell.
5. **Hold assets.** Estates pay rent and appreciate.
6. **Climb.** Rank is set by peak net worth, and it governs what you can build.

## Repository

npm workspaces monorepo.

```
apps/web         Next.js app — the terminal, catalogue, item and company pages
packages/engine  the economy: pricing, production, settlement, firm behaviour
packages/data    the catalogue, brands, firms, properties, news, newsroom
packages/server  Lambda handlers and the DynamoDB layer
infra            AWS CDK stack
specs/           design and engine specifications
```

**The engine is pure and deterministic.** It has no DOM and no I/O, runs
identically in the browser sandbox and in a Lambda, and every random draw goes
through one seeded generator — so the same seed replays the same world. That
property is what makes a shared world testable, and it is covered by 77 tests.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine + server suites
npm run typecheck
npm run build
```

The web app runs standalone against a local sandbox world, so no AWS account or
credentials are needed to develop against it.

## Architecture

The browser holds a full copy of the engine and simulates locally so the
interface stays responsive, while the server owns the truth: prices, stock,
treasuries and every player's holdings. Writes are guarded by conditional
updates on a revision number, so two players acting on the same item at the same
moment cannot overwrite one another.

- **Web** — Next.js on Vercel
- **API** — API Gateway + Lambda
- **State** — DynamoDB, conditional writes for editioned scarcity
- **Clock** — scheduled settlement on the 6-hour marks, production on its own
  faster beat
- **Infrastructure** — AWS CDK, deployed from CI

## Design

Editorial rather than arcade: paper, hairline rules, serif headlines, one warm
accent, and figures that line up. Depth comes from light and material — no stock
photography, and each product's plate is derived from its own id so no two look
alike. The interface has to hold up on a stream for hours, which means readable
at a distance and calm when nothing is happening.

## House rules

These are enforced in the data and the engine, not left to taste.

- **News is journalism, never advice.** Stories report; the player infers.
  Effects on demand are hidden and never printed.
- **One global clock.** Nobody can fast-forward the shared market. The fast
  sandbox clock is a local tuning tool and never touches the live world.
- **Editioned goods are finite** and disappear when claimed, returning only on
  resale. The edition number is revealed after purchase rather than shown as a
  counter on the shelf.
- **Ownership changes hands only by consent.** A firm is bought when its owner
  agrees to sell.

## Status

Live and playable. The market, catalogue, Wire, Factory, Order Desk, Deal Room,
Estates, Reports and the rank ladder are all in. Current work is continuous
polish rather than new systems.

## Licence

All rights reserved. The code and the catalogue are not licensed for reuse.
