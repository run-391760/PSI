/** Deterministic hashing and PRNG. Same input -> same output on every machine and restart. */

/** cyrb53 string hash -> non-negative integer < 2^53. */
export function hash(input: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** Uniform [0,1) from a string key. */
export const unit = (key: string) => (hash(key) % 1_000_003) / 1_000_003;

export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  normal(mean?: number, sd?: number): number;
  logNormal(median: number, sigma: number): number;
  shuffle<T>(items: readonly T[]): T[];
  sample<T>(items: readonly T[], n: number): T[];
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
};

/** mulberry32 PRNG seeded from a string. */
export function rng(key: string): Rng {
  let a = hash(key) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mean = 0, sd = 1) => {
    const u = Math.max(next(), 1e-9);
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const shuffle = <T,>(items: readonly T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return {
    next,
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    normal,
    logNormal: (median, sigma) => median * Math.exp(normal(0, sigma)),
    shuffle,
    sample: (items, n) => shuffle(items).slice(0, Math.max(0, n)),
    weighted: (items, weights) => {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Small LRU memo for expensive deterministic computations. */
export function memo<A extends unknown[], R>(fn: (...args: A) => R, size = 200, key: (...args: A) => string = (...a) => JSON.stringify(a)) {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const k = key(...args);
    const hit = cache.get(k);
    if (hit !== undefined) {
      cache.delete(k);
      cache.set(k, hit);
      return hit;
    }
    const value = fn(...args);
    cache.set(k, value);
    if (cache.size > size) cache.delete(cache.keys().next().value as string);
    return value;
  };
}
