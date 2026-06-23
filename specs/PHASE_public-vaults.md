# VAULT — Phase Spec: Public Vaults (Player IPOs)

**Status:** Specced, not built. Scheduled as a major phase AFTER the data package
(brand bible + item catalog + news bank) and AFTER core economy is live.

**One-line:** A player's vault can "go public," at which point other players can buy
and sell **shares** in that player. This turns players into tradeable assets and is
the feature that pushes VAULT from "themed market sim" toward "social network you
trade on." It is also the highest-risk system in the project. **Integrity and
anti-harassment come before thrill — this is an explicit design directive.**

---

## 1. Core model — two numbers, never one

The single most important rule. Every public player has TWO separate values:

1. **Intrinsic Value (IV)** — the real, earned worth of their holdings.
   `IV = cash + Σ(asset value) − debt`. This is computed exactly as net worth is
   computed today. **Nothing another player does can change someone's IV.** Buying
   shares does NOT inflate IV. This anchor is the anti-Ponzi spine of the system.

2. **Share Price (SP)** — what the crowd pays for a claim on that player.
   SP floats on supply/demand for the shares themselves. It can trade at a
   **premium** (crowd believes in the player beyond current holdings) or a
   **discount** (crowd thinks they're overrated / expects decline).

**The gap between IV-per-share and SP is the entire game.** Scouting = finding
players whose SP is below their IV-per-share and buying before the crowd corrects.

### Why not a "Fund" model
A fund (deposit cash, manager trades it, manager takes a cut) was considered and
rejected as the primary shape: it's safer but *less social* because there's no
public price-on-you — value is just real holdings, no crowd opinion layer. The
vision is "social media you trade on," so the IPO/price-on-you shape is the truer
fit. A fund-like "back this player" flow MAY be added later as a secondary mode,
but the share-price model is primary.

---

## 2. Going public is TIERED (earned, not automatic)

New players are **private and untradeable.** You unlock the ability to list your
vault publicly only after crossing a threshold. This is a load-bearing integrity
feature, not a nicety — it kills several abuse vectors at once (sock-puppet
shares, day-one pump targets, dumping on confused newbies).

**Unlock gate (tune later, all must be true):**
- Minimum net worth (e.g. ≥ some multiple of starting cash)
- Minimum account age (e.g. ≥ N cycles active)
- Minimum trade count (proof of real activity, not a parked account)

Going public is a deliberate action with a confirmation — it should *feel* like an
achievement / milestone moment, not an exposure. Players can also **go private
again** (delist) subject to a cooldown and orderly unwind (see §5).

---

## 3. Share mechanics

- On IPO, the player issues a fixed number of shares (e.g. 1,000). Some portion
  may be retained by the player (founder stake) and the rest offered to the market.
- Opening SP is anchored to IV-per-share (e.g. IPO opens at IV/shares, maybe a
  small set premium). It does NOT open at an arbitrary hype number.
- Other players buy/sell shares with their in-game cash. Standard order matching
  or a simple AMM-style curve — TBD in build, but must respect the guards in §4.
- A shareholder's position value = `shares_held × current SP`. They profit when SP
  rises. Selling returns `shares × SP` in cash.
- The listed player receives the cash from the **initial** share sale (their "IPO
  raise") — a real incentive to go public and then perform. Secondary trading
  (player-to-player) does NOT pay the listed player except optionally via a small
  royalty (TBD; watch for spiral interaction).

---

## 4. ECONOMIC INTEGRITY GUARDS (mandatory, day one)

These are not polish. The system is unsafe without them.

- **IV is sacrosanct.** Share trading never alters IV. (Re-stated because it's the
  whole defense.)
- **Soft tether band.** SP may premium/discount vs IV-per-share, but extreme
  detachment is dampened: beyond a band (e.g. ±X%), price moves face increasing
  resistance / mean-reversion pressure. Prevents moon/Ponzi runaways while still
  allowing real sentiment.
- **Per-cycle price-move cap (circuit breaker).** SP can move at most ±Y% per
  cycle. Halts pump velocity.
- **Round-trip / churn fees.** Fees on buying then quickly selling the same
  player's shares — makes wash-trading and collusive pumping unprofitable.
- **Lockup after listing.** Shares can't be dumped for N cycles post-IPO; prevents
  pump-and-dump on the opening.
- **Founder stake lockup / vesting.** The listed player can't instantly cash out
  their own retained shares.
- **Anti-collusion:** detect and dampen reciprocal pumping between small clusters
  of accounts (A pumps B pumps A). Mechanisms: shared-cluster detection, fee
  escalation on reciprocal flows, position caps (no single buyer owns >Z% of
  another player).
- **No value creation from nothing.** Audit invariant: total in-game wealth changes
  only through the core economy (asset appreciation, trading P/L), never as a side
  effect of share issuance. Write a test that asserts this.

---

## 5. ANTI-HARASSMENT / SOCIAL SAFETY (mandatory)

Raised directly by the product owner: *being publicly tradeable means being
publicly judged, and that can feel personal.* Economic guards aren't enough.

- **No naked shorting that profits from a player's failure** — at minimum heavily
  restricted/limited; default to NOT shipping shorting in v1. Betting against a
  person is the most toxic possible mechanic.
- **No harassment surface on the price.** No public comments / chat attached to a
  player's share page in v1. The price is data, not a roast thread.
- **Framing matters.** Present SP as "the crowd's read on this player's *picks /
  strategy*," never "their worth." Copy should never personalize a falling price.
- **Right to go private.** A player can delist (cooldown + orderly buy-back/unwind
  of outstanding shares at a fair reference price) if it stops being fun.
- **Opt-out is always available.** Going public is a choice; staying private is
  always a valid, non-penalized way to play.
- **No targeted mechanics.** No feature that lets one player single out another for
  coordinated downward pressure.

---

## 6. The scouting loop (first-class feature)

This is a headline mechanic, not a side effect:
- Surface a **discount/premium indicator** per public player (SP vs IV-per-share).
- A "scouting" view: players trading below intrinsic, sortable, like a bargain bin
  of underrated managers.
- Profit path: buy undervalued player → crowd corrects upward → sell. Rewards
  judgment about *other people's* judgment. Very social, very sticky.
- Balance note: the soft tether (§4) means discounts/premiums self-correct over
  time, so scouting is "be early," not "exploit a broken peg."

---

## 7. How it maps to the stack (consistent with core economy)

- Each public player = a record with `shares_total`, `shares_outstanding`, `SP`,
  cached `IV`, `listed_at`, `founder_locked_until`.
- Shareholdings = a table keyed `(holder, listedPlayer)` → qty.
- SP updates on trade (with caps/tether applied) and IV recomputed on the global
  settlement tick (same EventBridge cycle as the rest of the economy).
- Circuit breaker, lockup, and fee logic live in the share-trade Lambda; the
  anti-collusion detection can run as a periodic sweep.
- AI "analyst" traders can participate in share markets too (provide liquidity,
  chase discounts) so thin player counts still feel alive — same Poisson pattern
  as the asset-market traders.

---

## 8. Open questions to resolve at build time
- Exact unlock thresholds (§2) and share count (§3).
- Order book vs AMM curve for share pricing.
- Whether secondary trades pay the listed player a royalty (spiral risk).
- Tether band width, circuit-breaker %, lockup length, fee schedule — all need
  sandbox tuning, same as the asset economy.
- Whether a limited, well-guarded short mechanic ever ships (default: no).

---

## 9. Sequencing
1. Data package (brands, catalog, news bank) — current next deliverable.
2. Core economy productionized on AWS (global clock, stock/restock, editions).
3. Factory phase (players become suppliers) — separate spec.
4. **This (Public Vaults).** Build last of the major phases because it depends on a
   stable IV (needs the real economy underneath it) and is the hardest to balance.

> Design directive from owner, verbatim intent: protect the integrity of the
> economy and the player. Safety beats thrill wherever they conflict.
