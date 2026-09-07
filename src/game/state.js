// The single mutable game-state object plus the low-level accessors that every
// system shares. Deliberately free of gameplay rules — those live in the
// system modules so this file stays cycle-free.

import { TILE, RES, SHOOT_OVER, bagWeight } from './config.js';
import {
  ITEMS, isSlots, slotsAdd, slotsTake, slotsCount, slotsWeight, itemWeight,
} from './items.js';
import { isBlockedTile } from './world.js';
import { clamp } from '../core/util.js';
import { Input } from '../core/input.js';

export const G = {
  // Save payload version. 6 was the single-player record; 8 keeps every
  // player by identity so a hosted world remembers its guests; 9 was the
  // 320-tile world.
  //
  // 10, because the generator's RNG stream moved: the town's woodland floor
  // rose and a litter pass was added, so the same seed lays out different
  // props. Containers and vehicles are generated earlier and are unchanged,
  // but a v9 save replayed against this generator would fell the wrong props
  // and could regrow a tree inside a wall the player had built. See invariant
  // 7 — content changes invalidate saves, and the version is how we say so.
  //
  // 11, for the same reason again: the litter pass got a quarter of its old
  // odds, so every rng draw after it lands differently and the props a v10
  // save's `chopped` keys refer to are not the props this generator makes.
  //
  // 12, twice over. The litter odds moved a third time (and gained a
  // guaranteed starter cache at the camp), which is the same generator-stream
  // problem again; and the shared stash stopped being a plain id->count map
  // and became a slot container, so the shape of the payload changed too.
  version: 12,
  world: null,
  // Every survivor in the world who is a person at a keyboard. In solo this
  // holds exactly one. `G.player` below is an alias for the *local* one, so the
  // hundred-odd places that mean "me, for the camera and the HUD" read the same
  // as they always did; simulation code that means "whoever did this" takes the
  // player as a parameter instead.
  players: [],
  localIdx: 0,
  playerSeq: 0,
  enemySeq: 0,
  pickupSeq: 0,
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
  stats: { kills: 0, looted: 0, built: 0, crafted: 0, deaths: 0, damageDealt: 0, repaired: 0 },
  paused: false,
  gameOverCredits: false,
  flash: { t: 0, color: '#ff0000' },
  slowmo: 0,
  spatial: null,
  // 'title' before a game exists or after quitting to the menu; 'game' while
  // one is running. The main loop draws the menu instead of the world on the
  // title and does not step the simulation.
  scene: 'title',
  menu: { screen: 'main', from: null, pendingRebind: null, confirmDelete: null, scroll: 0, rects: {} },
  // Which save slot this game lives in, 'solo' or 'coop', and seconds played.
  slotId: null,
  mode: 'solo',
  playtime: 0,
  // Networking. 'solo' runs the sim for one keyboard; 'host' runs it and tells
  // guests; 'client' renders what a host says and sends intent back.
  net: { role: 'solo', code: null, hostName: null, status: '', error: null, stats: null, guests: [] },
};

// ------------------------------------------------------------------ players --

/**
 * The local player. Assigning to it means "this is the one person at this
 * keyboard, start the roster over" — which is what newGame and loadGame want.
 * Other players join through addPlayer().
 */
Object.defineProperty(G, 'player', {
  enumerable: true,
  get() { return G.players[G.localIdx] || null; },
  set(p) {
    G.players.length = 0;
    G.localIdx = 0;
    G.playerSeq = 0;
    if (p) addPlayer(p);
  },
});

/** Adds a player to the world and hands it a wire id. */
export function addPlayer(p) {
  p.netId = ++G.playerSeq;
  G.players.push(p);
  return p;
}

export function removePlayer(p) {
  const i = G.players.indexOf(p);
  if (i < 0) return false;
  G.players.splice(i, 1);
  if (G.localIdx > i) G.localIdx--;
  return true;
}

/** True for the player at this keyboard — the one whose screen should shake. */
export const isLocal = (p) => p === G.players[G.localIdx];

/**
 * Whose stats govern the base. Turrets, traps, wall strength, survivor upkeep
 * and the roster cap all read one player's multipliers, and it is always the
 * host's: stable, predictable, and it does not shift when a guest leaves.
 */
export const baseOwner = () => G.players[0] || null;

/** Players who are present in the world at all — connected, whatever state. */
export function presentPlayers() {
  const out = [];
  for (const p of G.players) if (!p.away) out.push(p);
  return out;
}

/** A player an enemy can hurt: present, alive, and on their feet. */
export const targetable = (p) => !!p && !p.away && !p.dead && !p.downed;

