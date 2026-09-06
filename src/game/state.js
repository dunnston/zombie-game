// The single mutable game-state object plus the low-level accessors that every
// system shares. Deliberately free of gameplay rules — those live in the
// system modules so this file stays cycle-free.

import { TILE, RES, bagWeight } from './config.js';
import { isBlockedTile } from './world.js';
import { clamp } from '../core/util.js';
import { Input } from '../core/input.js';

export const G = {
  version: 6,
  world: null,
  player: null,
  enemies: [],
  bullets: [],
  corpses: [],
  pickups: [],
  survivors: [],           // recruited NPCs garrisoning the base
  rescues: [],             // people still out there waiting to be found
  vehicles: [],            // drivable cars
  survivorSeq: 0,
  vehicleSeq: 0,
  day: 1,
  dayTime: 0.16,
  phase: 'day',
  rationDebt: 0,
  structures: [],
  structGrid: new Map(),   // "tx,ty" -> structure
  backpacks: [],           // death drops
  stash: {},               // shared base storage
  camera: { x: 0, y: 0, zoom: 1, shake: 0, shakeX: 0, shakeY: 0 },
  time: 0,
  threat: 0,
  threatTier: 0,
  // Local pressure relief — see pressure.js. Built lazily from the world size.
  quiet: null,
  raid: null,
  raidsDone: 0,
  notifications: [],
  tutorial: { step: 0, done: {}, hint: null },
  ui: {
    panel: null, buildIndex: 0, buildMode: false, hover: null, mapOpen: false,
    levelChoices: null, tab: 0,
    hudRects: [],   // screen-space regions that swallow clicks from the world
  },
  stats: { kills: 0, looted: 0, built: 0, crafted: 0, deaths: 0, damageDealt: 0 },
  paused: false,
  gameOverCredits: false,
  flash: { t: 0, color: '#ff0000' },
  slowmo: 0,
  spatial: null,
};

// ------------------------------------------------------------ resource bag --

export function addRes(bag, id, n) {
  if (!RES[id] || n <= 0) return 0;
  bag[id] = (bag[id] || 0) + n;
  return n;
}

/**
 * Adds up to the bag's remaining capacity. Returns how much actually fit so
 * callers can tell the player what overflowed.
 */
export function addResCapped(bag, id, n, cap) {
  if (!RES[id] || n <= 0) return 0;
  const room = cap - bagWeight(bag);
  const perUnit = RES[id].wt;
  const fits = perUnit <= 0 ? n : Math.floor(room / perUnit + 1e-9);
  const give = Math.max(0, Math.min(n, fits));
  if (give > 0) bag[id] = (bag[id] || 0) + give;
  return give;
}

export function takeRes(bag, id, n) {
  const have = bag[id] || 0;
  const took = Math.min(have, n);
  bag[id] = have - took;
  if (bag[id] <= 0) delete bag[id];
  return took;
}

export const countRes = (bag, id) => bag[id] || 0;

/** Total of `id` across the player's pack and the stash. */
export function totalRes(id) {
  return countRes(G.player ? G.player.bag : {}, id) + countRes(G.stash, id);
}

export function canAfford(cost, mul = 1) {
  for (const id in cost) {
    if (totalRes(id) < Math.ceil(cost[id] * mul)) return false;
  }
  return true;
}

/** Spends from the pack first, then the stash. Assumes canAfford() passed. */
export function spend(cost, mul = 1) {
  for (const id in cost) {
    let need = Math.ceil(cost[id] * mul);
    need -= takeRes(G.player.bag, id, need);
    if (need > 0) takeRes(G.stash, id, need);
  }
}

export function scaledCost(cost, mul) {
  const out = {};
  for (const id in cost) out[id] = Math.ceil(cost[id] * mul);
  return out;
}

// --------------------------------------------------------------- structures --

export const skey = (tx, ty) => `${tx},${ty}`;
export const structAt = (tx, ty) => G.structGrid.get(skey(tx, ty)) || null;
export const structAtPx = (px, py) => structAt(Math.floor(px / TILE), Math.floor(py / TILE));

export function addStructure(s) {
  G.structures.push(s);
  G.structGrid.set(skey(s.tx, s.ty), s);
  return s;
}

export function removeStructure(s) {
  const i = G.structures.indexOf(s);
  if (i >= 0) G.structures.splice(i, 1);
  const cur = G.structGrid.get(skey(s.tx, s.ty));
  if (cur === s) G.structGrid.delete(skey(s.tx, s.ty));
}

/** True if the tile blocks movement — terrain, props, or a closed structure. */
export function solidTile(tx, ty) {
  if (isBlockedTile(G.world, tx, ty)) return true;
  const s = structAt(tx, ty);
  return !!(s && s.solid && !(s.def.gate && s.open));
}

export const solidPx = (px, py) => solidTile(Math.floor(px / TILE), Math.floor(py / TILE));

/**
 * Terrain-only collision, ignoring player-built structures.
 *
 * Bullets use this so you can fire over your own barricades. Top-down, your
 * walls are chest height; more importantly, a base you cannot shoot out of is
 * a base that actively punishes you for building it.
 */
export const terrainBlocksPx = (px, py) =>
  isBlockedTile(G.world, Math.floor(px / TILE), Math.floor(py / TILE));

