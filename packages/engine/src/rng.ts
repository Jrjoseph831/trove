/**
 * Injectable RNG. The engine routes every random draw through `rand()` so tests
 * can swap in a seeded PRNG for determinism (see specs/02_ENGINE.md §Determinism).
 * Production leaves it as Math.random.
 */
let _rng: () => number = Math.random;

/** Replace the global RNG (tests). */
export function setRng(fn: () => number): void {
  _rng = fn;
}

/** Restore Math.random. */
export function resetRng(): void {
  _rng = Math.random;
}

/** Uniform [0, 1). */
export function rand(): number {
  return _rng();
}

/** Exponential draw with the given mean (Poisson trader scheduling). */
export function rexp(mean: number): number {
  return -Math.log(1 - rand()) * mean;
}

/** Deterministic, seedable PRNG (mulberry32) — for reproducible tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
