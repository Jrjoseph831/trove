# PHASE — Factories (players become suppliers)

**Status:** Specced, not built. Build **after** the core economy is stable, **before
or alongside** Public Vaults. This is the phase that makes VAULT more than a trading
sim — players stop only *consuming* the economy and start *supplying* it.

**One-line:** A player can build a factory that **produces** specific items, adding to
their supply on the floor. Producing the right thing when a sector is hot is a second,
deeper way to make money — and it ties players into the economy as actors who affect
everyone's prices.

## Why it fits the existing model
Supply is already a real modeled quantity: every open item has `stockNormal` and
`restock` (units returned per cycle). A factory simply lets a *player* contribute to
the effective supply of an item — i.e., the player becomes a source of `restock`.
Nothing about the core engine needs to be rethought; factories plug into the spine
that already exists.

## Core mechanic
- A player builds a **factory line** for a chosen item (or item family). The factory
  has a **production rate** (units/cycle) and **running costs** (upkeep, inputs).
- Each cycle the factory produces units that the player can **sell into the floor**
  at the current market price.
- **Producing into a hot sector = profit.** If construction is booming and you run a
  rebar line, you sell into rising demand. If you over-produce a cold item, you eat
  upkeep for little return. Reading the news now drives *production* decisions, not
  just trades.

## Realism hooks already in the data
- `archetype` tells you what's cheap-and-fast vs expensive-and-slow to make. A
  toothpick line is cheap to build and spits huge volume; an excavator line is
  expensive, slow, low-volume. Use the archetype to set build cost + max rate.
- `weights` (sector mapping) means a factory's fortunes rise/fall with the same
  news the trading floor reads.

## Supply-chain depth (optional, strong)
The taxonomy supports a real chain: making tires needs the **Rubber Compound Bale**;
making a vehicle needs parts; etc. A richer factory phase could require **input
items** to produce **output items**, turning the catalog into a production graph.
Start simple (produce one item from cash + upkeep); layer inputs later.

## Market-integrity guards
Factories can move real prices, so guard against degenerate strategies:
- **Production caps** per factory and per player, scaled by archetype.
- **Diminishing returns / price impact:** dumping large volume into the floor pushes
  that item's effective supply up, softening its price (the scarcity term already
  does this — selling restores `stock`, which lowers `scarcity`). So flooding a
  market self-corrects: you crater the price you were selling into.
- **Upkeep** so idle/oversized factories bleed cash — no free money printer.
- **Build time / cooldown** so you can't instantly pivot a factory to whatever's hot
  this cycle (rewards anticipation, like the rest of the game).

## AWS mapping
- New **`factories`** table (PK `playerId`, SK `factoryId`): `targetItemId, rate,
  upkeep, builtAt, inputs[]`.
- Settlement Lambda gains a production step: for each factory, produce units →
  credit player inventory (or auto-list), debit upkeep. Producing adds to the target
  item's effective supply via the same `stock`/conditional-write path used today.
- Price impact is automatic through the existing `scarcity` term — no new pricing
  math required.

## Open questions for build time
- Auto-sell production at market vs. let players hold/time it (timing is more
  game-y).
- Whether to require input items (production graph) in v1 or layer it later.
- Build cost / rate / upkeep curves per archetype — needs sandbox tuning, same as
  the trading economy.
- Whether factory output is visible to other players as "supplied by [player]"
  (social hook; ties into Public Vaults reputation).

## Sequencing
Core economy → **Factory** → Public Vaults. Factory is specced as the
"you affect the world" phase; Public Vaults is the "you become an asset" phase. They
reinforce each other (a player known for running profitable factories is a more
attractive public vault), but each stands alone.