/**
 * Slide-along-walls circle movement. Resolves X and Y independently so an
 * entity brushing a wall keeps its remaining momentum instead of sticking.
 */
export function moveCircle(ent, dx, dy, r) {
  if (dx !== 0) {
    const nx = ent.x + dx;
    if (!circleHitsSolid(nx, ent.y, r)) ent.x = nx;
    else {
      // Snap flush to the wall face we ran into.
      const step = Math.sign(dx);
      let probe = ent.x;
      for (let i = 0; i < 4; i++) {
        const t = probe + step * (Math.abs(dx) / 4);
        if (circleHitsSolid(t, ent.y, r)) break;
        probe = t;
      }
      ent.x = probe;
    }
  }
  if (dy !== 0) {
    const ny = ent.y + dy;
    if (!circleHitsSolid(ent.x, ny, r)) ent.y = ny;
    else {
      const step = Math.sign(dy);
      let probe = ent.y;
      for (let i = 0; i < 4; i++) {
        const t = probe + step * (Math.abs(dy) / 4);
        if (circleHitsSolid(ent.x, t, r)) break;
        probe = t;
      }
      ent.y = probe;
    }
  }
  const max = G.world.w * TILE - r - 1;
  ent.x = clamp(ent.x, r + 1, max);
  ent.y = clamp(ent.y, r + 1, max);
}

/**
 * Ejects an entity that has somehow ended up inside geometry (a wall built
 * around it, a respawn on a bad tile). Cheap no-op in the normal case.
 */
export function unstick(ent, r) {
  if (!circleHitsSolid(ent.x, ent.y, r)) return false;
  for (let ring = 1; ring <= 8; ring++) {
    const step = TILE * 0.55 * ring;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const nx = ent.x + Math.cos(a) * step;
      const ny = ent.y + Math.sin(a) * step;
      if (!circleHitsSolid(nx, ny, r)) { ent.x = nx; ent.y = ny; return true; }
    }
  }
  return false;
}

/** Circle-vs-tilemap test using the 3x3 tile neighbourhood. */
export function circleHitsSolid(cx, cy, r) {
  const minX = Math.floor((cx - r) / TILE), maxX = Math.floor((cx + r) / TILE);
  const minY = Math.floor((cy - r) / TILE), maxY = Math.floor((cy + r) / TILE);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (!solidTile(tx, ty)) continue;
      const rx = tx * TILE, ry = ty * TILE;
      const nx = clamp(cx, rx, rx + TILE), ny = clamp(cy, ry, ry + TILE);
      const ddx = cx - nx, ddy = cy - ny;
      if (ddx * ddx + ddy * ddy < r * r) return true;
    }
  }
  return false;
}

/** First solid tile along a ray, or null. Used for bullets and line of sight. */
export function raycast(x0, y0, x1, y1, step = 8) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;
  const n = Math.ceil(len / step);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const px = x0 + dx * t, py = y0 + dy * t;
    if (solidPx(px, py)) return { x: px, y: py, t };
  }
  return null;
}

export const hasLineOfSight = (x0, y0, x1, y1) => raycast(x0, y0, x1, y1, 12) === null;

/**
 * Line of sight that ignores player-built structures — the same rule bullets
 * use. Turrets target with this so they never lock onto something behind a tree
 * and empty their magazine into it.
 */
export function hasTerrainLineOfSight(x0, y0, x1, y1, step = 14) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return true;
  const n = Math.ceil(len / step);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (terrainBlocksPx(x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

// ------------------------------------------------------------ spatial hash --

const CELL = 96;

export class SpatialHash {
  constructor() { this.map = new Map(); }
  clear() { this.map.clear(); }
  insert(e) {
    const k = ((e.x / CELL) | 0) + ',' + ((e.y / CELL) | 0);
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(e);
  }
  /** Collects everything in cells overlapping the query circle into `out`. */
  query(x, y, r, out) {
    out.length = 0;
    const x0 = ((x - r) / CELL) | 0, x1 = ((x + r) / CELL) | 0;
    const y0 = ((y - r) / CELL) | 0, y1 = ((y + r) / CELL) | 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.map.get(cx + ',' + cy);
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}

// ------------------------------------------------------------ notifications --

export function notify(text, color = '#d8e8c0', big = false) {
  G.notifications.push({ text, color, t: 0, life: big ? 3.4 : 2.6, big });
  if (G.notifications.length > 7) G.notifications.shift();
}

/**
 * True when the cursor is over a UI region that has claimed clicks. The HUD
 * resolves its own clicks during the draw pass, so gameplay must not also act
 * on the same press — otherwise choosing a build piece would place the previous
 * one first.
 */
export function pointerOverHud() {
  const rects = G.ui.hudRects;
  if (!rects || rects.length === 0) return false;
  const s = G.dpr || 1;
  const mx = Input.mouse.x / s, my = Input.mouse.y / s;
  for (const r of rects) {
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return true;
  }
  return false;
}

export function shake(amount) {
  G.camera.shake = Math.min(26, G.camera.shake + amount);
}

export function screenFlash(color, strength = 0.5) {
  G.flash.color = color;
  G.flash.t = Math.max(G.flash.t, strength);
}
