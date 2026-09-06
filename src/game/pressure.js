// Local pressure relief — the reason clearing ground is worth doing.
//
// The spawner keeps a standing population near the player, refilled every
// 0.6s. That is what makes the world feel alive, but on its own it means a
// player never gets a lull: kill one, another walks in, forever. There is then
// no window in which to lay a wall line, and the first playtest could do
// nothing but fight.
//
// So killing things buys quiet, locally and temporarily. A coarse field over
// the world holds how thoroughly each patch of ground has been cleared. The
// spawner reads it and thins out accordingly. Quiet decays over a few minutes,
// so it is a breather you have earned, not a safe zone you own — the world
// gets more dangerous as you get stronger (pillar 6), it just stops being
// uniformly dangerous everywhere at once.

import { TILE } from './config.js';
import { G } from './state.js';

export const CELL = 256;                 // px per quiet cell
const PER_KILL = 1.0;                    // quiet deposited by one kill, spread over the kernel below
const MAX_QUIET = 6;                     // ceiling, so a killing field cannot go permanently dead
const DECAY_PER_SEC = MAX_QUIET / 270;   // full ceiling bleeds off in ~4.5 minutes

// Quiet at which new arrivals stop entirely. Calibrated by measurement, not by
// eye: with the kernel above, three kills read back 1.74-2.84 depending on
// where you stand and five read back 2.91-4.67, so 2.9 is the one value that
// cleanly separates them. Five kills is about one approaching group — enough
// that clearing your chosen site is a deliberate act with a visible payoff,
// few enough that the lull is actually reachable.
const SUPPRESS_AT = 2.9;

// A base you have built and defended is calmer ground than open road. This is
// deliberately weaker than clearing by hand — it takes the edge off, it does
// not make a wall into a no-spawn bubble.
const STRUCT_QUIET = 1.6;
const STRUCT_RADIUS = 400;

/** Quiet at its strongest still leaves this share of the normal population. */
const FLOOR = 0.3;

export function initPressure(world) {
  const w = Math.ceil((world.w * TILE) / CELL);
  const h = Math.ceil((world.h * TILE) / CELL);
  G.quiet = { w, h, a: new Float32Array(w * h) };
  return G.quiet;
}

function field() {
  if (!G.quiet && G.world) initPressure(G.world);
  return G.quiet;
}

const idx = (q, cx, cy) => cy * q.w + cx;
const cellOf = (px) => Math.floor(px / CELL);

function cellValue(q, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= q.w || cy >= q.h) return 0;
  return q.a[idx(q, cx, cy)];
}

/**
 * Raw quiet at a world point, ignoring structures, sampled smoothly across
 * cells.
 *
 * Reading the containing cell directly made the effect depend on where inside
 * a 256px square you happened to be standing: clear a spot near a cell edge
 * and most of the credit landed in the neighbour. The same eight kills bought
 * either forty seconds of calm or none at all, measured. Interpolating the
 * four nearest cells makes it behave the same wherever you are, which is the
 * only version a player can build an intuition about.
 */
export function quietAt(px, py) {
  const q = field();
  if (!q) return 0;
  // Cell centres sit at (c + 0.5) * CELL, so shift before flooring.
  const fx = px / CELL - 0.5, fy = py / CELL - 0.5;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  const tx = fx - cx, ty = fy - cy;
  const a = cellValue(q, cx, cy), b = cellValue(q, cx + 1, cy);
  const c = cellValue(q, cx, cy + 1), d = cellValue(q, cx + 1, cy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Quiet including the standing contribution from anything the player has
 * built nearby. Structures are counted here rather than baked into the field
 * so that losing your base immediately makes the ground dangerous again.
 */
export function totalQuietAt(px, py) {
  let quiet = quietAt(px, py);
  if (quiet >= MAX_QUIET) return MAX_QUIET;
  const r2 = STRUCT_RADIUS * STRUCT_RADIUS;
  for (const s of G.structures) {
    if (s.destroyed) continue;
    const dx = s.x - px, dy = s.y - py;
    if (dx * dx + dy * dy < r2) { quiet += STRUCT_QUIET; break; }
  }
  return Math.min(MAX_QUIET, quiet);
}

/**
 * Multiplier on how many enemies the spawner wants near a point: 1 in ground
 * nobody has touched, down to FLOOR where it has been thoroughly cleared.
 */
export function densityMul(px, py) {
  const q = totalQuietAt(px, py);
  return 1 - (1 - FLOOR) * Math.min(1, q / MAX_QUIET);
}

/** True where the ground is quiet enough that nothing new should walk in. */
export function suppressed(px, py) {
  return totalQuietAt(px, py) >= SUPPRESS_AT;
}

/**
 * Killing something quietens where it fell, and the ground around it.
 *
 * The kernel is deliberately wide and smooth — weighted by true distance from
 * the kill to each cell centre, not by cell adjacency. A narrow kernel made
 * the payoff depend on where in a cell you were standing: measured, the same
 * eight kills read back anywhere from 3.97 to 5.89, straddling the
 * suppression threshold, so clearing your site worked or did not by luck.
 */
export function addQuiet(px, py, amount = PER_KILL) {
  const q = field();
  if (!q) return;
  const cx = cellOf(px), cy = cellOf(py);
  const reach = 1.7 * CELL;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const x = cx + i, y = cy + j;
      if (x < 0 || y < 0 || x >= q.w || y >= q.h) continue;
      const ccx = (x + 0.5) * CELL, ccy = (y + 0.5) * CELL;
      const d = Math.hypot(ccx - px, ccy - py);
      const share = 1 - d / reach;
      if (share <= 0) continue;
      const k = idx(q, x, y);
      q.a[k] = Math.min(MAX_QUIET, q.a[k] + amount * share);
    }
  }
}

/**
 * Bleeds the whole field back towards dangerous. Cheap enough to run every
 * frame — a 5120px world is a 20x20 field.
 */
export function updatePressure(dt) {
  const q = field();
  if (!q) return;
  const d = DECAY_PER_SEC * dt;
  const a = q.a;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > 0) a[i] = Math.max(0, a[i] - d);
  }
}

// ------------------------------------------------------------------- save ---

export function serialisePressure() {
  const q = field();
  if (!q) return null;
  // Rounded to one decimal and stored as a plain array: it is 400 numbers, and
  // keeping saves readable has been worth more than the bytes.
  return { w: q.w, h: q.h, a: Array.from(q.a, (v) => Math.round(v * 10) / 10) };
}

export function loadPressure(data, world) {
  initPressure(world);
  if (!data || !data.a || data.w !== G.quiet.w || data.h !== G.quiet.h) return;
  for (let i = 0; i < G.quiet.a.length && i < data.a.length; i++) {
    G.quiet.a[i] = data.a[i] || 0;
  }
}
