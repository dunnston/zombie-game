// Base building: placement validation, power, repair and demolition.
// The player can build literally anywhere in the world — "base" is just
// wherever their structures happen to be.

import { STRUCTURES, BUILD_ORDER, TILE, THREAT, BENCH_UPGRADE_COST } from './config.js';
import {
  G, structAt, addStructure, removeStructure, canAfford, spend, scaledCost,
  notify, addRes, addResCapped, takeRes, countRes,
} from './state.js';
import { isBlockedTile } from './world.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addThreat } from './threat.js';
import { addXp } from './progression.js';
import { dist2 } from '../core/util.js';

export const BUILD_RANGE = 190;

/** Menu entries: every structure, plus the two tools. */
export function buildMenu() {
  return [...BUILD_ORDER, 'repair', 'demolish'];
}

export function isUnlocked(type) {
  const def = STRUCTURES[type];
  if (!def) return true;                 // tools are always available
  if (def.tier <= 1) return true;
  return G.benchTier >= 2;
}

export function structureCost(type) {
  const def = STRUCTURES[type];
  if (!def) return {};
  return scaledCost(def.cost, G.player.buildCostMul);
}

/**
 * @returns {{ok: boolean, reason: string}}
 */
export function canPlace(type, tx, ty) {
  const def = STRUCTURES[type];
  if (!def) return { ok: false, reason: 'Unknown' };
  if (!isUnlocked(type)) return { ok: false, reason: 'Needs upgraded workbench' };

  const w = G.world;
  if (tx < 1 || ty < 1 || tx >= w.w - 1 || ty >= w.h - 1) return { ok: false, reason: 'Out of bounds' };
  if (isBlockedTile(w, tx, ty)) return { ok: false, reason: 'Blocked' };
  if (structAt(tx, ty)) return { ok: false, reason: 'Occupied' };

  const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
  const p = G.player;
  if (dist2(cx, cy, p.x, p.y) > BUILD_RANGE * BUILD_RANGE) return { ok: false, reason: 'Too far' };

  // Never let a solid piece trap the player inside its own tile.
  if (def.solid && Math.abs(cx - p.x) < TILE * 0.5 + p.r && Math.abs(cy - p.y) < TILE * 0.5 + p.r) {
    return { ok: false, reason: 'You are standing there' };
  }
  // Don't bury loot containers.
  for (const c of w.containers) {
    if (c.tx === tx && c.ty === ty && !c.hidden) return { ok: false, reason: 'Container there' };
  }
  // Don't seal an enemy inside a wall tile.
  if (def.solid) {
    for (const e of G.enemies) {
      if (!e.dead && Math.abs(e.x - cx) < TILE * 0.5 + e.def.r && Math.abs(e.y - cy) < TILE * 0.5 + e.def.r) {
        return { ok: false, reason: 'Enemy in the way' };
      }
    }
  }
  if (!canAfford(def.cost, p.buildCostMul)) return { ok: false, reason: 'Not enough resources' };
  return { ok: true, reason: '' };
}

export function makeStructure(type, tx, ty, hpMul = 1) {
  const def = STRUCTURES[type];
  const maxHp = Math.round(def.hp * hpMul);
  const s = {
    type, def, tx, ty,
    x: tx * TILE + TILE / 2,
    y: ty * TILE + TILE / 2,
    hp: maxHp, maxHp,
    solid: def.solid,
    flash: 0,
    open: false,
    cd: 0,
    ammo: 0,
    reloadT: 0,
    aim: 0,
    fuel: 0,
    on: true,
    tier: 1,
    destroyed: false,
  };
  return addStructure(s);
}

export function placeStructure(type, tx, ty) {
  const check = canPlace(type, tx, ty);
  if (!check.ok) {
    sfx('deny');
    notify(check.reason, '#c96a5a');
    return null;
  }
  const def = STRUCTURES[type];
  const p = G.player;
  spend(def.cost, p.buildCostMul);

  const s = makeStructure(type, tx, ty, p.structHpMul);

  // Only the newest bedroll is your respawn point.
  if (type === 'bedroll') {
    for (const other of G.structures) {
      if (other !== s && other.type === 'bedroll') other.active = false;
    }
    s.active = true;
    p.spawnStructure = s;
    p.spawnPoint = { x: s.x, y: s.y + TILE };
    notify('Respawn point set', '#b7e08a', true);
  }
  if (type === 'workbench') G.benchTier = Math.max(G.benchTier, 1);

  G.stats.built++;
  sfx('build');
  FX.debris(s.x, s.y, 8, '#9a8256');
  FX.ring(s.x, s.y, 4, 26, 0.3, '#b7e08a', 2);
  addThreat(THREAT.perBuild * def.threat);
  addXp(Math.max(2, Math.round(def.threat * 4 + 3)));
  return s;
}

