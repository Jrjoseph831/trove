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
- Suggested invariant tests: unique item ids; editions have `remaining ≤ edition`;
  no wealth created from nothing (only trading P/L + appreciation move totals);
  fast-restock items' price variance ≪ slow-restock items' under the same demand.
