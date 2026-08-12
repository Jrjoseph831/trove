# 02 — The Engine

The engine is pure logic, DOM-free, and already implemented in
`prototype/vault-terminal.html` (the block between `░░ DATA LAYER ░░` and
`░░ VIEW LAYER ░░`). This doc explains the model so it can be ported to a Lambda
and trusted. **Match the prototype's behavior; improve the implementation.**

## State shape (per world)
```
cycle, cycleFrac            // time. cycleFrac 0..1 within a cycle
cash, debt, rate            // player wallet; rate = interest per cycle (0.0005)
items[]                     // see Data Schema; runtime adds stock, remaining, owners, value, prevValue, myCopies, buyAt
sectorIdx{sector:float}     // demand index per sector, 1.0 = normal
active[]                    // [{news, cyclesLeft}] stories currently influencing demand
front                       // current front-page story
archive[]                   // past headlines
traders[]                   // AI: {name, cash, bias, next}  (next = Poisson countdown)
log[]                       // recent floor activity
nwHist[]                    // net-worth history for the chart
playerActivityEma           // rolling EMA of real players' item-holdings footprint (see below)
```

## Time & cadence — the most important part
- **1 cycle = 1 game-day = 12 real hours at 1× speed.** (`SEC_PER_CYCLE = 43200`.)
- Prices **settle once per cycle** (`settleCycle`) with a real overnight gap.
  Intraday, `advance(dt)` only applies tiny noise — the market *breathes* but does
  not lurch. This is the "real-world cadence, not whiplash" requirement.
- **Global & server-owned in production.** No client may advance time. Sandbox uses
  warp/jump locally; Live never does.

## Sector → item cascade (the heart)
1. **News moves sectors.** Each active story contributes its `effects[sector]` to a
   target index, decaying as `cyclesLeft/dur`. Sector index eases toward the summed
   target: `sectorIdx[s] += (target - sectorIdx[s]) * 0.55 + small noise`.
2. **Item demand = weighted blend of its sectors:**
   `itemDemand = Σ(sectorIdx[s] * weights[s]) / Σ(weights[s])`.
   Cross-sector items (steel in construction+automotive+energy) blend all three, so
   ripples are realistic.
3. **Price:**
   ```
   elasticity = edition ? 1.4 : 0.5 + min(1.2, 1200/(restock+40))   // low restock ⇒ swingy
   target = base * (1 + (itemDemand - 1) * elasticity) * scarcity
   value  = max(base*0.25, target)
   ```
4. **Scarcity** (`scarcity(it)`):
   - Open item: `clamp(0.7, 2.2, 1 + (1 - stock/stockNormal) * 0.8)` — depleted
     stock firms price; abundant stock softens it.
   - Edition: `1 + (claimed/edition) * 0.6` — firms as the run sells out.

**Net effect (validated):** toothpicks (huge stock, fast restock) barely move even
in a boom; excavators (tiny stock, no restock) swing hard and can go scarce. This is
the supply spine and it's baked into the data.

## Supply / restock
- Each cycle, open items restock toward `stockNormal`: `stock = min(stockNormal,
  stock + restock)`. Editions never restock (`restock = 0`).
- Buying (player or AI) decrements `stock` (open) or `remaining` (edition).
- Selling returns a unit to `stock`/`remaining`.

## Editions (the collectibles)
- `edition = N` means a finite run of N. `remaining` counts copies still claimable.
- When `remaining` hits 0 the item **vanishes from the floor entirely** (no ghost,
  no "spoken for"). It returns only if an owner sells.
- **No counter is ever shown on the floor.** Editioned items get a subtle glow +
  glint + a quiet word ("Limited" / "1 of 1"). The exact copy number is revealed
  **after** purchase (`showReveal`), and stored in `myCopies` so the vault can show
  "#2 of 3" as a flex.
- Production: `remaining` decrement must be a DynamoDB conditional write
  (`ConditionExpression: remaining > 0`) so two players can't grab the last copy.

## AI traders (keep the floor alive without breaking it)
- Each trader fires on a **Poisson schedule** (`next -= dt; while next<=0 act; next
  += rexp(mean)`), averaging ~1 action/cycle. No rhythmic pumping.
- On action: ~30% chance to sell a holding; otherwise buy. Buy choice is weighted by
  `(itemDemand-1)*3` (chase rising sectors) + brand-home-sector match + edition bonus
  + noise. **Traders read the hidden sector signal, not the news text** — which is
  exactly why their behavior lines up with the story without it being scripted.
- Traders have budgets and biases; they provide liquidity and price pressure.

## AI companies: virtual consumption + the ripple multiplier (aiEconomy.ts)
Two extensions on top of the base trader model, both in `packages/engine/src/aiEconomy.ts`
and re-exported from the package root. Together they fix a world that stayed
static while a real player got rich: AI income was flat, and AI never
competed for the materials a player's factory consumed.

### The ripple multiplier — AI scales with real-player activity
```
footprint = Σ qty×value over every item owner that ISN'T an AI trader name
playerActivityEma += (footprint - playerActivityEma) * 0.15   // ~1–2 day EMA
ripple = clamp(1.0, 1.5, 1 + 0.18 * log10(1 + playerActivityEma / 150_000))
```
`ripple` is exactly **1.0** on a dormant world (no real-player footprint yet) —
byte-identical to the pre-ripple flat behavior — and rises smoothly toward
**1.5**, never beyond it. It measures goods on the floor (production/buying),
not idle cash sitting in a wallet. It plugs into three places:
- `accrueIncome()`: `t.cash += incomeOf(t) * ripple`.
- `traderAct()`'s chase-rising-demand weight: `(itemDemand-1) * 3 * ripple`.
- AI virtual consumption's appetite sizing (below).

