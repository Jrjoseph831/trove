# 04 — AWS Architecture

The prototype runs entirely client-side for tuning. Production must enforce **one
shared, server-owned world**. This is the reference architecture; adapt as needed,
but the load-bearing pieces (global clock, conditional writes for editions, hidden
news effects) are non-negotiable.

## Components
```
EventBridge (cron, every cycle)  ──▶  Settlement Lambda  ──▶  DynamoDB
                                          │
Player ──▶ API Gateway ──▶ Trade Lambda ──┤ (reads/writes shared state)
                                          │
                                   (optional) AI Trader Lambda (Poisson, scheduled jitter)
```

## The global clock — the core integrity guarantee
- **One cycle = 12 real hours.** An **EventBridge** schedule triggers the
  **Settlement Lambda** at each cycle boundary (or sub-cycle for the gentle intraday
  drift, if you want smoother prices — but settlement/news only at the boundary).
- No client input can advance the clock. The server owns `cycle` and `cycleFrac`.
- Sandbox mode (fast clock) is a **separate** environment/table namespace or a local
  client-only mode — it must never touch Live state.

## Settlement Lambda (runs the engine's `settleCycle`)
Each cycle:
1. Decay/expire `active` news; pick the next scenario from `news.json` by `weight`
   (avoid immediate repeat); set `front`; append `archive`.
2. Recompute every `sectorIdx` from active effects (eased toward target).
3. Restock open items toward `stockNormal`; reprice all items (`priceItem`).
4. Persist sector indices, item prices, front/archive, and append to net-worth
   history snapshots.
This is the exact engine logic from spec 02, server-side.

## DynamoDB tables
- **`items`** (PK `id`): seeded from `items.json`. Mutable fields per cycle: `value`,
  `prevValue`, `stock`, `remaining`. Static: `base, weights, edition, elaborate, ...`.
- **`ownership`** (PK `playerId`, SK `itemId`): qty held + `buyAt` + edition copy#s.
- **`players`** (PK `playerId`): `cash, debt, netWorthHist, ...`.
- **`sectors`** (PK `sectorKey`): current demand index + active-effect accumulators.
- **`market`** (singleton): `cycle, cycleFrac, front, archive`.
- **`news`**: reference data from `news.json` (or ship as a static asset).
- **`brands`**: reference data (rarely changes).

## Editioned scarcity — conditional writes (critical)
Two players must never claim the last copy. The buy path for an edition:
```
UpdateItem items[id]
  SET remaining = remaining - 1
  ConditionExpression: remaining > 0
```
If the condition fails, the copy is gone — return "claimed" to the loser. Same idea
for open items if you want hard stock limits (`stock > 0`). This is why finite supply
is modeled as a real counter, not a cosmetic flag — and it's the seed the **Factory
phase** writes into.

## Trade Lambda (player buy/sell)
- Validates funds/stock, applies the conditional write, updates `ownership` and
  `players.cash`, adds buy-pressure (optional immediate nudge; main moves are at
  settlement), writes to the activity log.
- Returns the reveal payload for editions (copy number).

## AI traders in production
- A scheduled Lambda with **jittered** invocation (or a Poisson draw inside one
  scheduled run) executes trader actions so the floor moves between human trades.
- Traders read sector indices (the hidden signal), never news text. Keep their logic
  identical to the prototype's `traderAct`.

## News effects stay server-side
`effects` are never sent to the client. The client receives only `head/body/kick`
and observes prices/sectors moving. This preserves the "infer, don't be told"
design and the "never mention AI" rule.

## Cost / token note
- **Zero runtime AI.** News is pre-generated (`news.json`); the model's only job was
  authoring it once. No LLM calls in the hot path. This was an explicit owner
  requirement to control token spend.

## Phasing on AWS
- Core economy first (above).
- **Factory phase** adds a `factories` table and lets player production modify
  `restock`/`stockNormal` of target items (see PHASE_factory.md). Conditional writes
  and the settlement loop already accommodate this.
- **Public Vaults phase** adds `listings`/`shares` tables and a share-trade Lambda
  with circuit breakers; intrinsic value reuses the net-worth computation
  (see PHASE_public-vaults.md). Build last.