// ------------------------------------------------------------------- repair --

export function repairCost(s) {
  const frac = 1 - s.hp / s.maxHp;
  if (frac <= 0.001) return null;
  const out = {};
  for (const id in s.def.cost) out[id] = Math.max(1, Math.ceil(s.def.cost[id] * frac * 0.45 * G.player.buildCostMul));
  return out;
}

export function repairStructure(s) {
  const cost = repairCost(s);
  if (!cost) { notify('Already intact', '#8a8f84'); return false; }
  if (!canAfford(cost)) { sfx('deny'); notify('Not enough materials to repair', '#c96a5a'); return false; }
  spend(cost);
  s.hp = s.maxHp;
  sfx('build');
  FX.ring(s.x, s.y, 4, 26, 0.35, '#7ce08a', 2);
  FX.text(s.x, s.y - 16, 'REPAIRED', '#7ce08a', 11, -32, 0.7);
  addXp(3);
  return true;
}

export function demolishStructure(s) {
  const refundMul = 0.5 * (s.hp / s.maxHp);
  const cost = scaledCost(s.def.cost, G.player.buildCostMul);
  const lines = [];
  for (const id in cost) {
    const n = Math.floor(cost[id] * refundMul);
    if (n > 0) { addRes(G.stash, id, n); lines.push(`${id} +${n}`); }
  }
  removeStructure(s);
  s.destroyed = true;
  if (s.type === 'bedroll' && G.player.spawnStructure === s) {
    G.player.spawnStructure = null;
    G.player.spawnPoint = null;
  }
  sfx('build');
  FX.debris(s.x, s.y, 12, '#8a7350');
  FX.text(s.x, s.y - 14, lines.length ? 'SALVAGED → STASH' : 'REMOVED', '#c9a227', 11, -32, 0.8);
  return true;
}

// -------------------------------------------------------------------- power --

/** True if any running generator covers this structure. */
export function hasPower(t) {
  for (const s of G.structures) {
    if (s.type !== 'generator' || s.destroyed) continue;
    if (!s.on || s.fuel <= 0) continue;
    const r = s.def.powerRadius;
    if (dist2(s.x, s.y, t.x, t.y) <= r * r) return true;
  }
  return false;
}

export const turretPowered = hasPower;

/** Floodlights only push back the dark while they are actually powered. */
export function updateFloodlights() {
  for (const s of G.structures) {
    if (s.type !== 'floodlight' || s.destroyed) continue;
    s.powered = hasPower(s);
  }
}

export function updateGenerators(dt) {
  for (const s of G.structures) {
    if (s.type !== 'generator' || s.destroyed) continue;
    if (!s.on || s.fuel <= 0) { s.running = false; continue; }
    s.running = true;
    s.fuel = Math.max(0, s.fuel - s.def.fuelBurn * dt);
    addThreat(THREAT.generatorPerSec * dt);
    if (s.fuel <= 0) notify('Generator out of fuel', '#d98a4a');
    if (Math.random() < dt * 6) FX.smoke(s.x + 6, s.y - 12, 1, '#5a564e');
  }
}

/** True when the generator is actually running, as opposed to merely switched on. */
export const generatorRunning = (s) => !!s.on && s.fuel > 0;

/**
 * One key does both jobs, but switching *off* always takes priority.
 *
 * Routing every interaction through refuelling meant a half-full generator with
 * no spare fuel could never be shut down — it just burned on, broadcasting
 * Threat, which directly contradicts being able to lie low.
 */
export function useGenerator(s) {
  if (generatorRunning(s)) {
    s.on = false;
    s.running = false;
    notify('Generator off', '#d8e8c0');
    sfx('ui');
    return true;
  }

  // It is off or dry: top it up if we can, then start it.
  const need = Math.ceil(s.def.fuelMax - s.fuel);
  let take = 0;
  if (need > 0) {
    take = takeRes(G.player.bag, 'fuel', need);
    if (take < need) take += takeRes(G.stash, 'fuel', need - take);
    if (take > 0) {
      s.fuel = Math.min(s.def.fuelMax, s.fuel + take);
      FX.text(s.x, s.y - 16, `+${take} FUEL`, '#d2762c', 11, -32, 0.8);
    }
  }

  if (s.fuel <= 0) {
    sfx('deny');
    notify('No fuel — find some before this will run', '#c96a5a');
    return false;
  }
  s.on = true;
  sfx('build');
  notify(take > 0 ? `Generator refuelled and running` : 'Generator on', '#b7e08a');
  return true;
}