**Call-order constraint:** `updatePlayerActivity(state)` runs as the very
FIRST line of `settleCycle`, before step 0 (`accrueIncome`) — so this cycle's
income accrual already reflects the freshly refreshed EMA. Get this wrong and
income lags the EMA by a full cycle.

### AI virtual material consumption — no new Factory objects
Every AI company with a sector `bias` (not `Open_Index`, the broad-index
anchor) notionally runs a virtual production line for a **representative
item** in its sector — GOODS tier preferred, PART/RAW fallback for sectors
with no GOODS-tier inventory (`consumer`, `textiles`). Picked from the ~5
priciest producible items in that bucket, varied per company by a
deterministic name hash (same FNV-1a pattern `companies.ts` uses for
`tierFor`) — many companies in one sector still converge on the same
underlying raw material via that item's own `recipeOf()`, which is what makes
the shared-scarcity competition real.

Sizing reuses `effectiveSpec(repItem, []).rate` (the exact rate a *player*
factory for that item would run at) × `AI_APPETITE_MUL[tier]` (in
`packages/data/src/companies.ts`, next to `COMPANY_TIERS`) × `ripple`. It
draws real inputs from `recipeOf(repItem).inputs` against the SAME
`items[].stock` a player factory buys from — genuine competition, both
directions. **Nothing is credited to the company's holdings**: cash leaves for
the input spend with no counterparty, mirroring how a player factory's
market-sourced inputs already work in `produceFactories()` — this keeps
`companyValuation`/Deal Room equity math untouched.

A starved company degrades gracefully (unlike a player factory's binary
`idle`): every input in the recipe scales down TOGETHER by one fill factor
(preserving the recipe's ratios — never all the steel and none of the
fasteners), bounded so cash never drops below the company's tier reserve.

**The per-item cycle draw cap.** A material many companies converge on as a
primary input (steel is the reference case — the `primaryMaterial` for most
expensive GOODS across construction/automotive/energy) can see combined AI
appetite vastly exceed its restock rate. Without a cap this pins the item at
0 stock forever with no recovery — a dead floor, not a rising-and-falling
market. `aiVirtualConsumption()` tracks, per item, how much its stock was at
the START of the current pass, and caps how much ALL companies combined may
draw from it this cycle to `MAX_ITEM_DRAW_FRAC` (0.35) of that starting
stock — self-limiting regardless of how many companies happen to share an
input, so it doesn't need re-tuning as the catalog or roster grow.

Runs in `settleCycle` as step **4b**, after step 4 (restock + reprice) and
before step 5 (`produceFactories`) — this cycle's AI depletion lags into
*next* cycle's `scarcity()`, exactly like player factories already behave;
the player's factory then competes against whatever AI left behind.

### Feeding depletion into the sector cascade
`priceItem()` only ever reads an item's OWN stock — a scarce raw material's
own price firms, but nothing made FROM it moves at all from that alone. So
step 3's sector-index recompute also folds in a small, hard-clamped
consumption-pressure term:
```
depletion(sector) = weighted average of (1 - stock/stockNormal) across that
                     sector's open items, weighted by each item's own weight
ripple-into-target = clamp(-0.05, 0.05, depletion * 0.08)
```
added into `target` alongside summed news effects, before the existing ease
(`sectorIdx += (target-cur)*0.55 + noise`). Because raw materials and the
finished goods that consume them typically share sector weights, a
sector-wide depletion pressure lifts demand — and price — for both the input
and everything else in that sector, using the demand cascade that already
exists. Kept deliberately small (±0.05, vs. typical news effects) so **news
remains the dominant, primary driver of sentiment** — this reads as a
secondary hum underneath it, not a competing narrative. If it ever feels too
strong or too subtle in play, the two constants above
(`SECTOR_PRESSURE_CLAMP`, `SECTOR_PRESSURE_SCALE`) are the single knob —
no structural change needed.

### Hard constraint: no new `rand()` calls
Nothing in `aiEconomy.ts` may call `rand()` from `./rng`. Every random draw
consumed anywhere in `settleCycle` shifts the sequence for everything that
runs after it in the same cycle — a new draw here would silently change every
existing test's concrete values. Where variety is genuinely needed (which
representative item a company gets), use the deterministic FNV-1a hash
pattern instead, same as `companies.ts`'s `tierFor`.

## News sequencing (zero runtime AI)
- The pre-generated `news.json` bank is sequenced by code at each `settleCycle`:
  pick a scenario (respect `weight`; avoid immediate repeat), set it as `front`,
  push to `archive`, and if it has effects add `{news, cyclesLeft:dur}` to `active`.
- Stories decay over `dur` cycles, so effects build and fade naturally; two can
  overlap. **Never** generate news with a live model at runtime.

## Debt
- `creditLimit = floor(assetsValue * 0.5)`. Borrow up to limit; `cash += a; debt += a`.
- Interest accrues continuously: `debt *= 1 + rate*dt`.
- Repay reduces both. Net worth subtracts debt.

## Determinism & testing
- The data generators are seeded; the engine uses RNG only for noise/Poisson.
- `aiEconomy.ts` is a hard exception even to that: no `rand()` calls at all (see above).
- Suggested invariant tests: unique item ids; editions have `remaining ≤ edition`;
  no wealth created from nothing (only trading P/L + appreciation move totals);
  fast-restock items' price variance ≪ slow-restock items' under the same demand;
  the ripple multiplier is exactly 1.0 on a dormant world and never exceeds 1.5;
  AI virtual consumption never drops a company below its tier reserve or an
  item's stock below 0, and preserves a recipe's input ratios when starved.
