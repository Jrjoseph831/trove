# VAULT — Build Handoff Package

A real-time, shared-world market game where players hold **physical assets**
(everything from toothpicks to excavators to 1-of-1 collectibles) whose prices move
on a news-driven economy. Not a stock app — an auction-house / dealing-room terminal
with a collector's soul. Players read fictional news, infer what's heating up, and
trade. AI traders keep the floor alive. Long-term, players build factories and even
go public (their vault becomes tradeable).

This package is everything needed to build it. Read the docs in `specs/` in order.

---

## What's here

```
VAULT-handoff/
├── README.md                  ← you are here
├── specs/
│   ├── 01_OVERVIEW.md         vision, core loop, what makes it not-a-stock-sim
│   ├── 02_ENGINE.md           the economic engine: math, cadence, AI, editions
│   ├── 03_DATA_SCHEMA.md      how the JSON data is shaped and plugs in
│   ├── 04_AWS_ARCHITECTURE.md production stack: clock, settlement, conditional writes
│   ├── 05_UI_SPEC.md          the tabbed terminal: Trending/Catalog/Wire/Vault
│   ├── PHASE_public-vaults.md player IPOs (specced, build last)
│   └── PHASE_factory.md       players become suppliers (specced, build after core)
├── data/
│   ├── sectors.json           12 demand groups
│   ├── brands.json            76 invented brands (the brand bible)
│   ├── taxonomy.json          sector→category→sub→leaf tree
│   ├── items.json             ~1,450 items (THE CATALOG)
│   ├── news.json              69 news scenarios (hidden effects, never states advice)
│   ├── stats.json             summary counts
│   ├── generate_economy.py    regenerate/expand the catalog from rules
│   └── generate_news.py       regenerate/expand the news bank
└── prototype/
    └── vault-terminal.html    working single-file prototype (engine + UI + data slice)
```

## Build order (recommended)
1. **Read `specs/01`–`05`.** The prototype implements all of it already in JS;
   the specs explain *why* and how to productionize.
2. **Stand up the engine** (`02`) as a portable module — it's already DOM-free in
   the prototype. Port to a Lambda.
3. **Load the data** (`03`) — swap the prototype's inline data slice for the full
   `data/*.json`. ~1,450 items, 76 brands, 69 news scenarios.
4. **Wire the AWS backbone** (`04`) — global clock (EventBridge), settlement Lambda,
   DynamoDB with conditional writes for editioned scarcity.
5. **Build the UI** (`05`) against the prototype as reference.
6. **Then phases:** Factory, then Public Vaults (both specced, both build *after*
   the core economy is stable).

## The prototype is the source of truth for behavior
`prototype/vault-terminal.html` is a complete, runnable implementation of the core
loop (with a small data slice, not the full catalog). When a spec and the prototype
disagree on a detail, the prototype's *behavior* is what we tuned and liked — match
the feel, improve the implementation. The full `data/` files replace the prototype's
inline `SECTORS`/`ITEMDEFS`/`NEWSBANK`.

## Non-negotiables (design directives from the owner)
- **News never states a recommendation and never mentions AI.** Stories are
  journalism; the player infers; effects are hidden. Enforced in `generate_news.py`.
- **One global clock.** No player can fast-forward the shared market. (A separate
  sandbox mode with a fast clock exists for tuning only.)
- **Editioned items are finite and VANISH when claimed** (reappear only on resale).
  The exact edition number is revealed *after* purchase (the collector's reveal),
  never shown as a stock counter on the floor.
- **Integrity & anti-harassment beat thrill.** Especially in the Public Vaults
  phase — see that spec.
- **Zero runtime AI for news.** The news bank is pre-generated; code sequences it.
