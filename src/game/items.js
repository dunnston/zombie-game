// One registry for everything that can sit in an inventory slot, plus the
// slot-container operations the inventory screen and the loot system share.
//
// Before this existed the player held four parallel collections — `bag` for
// materials, `items` for consumables, `weapons` and `armors` as id arrays —
// and nothing could be moved, dropped or looked at as a single list. A visual
// inventory needs one addressable list, so this flattens all four into slots
// while leaving the *containers* elsewhere in the game (the stash, car boots,
// survivor cargo) as the plain id->count maps they already were.

import {
  RES, WEAPONS, GEAR, CONSUMABLES, GEAR_SLOTS,
} from './config.js';

/** Stack limits for things that are not raw resources. */
const CONSUMABLE_STACK = 10;

/**
 * id -> { id, name, kind, stack, wt, color, slot?, def }
 *
 * `kind` is what the UI switches on: 'res' | 'weapon' | 'gear' | 'consumable'.
 */
export const ITEMS = {};

for (const id in RES) {
  const r = RES[id];
  ITEMS[id] = {
    id, name: r.name, kind: 'res', stack: r.stack || 50,
    wt: r.wt, color: r.color, def: r,
  };
}
for (const id in WEAPONS) {
  const w = WEAPONS[id];
  // Fists are not an object you carry.
  if (id === 'fists') continue;
  ITEMS[id] = {
    id, name: w.name, kind: 'weapon', stack: 1,
    wt: w.wt || 6, color: w.color, def: w,
  };
}
for (const id in GEAR) {
  const g = GEAR[id];
  ITEMS[id] = {
    id, name: g.name, kind: 'gear', stack: 1,
    wt: g.wt, color: g.color, slot: g.slot, def: g,
  };
}
for (const id in CONSUMABLES) {
  const c = CONSUMABLES[id];
  ITEMS[id] = {
    id, name: c.name, kind: 'consumable', stack: CONSUMABLE_STACK,
    wt: c.wt || 0.5, color: c.color, def: c,
  };
}

export const itemDef = (id) => ITEMS[id] || null;
export const stackLimit = (id) => (ITEMS[id] ? ITEMS[id].stack : 1);
export const itemWeight = (id) => (ITEMS[id] ? ITEMS[id].wt : 0);

// ------------------------------------------------------------- containers ---

/**
 * A slot container. Kept as an object rather than a bare array so the same
 * value can carry its capacity, and so `addRes(p.bag, ...)` can tell a slot
 * container from the plain id->count maps the stash and car boots still use.
 */
export function makeSlots(count) {
  return { slots: new Array(count).fill(null) };
}

export const isSlots = (c) => !!c && Array.isArray(c.slots);

/** Total units of `id` held. */
export function slotsCount(c, id) {
  let n = 0;
  for (const s of c.slots) if (s && s.id === id) n += s.n;
  return n;
}

/** Weight of everything held. */
export function slotsWeight(c) {
  let w = 0;
  for (const s of c.slots) if (s) w += itemWeight(s.id) * s.n;
  return w;
}

export function firstEmpty(c) {
  for (let i = 0; i < c.slots.length; i++) if (!c.slots[i]) return i;
  return -1;
}

/** Everything held, flattened to {id, n} totals — for iteration and saving. */
export function slotsEntries(c) {
  const out = {};
  for (const s of c.slots) if (s) out[s.id] = (out[s.id] || 0) + s.n;
  return out;
}

/**
 * Adds up to `n` units, topping up part-used stacks before opening new slots.
 * Returns how many actually fitted, so the caller can spill the rest.
 */
export function slotsAdd(c, id, n) {
  if (!ITEMS[id] || n <= 0) return 0;
  const max = stackLimit(id);
  let left = n;
  for (const s of c.slots) {
    if (left <= 0) break;
    if (s && s.id === id && s.n < max) {
      const room = max - s.n;
      const take = Math.min(room, left);
      s.n += take;
      left -= take;
    }
  }
  for (let i = 0; i < c.slots.length && left > 0; i++) {
    if (c.slots[i]) continue;
    const take = Math.min(max, left);
    c.slots[i] = { id, n: take };
    left -= take;
  }
  return n - left;
}

/** Removes up to `n` units. Returns how many were actually removed. */
export function slotsTake(c, id, n) {
  let left = n;
  for (let i = 0; i < c.slots.length && left > 0; i++) {
    const s = c.slots[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.n, left);
    s.n -= take;
    left -= take;
    if (s.n <= 0) c.slots[i] = null;
  }
  return n - left;
}

export function slotsClear(c) {
  for (let i = 0; i < c.slots.length; i++) c.slots[i] = null;
}

/**
 * Moves or merges the stack at `from` onto `to`. Same item merges up to the
 * stack limit and leaves any remainder behind; anything else swaps.
 */
export function slotsMove(c, from, to, other = null) {
  const src = c.slots;
  const dst = other ? other.slots : c.slots;
  if (from === to && !other) return false;
  const a = src[from];
  if (!a) return false;
  const b = dst[to];
  if (b && b.id === a.id) {
    const max = stackLimit(a.id);
    const room = max - b.n;
    if (room <= 0) return false;
    const take = Math.min(room, a.n);
    b.n += take;
    a.n -= take;
    if (a.n <= 0) src[from] = null;
    return true;
  }
  dst[to] = a;
  src[from] = b || null;
  return true;
}

/** Splits half of a stack into an empty slot. */
export function slotsSplit(c, from, to) {
  const a = c.slots[from];
  if (!a || a.n < 2 || c.slots[to]) return false;
  const half = Math.floor(a.n / 2);
  c.slots[to] = { id: a.id, n: half };
  a.n -= half;
  return true;
}

// ----------------------------------------------------------------- equipment --

/**
 * How much weight the player's pack may still take.
 *
 * `carryCap` is a budget for everything carried — pack and hotbar together —
 * because that is what the inventory screen's weight bar shows. Capacity
 * checks have to net off what the hotbar already holds, or the two disagree
 * and loot keeps fitting after the bar has passed 100%.
 *
 * It lives here rather than in player.js because building, crafting, loot and
 * vehicles all need it, and none of them may import player.js without
 * recreating the cycle damage.js exists to break.
 */
export function packAllowance(p) {
  return p.carryCap - slotsWeight(p.hotbar);
}

export function makeEquip() {
  const e = {};
  for (const s of GEAR_SLOTS) e[s] = null;
  return e;
}

/** The slot a given item can be equipped into, or null if it is not gear. */
export function gearSlot(id) {
  const it = ITEMS[id];
  return it && it.kind === 'gear' ? it.slot : null;
}
