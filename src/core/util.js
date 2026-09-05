// Small maths / helper library. Pure functions only — safe to import in Node for tests.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Shortest signed angular difference from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Rotate `a` toward `b` by at most `max` radians. */
export function turnToward(a, b, max) {
  const d = angleDelta(a, b);
  return a + clamp(d, -max, max);
}

/** Frame-rate independent exponential smoothing factor. */
export const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Deterministic 32-bit hash of two integers -> [0,1). Used for stable world detail. */
export function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Mulberry32 — small, fast, seedable PRNG. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  return rng;
}

/** Pick from [{ w: number, ... }] using weights. Returns null for an empty table. */
export function weightedPick(table, rand) {
  let total = 0;
  for (const e of table) total += e.w;
  if (total <= 0) return null;
  let r = rand() * total;
  for (const e of table) {
    r -= e.w;
    if (r <= 0) return e;
  }
  return table[table.length - 1];
}

/** Axis-aligned circle vs rectangle overlap test. */
export function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return dist2(cx, cy, nx, ny) < r * r;
}

/** Format an integer with thousands separators. */
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Human-readable mm:ss. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Remove entries where `pred` returns true, in place, preserving order. O(n). */
export function pruneInPlace(arr, pred) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (!pred(arr[i])) arr[w++] = arr[i];
  }
  arr.length = w;
  return arr;
}
