/**
 * Trove Vault Time — the clock the game actually runs on, and the only one a
 * player should ever be shown.
 *
 * TVT runs 2× real time: a full Trove day every 12 real hours, with the market
 * turning at 00:00 and 12:00 TVT. Everything the UI says about duration has to
 * be in this clock, or the numbers quietly describe two different worlds.
 *
 * Production is the case that matters most. A factory tick is 5 REAL minutes,
 * which is 10 TVT minutes — so six ticks to the TVT hour. The floor used to
 * report burn and cover in "ticks", a unit nothing on screen defined, which
 * left a player reading "0 ticks cover" with no idea whether that was a
 * problem in ten minutes or ten hours.
 */
import { PROD_SEC_PER_CYCLE } from "@trove/engine";

/** How much faster TVT runs than real time. */
export const TROVE_SPEED = 2;

/** Real seconds in one TVT hour (1800 — half a real hour). */
export const TVT_HOUR_REAL_SEC = 3600 / TROVE_SPEED;

/** Production ticks per TVT hour (6). */
export const TICKS_PER_TVT_HOUR = TVT_HOUR_REAL_SEC / PROD_SEC_PER_CYCLE;

/** A per-tick rate, expressed per TVT hour — what a player can reason about. */
export const perHour = (perTick: number): number => perTick * TICKS_PER_TVT_HOUR;

/**
 * A count of ticks as a readable TVT duration. Kept coarse on purpose: the
 * question being answered is "should I do something about this?", not "what is
 * this to the minute".
 */
export function ticksToTvt(ticks: number): string {
  if (!Number.isFinite(ticks)) return "—";
  const mins = ticks * (PROD_SEC_PER_CYCLE * TROVE_SPEED) / 60; // TVT minutes
  if (mins < 1) return "minutes";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = mins / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/** The current TVT wall clock, e.g. "14:56". */
export function tvtClock(now: number = Date.now()): string {
  const g = (now * TROVE_SPEED) % 86_400_000;
  const hh = String(Math.floor(g / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((g % 3_600_000) / 60_000)).padStart(2, "0");
  return `${hh}:${mm}`;
}