/** The nearest player an enemy could go for, or null if nobody qualifies. */
export function nearestPlayer(x, y, pred = targetable) {
  let best = null, bd = Infinity;
  for (const p of G.players) {
    if (!pred(p)) continue;
    const dx = p.x - x, dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ------------------------------------------------------------ resource bag --
//
// Two container shapes live behind these four functions. The player's pack is
// a slot container (see items.js) because it has to be drawn, dragged and
// rearranged; the stash, car boots and survivor cargo stay as plain id->count
// maps because nothing addresses an individual slot in them. Keeping the
// signatures identical is what let the inventory rewrite leave ~40 call sites
// across building, crafting, combat, loot and survivors completely untouched.

/** Weight of either container shape. */
export function containerWeight(bag) {
  return isSlots(bag) ? slotsWeight(bag) : bagWeight(bag);
}

export function addRes(bag, id, n) {
  if (n <= 0) return 0;
  if (isSlots(bag)) return ITEMS[id] ? slotsAdd(bag, id, n) : 0;
  if (!RES[id]) return 0;
  bag[id] = (bag[id] || 0) + n;
  return n;
}

/**
 * Adds up to the bag's remaining capacity. Returns how much actually fit so
 * callers can tell the player what overflowed.
 */
export function addResCapped(bag, id, n, cap) {
  if (n <= 0) return 0;
  const perUnit = isSlots(bag) ? itemWeight(id) : (RES[id] ? RES[id].wt : -1);
  if (perUnit < 0) return 0;
  const room = cap - containerWeight(bag);
  const fits = perUnit <= 0 ? n : Math.floor(room / perUnit + 1e-9);
  const give = Math.max(0, Math.min(n, fits));
  if (give <= 0) return 0;
  // A slot container can still refuse it: weight allows it, but every slot is
  // full. addRes reports what actually fitted.
  return addRes(bag, id, give);
}

export function takeRes(bag, id, n) {
  if (isSlots(bag)) return slotsTake(bag, id, n);
  const have = bag[id] || 0;
  const took = Math.min(have, n);
  bag[id] = have - took;
  if (bag[id] <= 0) delete bag[id];
  return took;
}

export const countRes = (bag, id) =>
  (isSlots(bag) ? slotsCount(bag, id) : (bag[id] || 0));

/** Total of `id` across a player's pack and the shared stash. */
export function totalRes(id, p = G.player) {
  return countRes(p ? p.bag : {}, id) + countRes(G.stash, id);
}

export function canAfford(cost, mul = 1, p = G.player) {
  for (const id in cost) {
    if (totalRes(id, p) < Math.ceil(cost[id] * mul)) return false;
  }
  return true;
}

/** Spends from the player's pack first, then the stash. Assumes canAfford() passed. */
export function spend(cost, mul = 1, p = G.player) {
  for (const id in cost) {
    let need = Math.ceil(cost[id] * mul);
    if (p) need -= takeRes(p.bag, id, need);
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
  netEmit('struct', { s: structRecord(s) });
  return s;
}

export function removeStructure(s) {
  const i = G.structures.indexOf(s);
  if (i >= 0) G.structures.splice(i, 1);
  const cur = G.structGrid.get(skey(s.tx, s.ty));
  if (cur === s) G.structGrid.delete(skey(s.tx, s.ty));
  netEmit('sdel', { tx: s.tx, ty: s.ty });
}

/** A structure as the save file and the wire describe it. */
export function structRecord(s) {
  return {
    t: s.type, tx: s.tx, ty: s.ty, hp: Math.round(s.hp * 10) / 10, maxHp: s.maxHp,
    open: !!s.open, tier: s.tier || 1, fuel: Math.round((s.fuel || 0) * 10) / 10, ammo: s.ammo || 0,
    on: s.on !== false, active: !!s.active, running: !!s.running, powered: !!s.powered,
    aim: Math.round((s.aim || 0) * 100) / 100,
  };
}

/** Tells guests a structure's fields changed (health, gate, fuel, tier…). */
export const structChanged = (s) => netEmit('struct', { s: structRecord(s) });

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
 * What stops a round. Everything that stops a foot, except water and fences:
 * a river is a barrier you can shoot across, and a farm fence is knee high.
 */
export function bulletBlocksPx(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (!isBlockedTile(G.world, tx, ty)) return false;
  return !SHOOT_OVER.has(G.world.tiles[ty * G.world.w + tx]);
}

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
    if (bulletBlocksPx(x0 + dx * t, y0 + dy * t)) return false;
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

/**
 * @param scope  'local' (default) shows it on this screen only. 'all' is world
 *               news — a raid, the day turning, someone joining — and, when
 *               hosting, is repeated to every guest through onBroadcast.
 */
export function notify(text, color = '#d8e8c0', big = false, scope = 'local') {
  G.notifications.push({ text, color, t: 0, life: big ? 3.4 : 2.6, big });
  if (G.notifications.length > 7) G.notifications.shift();
  if (scope === 'all' && notify.onBroadcast) notify.onBroadcast(text, color, big);
}
// Installed by the host session; null everywhere else. Kept as a property so
// state.js never imports the network.
notify.onBroadcast = null;

/**
 * The one door from the simulation to the network. Modules that state.js
 * itself imports (world.js) cannot import net/events.js without a cycle, so
 * they — and state.js — call through here. The host session installs `emit`;
 * everywhere else it stays null and these are no-ops.
 */
// `emit` is set by the host session; `toTitle` by game.js at load, for the
// guest session, which must not import game.js (cycle).
export const netHooks = { emit: null, toTitle: null };
export const netEmit = (kind, fields, to = null) => { if (netHooks.emit) netHooks.emit(kind, fields, to); };

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