// ---------------------------------------------------------------- workbench --

export function upgradeBench(s) {
  if (s.tier >= 2) { notify('Already upgraded', '#8a8f84'); return false; }
  if (!canAfford(BENCH_UPGRADE_COST)) {
    sfx('deny');
    notify('Need 55 Scrap, 20 Electronics, 5 Parts', '#c96a5a');
    return false;
  }
  spend(BENCH_UPGRADE_COST);
  s.tier = 2;
  G.benchTier = 2;
  sfx('levelUp');
  FX.ring(s.x, s.y, 6, 90, 0.6, '#59b8c4', 3);
  notify('WORKBENCH II — advanced weapons and steel unlocked', '#59b8c4', true);
  addXp(60);
  addThreat(4);
  return true;
}

// ----------------------------------------------------------------- queries --

export function nearestStructure(x, y, range, pred = () => true) {
  let best = null, bd = range * range;
  for (const s of G.structures) {
    if (s.destroyed || !pred(s)) continue;
    const d = dist2(x, y, s.x, s.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

export const nearWorkbench = (x, y, range = 110) =>
  nearestStructure(x, y, range, (s) => s.type === 'workbench');

/** Where a raid should converge: the middle of your important buildings. */
export function baseCenter() {
  let sx = 0, sy = 0, n = 0;
  for (const s of G.structures) {
    if (s.destroyed) continue;
    const w = s.def.protect ? 3 : 1;
    sx += s.x * w; sy += s.y * w; n += w;
  }
  if (n === 0) return G.player ? { x: G.player.x, y: G.player.y, hasBase: false } : { x: 0, y: 0, hasBase: false };
  return { x: sx / n, y: sy / n, hasBase: true };
}

/**
 * What a raider walks toward. Deliberately the *nearest* structure rather than
 * the most valuable one: that makes the horde break on the perimeter, which is
 * the whole point of building a perimeter. Valuable structures get a modest
 * pull so raiders that are already inside head for the workbench, not back out.
 */
export function raidTarget(from) {
  let best = null, bestScore = Infinity;
  for (const s of G.structures) {
    if (s.destroyed) continue;
    // Weighting <1 makes protected structures effectively "closer".
    const score = dist2(from.x, from.y, s.x, s.y) * (s.def.protect ? 0.55 : 1);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

export function stashDepositAll() {
  const p = G.player;
  let moved = 0;
  for (const id in p.bag) {
    const n = p.bag[id];
    if (n > 0) { addRes(G.stash, id, n); moved += n; }
  }
  p.bag = {};
  for (const id in p.items) {
    // Consumables stay on the player — you always want your bandages.
    if (p.items[id] > 4) {
      const keep = 4;
      G.stashItems[id] = (G.stashItems[id] || 0) + (p.items[id] - keep);
      moved += p.items[id] - keep;
      p.items[id] = keep;
    }
  }
  if (moved > 0) { sfx('loot'); notify(`Deposited ${moved} items`, '#b7e08a'); }
  else { sfx('ui'); notify('Nothing to deposit', '#8a8f84'); }
  return moved;
}

/** Pulls ammo and consumables back out of the stash before heading out. */
export function stashWithdrawAmmo() {
  const p = G.player;
  let moved = 0;
  for (const id of ['ammoP', 'ammoS', 'ammoR', 'med', 'fuel']) {
    const have = countRes(G.stash, id);
    if (have <= 0) continue;
    const got = addResCapped(p.bag, id, have, p.carryCap);
    takeRes(G.stash, id, got);
    moved += got;
  }
  for (const id in G.stashItems) {
    const n = G.stashItems[id] | 0;
    if (n > 0) {
      p.items[id] = (p.items[id] || 0) + n;
      moved += n;
      G.stashItems[id] = 0;
    }
  }
  if (moved > 0) { sfx('loot'); notify(`Took ${moved} items from stash`, '#b7e08a'); }
  else { sfx('ui'); notify('Stash has no ammo or supplies', '#8a8f84'); }
  return moved;
}
